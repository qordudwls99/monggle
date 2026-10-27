// Supabase Edge Function: notify
// 1) 대타 게시판 댓글 → 관련자(요청자 + 기존 댓글 작성자)에게 웹푸시
// 2) to:'admins' → 관리자 전원에게 웹푸시 (빈자리 신청 / 대타 요청 등 알림탭 이벤트)
//
// 배포 방법은 PUSH_SETUP.md 참고. 필요한 Secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (예: mailto:you@example.com)
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 자동 주입됨)
// 배포: supabase functions deploy notify --no-verify-jwt  (호출자 확인은 아래 세션 토큰으로 직접 함)

import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const payload = await req.json();

    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 호출한 직원 확인 : 앱 로그인 세션 토큰(staff_sessions)과 staff_id 가 맞아야 함
    const callerId = Number(payload.staff_id);
    const token = String(payload.token || '');
    if (!callerId || !token.startsWith('tk_')) return json({ error: 'unauthorized' }, 401);
    const { data: sess } = await supa.from('staff_sessions').select('staff_id')
      .eq('token_hash', await sha256hex(token)).maybeSingle();
    if (!sess || Number(sess.staff_id) !== callerId) return json({ error: 'unauthorized' }, 401);

    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    );

    const ids = new Set<number>();
    let title = '모에 스케줄';
    let body = '';
    const url = '/staff.html';           // 알림을 누르면 항상 직원용 페이지로 (외부 링크 불가)

    if (payload.to === 'admins') {
      // 관리자 전원에게 (보낸 사람 본인 제외)
      const { data: admins } = await supa.from('staff').select('id').eq('is_admin', true);
      (admins || []).forEach((a: any) => a.id && ids.add(a.id));
      ids.delete(callerId);
      title = String(payload.title || '모에 스케줄 알림').slice(0, 40);
      body = String(payload.body || '').slice(0, 120);
    } else {
      // 댓글 알림 (요청자 + 그 글에 댓글 단 사람들, 작성자 본인 제외) · 작성자 이름은 DB 에서
      const { request_id, body: cbody } = payload;
      const { data: reqRow } = await supa.from('swap_requests').select('requester_id').eq('id', request_id).maybeSingle();
      if (!reqRow) return json({ sent: 0 });
      if (reqRow.requester_id) ids.add(reqRow.requester_id);
      const { data: coms } = await supa.from('swap_comments').select('author_id').eq('request_id', request_id);
      (coms || []).forEach((c: any) => c.author_id && ids.add(c.author_id));
      ids.delete(callerId);
      const { data: me } = await supa.from('staff').select('name').eq('id', callerId).maybeSingle();
      title = '대타 게시판 새 댓글';
      body = `${me?.name || '누군가'}: ${cbody || ''}`.slice(0, 120);
    }

    const idArr = [...ids];
    if (idArr.length === 0) return json({ sent: 0 });

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

    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
