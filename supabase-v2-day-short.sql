-- v2 부족 상태 (2026-11-25)
-- 관리자가 날짜 · 매장마다 '부족' 상태를 켜고 꺼요. 직원끼리만 보는 표시라 손님 페이지는 읽지 않아요.
-- 빈 자리(shifts 의 주인 없는 줄, 직원이 신청하는 자리)와는 별개예요. 야간 '부족' 멤버(night_members)도 그대로예요.
--
-- 바뀌는 것 (기존 표 · 뷰 · 함수는 건드리지 않아요)
--   1) day_short 표: (work_date, workplace) 한 줄 = 그 날 그 매장이 부족 상태. RLS 켬, 정책 없음 → 함수로만 읽고 써요
--   2) staff_day_shorts(p_staff_id, p_pin, p_from, p_to): 로그인한 직원만 읽어요 (뷰로 공개하지 않아요)
--   3) admin_set_day_short(p_admin_id, p_pin, p_date, p_workplace, p_on): 관리자만 켜고 꺼요
--
-- 적용: begin; … commit; 으로 감싸서 실행. 먼저 begin; … rollback; 으로 시험해요.
-- 되돌리기: drop function public.staff_day_shorts(bigint, text, date, date);
--           drop function public.admin_set_day_short(bigint, text, date, text, boolean);
--           drop table public.day_short;

create table if not exists public.day_short (
  work_date  date not null,
  workplace  text not null check (workplace in ('메이드', '데빌', '마츠리')),
  created_at timestamptz not null default now(),
  primary key (work_date, workplace)
);
alter table public.day_short enable row level security;
revoke all on table public.day_short from anon, authenticated;

create or replace function public.staff_day_shorts(p_staff_id bigint, p_pin text, p_from date, p_to date)
returns table(work_date date, workplace text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception '로그인이 필요합니다'; end if;
  return query select d.work_date, d.workplace from day_short d
    where d.work_date between p_from and p_to order by d.work_date, d.workplace;
end; $function$;

create or replace function public.admin_set_day_short(
  p_admin_id bigint, p_pin text, p_date date, p_workplace text, p_on boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_workplace not in ('메이드', '데빌', '마츠리') then raise exception '근무지가 올바르지 않습니다'; end if;
  if coalesce(p_on, false) then
    insert into day_short(work_date, workplace) values (p_date, p_workplace) on conflict do nothing;
  else
    delete from day_short where work_date = p_date and workplace = p_workplace;
  end if;
end; $function$;

revoke all on function public.staff_day_shorts(bigint, text, date, date) from public;
revoke all on function public.admin_set_day_short(bigint, text, date, text, boolean) from public;
grant execute on function public.staff_day_shorts(bigint, text, date, date) to anon, authenticated;
grant execute on function public.admin_set_day_short(bigint, text, date, text, boolean) to anon, authenticated;
