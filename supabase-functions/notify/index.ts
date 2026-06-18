// Supabase Edge Function: notify
// 1) 대타 게시판 댓글 → 관련자(요청자 + 기존 댓글 작성자)에게 웹푸시
// 2) to:'admins' → 관리자 전원에게 웹푸시 (빈자리 신청 / 대타 요청 등 알림탭 이벤트)
//
// 배포 방법은 PUSH_SETUP.md 참고. 필요한 Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (예: mailto:you@example.com)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 자동 주입됨)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const payload = await req.json();

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const ids = new Set<number>();
    let title = '모에 스케줄';
    let body = '';
    let url = '/staff.html';

    if (payload.to === 'admins') {
      // 관리자 전원에게
      const { data: admins } = await supa.from('staff').select('id').eq('is_admin', true);
      (admins || []).forEach((a: any) => a.id && ids.add(a.id));
      if (payload.exclude_id) ids.delete(payload.exclude_id);
      title = payload.title || '모에 스케줄 알림';
      body = String(payload.body || '').slice(0, 120);
      url = payload.url || '/staff.html';
    } else {
      // 댓글 알림 (요청자 + 그 글에 댓글 단 사람들, 작성자 본인 제외)
      const { request_id, body: cbody, author_name, author_id } = payload;
      const { data: reqRow } = await supa.from('swap_requests').select('requester_id').eq('id', request_id).maybeSingle();
      if (reqRow?.requester_id) ids.add(reqRow.requester_id);
      const { data: coms } = await supa.from('swap_comments').select('author_id').eq('request_id', request_id);
      (coms || []).forEach((c: any) => c.author_id && ids.add(c.author_id));
      if (author_id) ids.delete(author_id);
      title = '대타 게시판 새 댓글';
      body = `${author_name || '누군가'}: ${cbody || ''}`.slice(0, 120);
      url = '/staff.html';
    }

    const idArr = [...ids];
    if (idArr.length === 0) return new Response(JSON.stringify({ sent: 0 }), { headers: cors });

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

    return new Response(JSON.stringify({ sent }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
