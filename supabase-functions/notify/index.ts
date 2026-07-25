// Supabase Edge Function: notify
// 1) 대타 게시판 댓글 → 관련자(요청자 + 기존 댓글 작성자)에게 웹푸시
// 2) to:'admins' → 관리자 전원에게 웹푸시 (빈자리 신청 / 대타 요청 등 알림탭 이벤트)
//
// 배포 방법은 PUSH_SETUP.md 참고. 필요한 Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (예: mailto:you@example.com)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 자동 주입됨)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get('MONGGLE_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origin = req.headers.get('origin') || '';
  const selected = allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    ...(selected ? { 'Access-Control-Allow-Origin': selected } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return json(req, { error: 'UNAUTHORIZED' }, 401);
    }

    const payload = await req.json();

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json(req, { error: 'UNAUTHORIZED' }, 401);
    }

    const supa = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await supa
      .from('mateyou_profiles')
      .select('staff_id,is_partner_plus,entitlement_checked_at')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    const checkedAt = profile?.entitlement_checked_at
      ? new Date(profile.entitlement_checked_at).getTime()
      : 0;
    if (
      profileError || !profile?.staff_id || !profile.is_partner_plus ||
      Date.now() - checkedAt > 15 * 60 * 1_000
    ) {
      return json(req, { error: 'PARTNER_PLUS_REQUIRED' }, 403);
    }

    const callerStaffId = Number(profile.staff_id);
    const { data: caller } = await supa
      .from('staff')
      .select('id,name,is_admin')
      .eq('id', callerStaffId)
      .maybeSingle();
    if (!caller) return json(req, { error: 'STAFF_LINK_REQUIRED' }, 403);

    const ids = new Set<number>();
    let title = '모에 스케줄';
    let body = '';
    let url = '/staff.html';

    if (payload.to === 'admins') {
      // 관리자 전원에게
      const { data: admins } = await supa.from('staff').select('id').eq('is_admin', true);
      (admins || []).forEach((a: any) => a.id && ids.add(a.id));
      ids.delete(callerStaffId);
      title = payload.title || '모에 스케줄 알림';
      body = String(payload.body || '').slice(0, 120);
      url = '/staff.html';
    } else {
      // 댓글 알림 (요청자 + 그 글에 댓글 단 사람들, 작성자 본인 제외)
      const { request_id, body: cbody } = payload;
      const { data: reqRow } = await supa.from('swap_requests').select('requester_id').eq('id', request_id).maybeSingle();
      if (reqRow?.requester_id) ids.add(reqRow.requester_id);
      const { data: coms } = await supa.from('swap_comments').select('author_id').eq('request_id', request_id);
      (coms || []).forEach((c: any) => c.author_id && ids.add(c.author_id));
      ids.delete(callerStaffId);
      title = '대타 게시판 새 댓글';
      body = `${caller.name || '누군가'}: ${cbody || ''}`.slice(0, 120);
      url = '/staff.html';
    }

    const idArr = [...ids];
    if (idArr.length === 0) return json(req, { sent: 0 });

    const { data: subs } = await supa.from('push_subscriptions').select('*').in('staff_id', idArr);
    const out = JSON.stringify({ title, body, url });

    let sent = 0;
    await Promise.all((subs || []).map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, out);
        sent++;
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await supa.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }));

    return json(req, { sent });
  } catch (e) {
    console.error('Push notification failed', e);
    return json(req, { error: 'NOTIFICATION_FAILED' }, 500);
  }
});
