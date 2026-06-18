-- ============================================================
--  출근 시프트 · 푸시 알림 구독 저장
-- ------------------------------------------------------------
--  이 파일만 한 번 실행하면 돼요. 여러 번 실행해도 안전합니다.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  staff_id bigint not null references staff(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
-- (anon 정책 없음 → 직접 접근 차단. 저장은 아래 함수, 발송은 Edge Function이 service_role 로 읽음)

create or replace function save_push_subscription(p_staff_id bigint, p_pin text,
  p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  insert into push_subscriptions(staff_id, endpoint, p256dh, auth)
    values (p_staff_id, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set staff_id = excluded.staff_id,
      p256dh = excluded.p256dh, auth = excluded.auth;
end; $$;

create or replace function delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint;
end; $$;

grant execute on function save_push_subscription, delete_push_subscription to anon, authenticated;
