// Supabase Edge Function: notify
// 1) 대타 게시판 댓글 → 관련자(요청자 + 기존 댓글 작성자)에게 웹푸시
// 2) to:'admins' → 관리자 전원에게 웹푸시 (빈자리 신청 / 대타 요청 등 알림탭 이벤트)
// 3) event:'...' → supabase-v2.sql 이 쓴 staff_notifications 행을 그대로 푸시 (v2)
//    받는 사람 · 문구 = 그 행의 staff_id · title · body. 10분 안의 아직 안 보낸(pushed_at null) 행만
//    한 문장(update … set pushed_at … returning)으로 가져가므로 같은 행은 두 번 보내지 않음
//    { event:'application_decided', app_id }   관리자만 · 그 근무 날+근무지의 수락/거절 행 (자동 거절 포함)
//    { event:'swap_taken', request_id }         대타를 맡은 본인만 · 10분 안 · 그 요청의 swap_taken 행
//    { event:'published', ym }                  관리자만 · 공개된 달 · 그 달 schedule_published 행
//    { event:'remind_submission', ym }          관리자만 · 제출 기간 · 그 달 submission_reminder 행
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

const V2_URL = '/v2/staff.html';    // 새 event 알림만 v2 페이지로 (기존 두 경로는 /staff.html 그대로)
const CLAIM_WINDOW_MS = 10 * 60 * 1000;   // 이보다 오래된 알림 행은 푸시하지 않음 (앱 안 알림으로만)

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

    if (payload.event !== undefined) {
      // SQL 이 쓴 알림 행을 푸시 (v2). 알 수 없는 event 는 댓글 경로로 넘어가지 않고 400
      const ev = String(payload.event);
      const { data: me } = await supa.from('staff').select('is_admin').eq('id', callerId).maybeSingle();
      const isAdmin = !!me?.is_admin;
      const needAdmin = ev === 'application_decided' || ev === 'published' || ev === 'remind_submission';
      if (!['application_decided', 'swap_taken', 'published', 'remind_submission'].includes(ev)) {
        return json({ error: 'unknown event' }, 400);
      }
      if (needAdmin && !isAdmin) return json({ error: 'forbidden' }, 403);

      // 아직 안 보낸 최근 행을 한 문장으로 가져감 (동시에 두 번 불려도 한 행은 한 쪽만 가져감)
      let claim = supa.from('staff_notifications')
        .update({ pushed_at: new Date().toISOString() })
        .is('pushed_at', null)
        .gt('created_at', new Date(Date.now() - CLAIM_WINDOW_MS).toISOString());

      if (ev === 'application_decided') {
        // 자동 거절 행에는 app_id 가 없으므로 그 근무의 날+근무지로 맞춤 (각 행은 여전히 한 번만)
        const { data: app } = await supa.from('slot_applications').select('shift_id')
          .eq('id', Number(payload.app_id)).maybeSingle();
        if (!app) return json({ sent: 0 });
        const { data: sh } = await supa.from('shifts').select('work_date,workplace').eq('id', app.shift_id).maybeSingle();
        if (!sh) return json({ sent: 0 });
        claim = claim.in('kind', ['application_approved', 'application_rejected'])
          .eq('link->>date', String(sh.work_date)).eq('link->>workplace', String(sh.workplace));
      } else if (ev === 'swap_taken') {
        const { data: r } = await supa.from('swap_requests').select('taker_id,status,resolved_at')
          .eq('id', Number(payload.request_id)).maybeSingle();
        if (!r || r.status !== 'completed' || Number(r.taker_id) !== callerId) return json({ sent: 0 });
        if (!r.resolved_at || Date.now() - Date.parse(r.resolved_at) > CLAIM_WINDOW_MS) return json({ sent: 0 });
        claim = claim.eq('kind', 'swap_taken').eq('link->>request_id', String(Number(payload.request_id)));
      } else {
        const ym = String(payload.ym || '');
        if (!/^\d{4}-\d{2}$/.test(ym)) return json({ error: 'bad ym' }, 400);
        const { data: st } = await supa.from('schedule_status').select('published,submit_open').eq('ym', ym).maybeSingle();
        if (ev === 'published' ? !st?.published : !st?.submit_open) return json({ sent: 0 });
        claim = claim.eq('kind', ev === 'published' ? 'schedule_published' : 'submission_reminder')
          .eq('link->>ym', ym);
      }

      const { data: rows, error: claimErr } = await claim.select('staff_id,title,body');
      if (claimErr) throw claimErr;
      // 받는 사람별 문구 (수락/거절처럼 행마다 다를 수 있음) · 호출한 본인은 제외 (기존과 같음)
      const msgs = new Map<number, string[]>();
      for (const n of rows || []) {
        const sid = Number(n.staff_id);
        if (!sid || sid === callerId) continue;
        const out = JSON.stringify({ title: String(n.title || '').slice(0, 40), body: String(n.body || '').slice(0, 120), url: V2_URL });
        msgs.set(sid, [...(msgs.get(sid) || []), out]);
      }
      if (msgs.size === 0) return json({ sent: 0 });

      const { data: evSubs } = await supa.from('push_subscriptions').select('*').in('staff_id', [...msgs.keys()]);
      let evSent = 0;
      await Promise.all((evSubs || []).flatMap((s: any) => (msgs.get(Number(s.staff_id)) || []).map(async (out) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, out);
          evSent++;
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            await supa.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
          }
        }
      })));
      return json({ sent: evSent });
    } else if (payload.to === 'admins') {
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
