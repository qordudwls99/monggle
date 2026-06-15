-- ============================================================
--  출근 시프트 · 야간영업 추가 (데빌 전용, 가끔)
-- ------------------------------------------------------------
--  이 파일만 한 번 실행하면 돼요. 여러 번 실행해도 안전합니다.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

-- 야간영업 표시 (근무지+날짜 단위). 시작한 날(저녁)에 기록.
create table if not exists night_days (
  work_date date not null,
  workplace text not null,
  hours text not null default '22:00 ~ 익일 05:00',
  primary key (work_date, workplace)
);
alter table night_days enable row level security;

create or replace view night_view as select work_date, workplace, hours from night_days;
grant select on night_view to anon, authenticated;

create or replace function admin_set_night(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_on boolean, p_hours text default '22:00 ~ 익일 05:00')
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_on then
    insert into night_days(work_date, workplace, hours)
      values (p_date, p_workplace, coalesce(nullif(trim(p_hours),''),'22:00 ~ 익일 05:00'))
      on conflict (work_date, workplace) do update set hours = excluded.hours;
  else
    delete from night_days where work_date = p_date and workplace = p_workplace;
  end if;
end; $$;

grant execute on function admin_set_night to anon, authenticated;
