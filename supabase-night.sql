-- ============================================================
--  출근 시프트 · 야간영업 (데빌 전용, 가끔)  + 야간 멤버 별도 명단
-- ------------------------------------------------------------
--  이 파일만 한 번 실행하면 돼요. 여러 번 실행해도 안전합니다.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

-- 1) 야간영업 표시 (근무지+날짜 단위, 시작한 날 기준) -----------------
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
    delete from night_members where work_date = p_date and workplace = p_workplace;
  end if;
end; $$;

-- 2) 야간 멤버 (그 날 야간 명단, 주간 명단과 별개) --------------------
create table if not exists night_members (
  id bigint generated always as identity primary key,
  work_date date not null,
  workplace text not null,
  member_name text not null,
  created_at timestamptz not null default now()
);
alter table night_members enable row level security;
create or replace view night_member_view as
  select id, work_date, workplace, member_name from night_members order by id;
grant select on night_member_view to anon, authenticated;

create or replace function admin_add_night_member(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if nullif(trim(p_name),'') is null then raise exception '이름을 입력하세요'; end if;
  insert into night_members(work_date, workplace, member_name) values (p_date, p_workplace, trim(p_name));
end; $$;

create or replace function admin_remove_night_member(p_admin_id bigint, p_pin text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  delete from night_members where id = p_id;
end; $$;

grant execute on function
  admin_set_night, admin_add_night_member, admin_remove_night_member
to anon, authenticated;
