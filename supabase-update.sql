-- ============================================================
--  출근 시프트 · 업데이트 SQL (v2)
-- ------------------------------------------------------------
--  ⚠️ supabase-setup.sql 실행 이후, 이 파일을 한 번 실행하세요.
--     (supabase-import.sql 내용도 포함되어 있어, 안 돌렸어도 됩니다.)
--     기존 데이터/근무는 지우지 않습니다. 중복 실행해도 안전합니다.
--  실행: Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

-- 1) PIN 없이 생성 허용 (가져오기로 자동 등록되는 직원용)
alter table staff alter column pin drop not null;

-- 2) 게스트 칸 (계정 없는 사람을 관리자가 강제 입력)
alter table shifts add column if not exists guest_name text;

-- 3) 직원에서 '근무지 고정값' 제거를 위해 관련 함수 재정의 -------------

-- 로그인 (근무지 반환 제거)
drop function if exists staff_login(text, text);
create function staff_login(p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean)
language sql security definer set search_path = public as $$
  select id, name, is_admin from staff where name = p_name and pin = p_pin;
$$;

-- 이름 목록 (근무지 제거, has_pin 유지)
drop function if exists staff_directory();
create function staff_directory()
returns table(id bigint, name text, is_admin boolean, has_pin boolean)
language sql security definer set search_path = public as $$
  select id, name, is_admin, (pin is not null) as has_pin from staff order by name;
$$;

-- 스태프 추가 (근무지 인자 제거)
drop function if exists admin_add_staff(bigint, text, text, text, text, boolean);
create or replace function admin_add_staff(p_admin_id bigint, p_pin text,
  p_name text, p_new_pin text, p_is_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into staff(name, pin, is_admin)
    values (p_name, nullif(trim(p_new_pin), ''), p_is_admin);
end; $$;

-- PIN 설정/초기화 (import.sql 포함분)
create or replace function admin_set_pin(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update staff set pin = nullif(trim(p_new_pin), '') where id = p_target_id;
end; $$;

-- 4) 조회 뷰 : 게스트/표시이름 포함
drop view if exists shift_view;
create view shift_view as
  select sh.id, sh.work_date, sh.workplace, sh.start_time, sh.end_time,
         sh.status, sh.memo, sh.staff_id, st.name as staff_name,
         sh.guest_name,
         coalesce(st.name, sh.guest_name) as display_name,
         (sh.staff_id is null and sh.guest_name is not null) as is_guest
  from shifts sh
  left join staff st on st.id = sh.staff_id;
grant select on shift_view to anon, authenticated;

-- 5) 근무 추가 : 게스트 강제 입력 지원
drop function if exists admin_add_shift(bigint, text, date, text, text, text, bigint, text);
create or replace function admin_add_shift(p_admin_id bigint, p_pin text,
  p_work_date date, p_workplace text, p_start text, p_end text,
  p_assignee bigint default null, p_memo text default null, p_guest text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into shifts(work_date, workplace, start_time, end_time, staff_id, guest_name, memo)
    values (p_work_date, p_workplace, p_start, p_end,
            p_assignee, nullif(trim(p_guest), ''), p_memo);
end; $$;

-- 6) '○○데이' 이벤트 이름 수정/삭제 (해당 날짜+근무지의 모든 근무 메모 일괄)
create or replace function admin_set_day_event(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update shifts set memo = nullif(trim(p_event), '')
    where work_date = p_date and workplace = p_workplace;
end; $$;

-- 7) 가져오기 : 자동 등록 직원에 근무지 미사용
create or replace function admin_import_shifts(p_admin_id bigint, p_pin text,
  p_workplace text, p_rows jsonb, p_replace boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  v staff; e jsonb; sid bigint; nm text; d date;
  cnt int := 0; created int := 0; mind date; maxd date;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_workplace not in ('메이드','데빌','마츠리') then
    raise exception '근무지가 올바르지 않습니다'; end if;

  select min((x->>'d')::date), max((x->>'d')::date) into mind, maxd
    from jsonb_array_elements(p_rows) x;

  if p_replace and mind is not null then
    delete from shifts where workplace = p_workplace and work_date between mind and maxd;
  end if;

  for e in select * from jsonb_array_elements(p_rows) loop
    d  := (e->>'d')::date;
    nm := nullif(trim(e->>'name'), '');
    sid := null;
    if nm is not null and nm <> '부족' then
      select id into sid from staff where name = nm;
      if sid is null then
        insert into staff(name, pin) values (nm, null) returning id into sid;
        created := created + 1;
      end if;
    end if;
    insert into shifts(work_date, workplace, start_time, end_time, staff_id, memo)
      values (d, p_workplace, e->>'s', e->>'e', sid, nullif(e->>'memo',''));
    cnt := cnt + 1;
  end loop;

  return json_build_object('inserted', cnt, 'new_staff', created, 'from', mind, 'to', maxd);
end; $$;

-- 8) 근무 수정 (담당자 변경/시간 변경) — 출근표에서 직접 편집
create or replace function admin_update_shift(p_admin_id bigint, p_pin text,
  p_shift_id bigint, p_start text, p_end text,
  p_assignee bigint default null, p_guest text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update shifts set start_time = p_start, end_time = p_end,
    staff_id = p_assignee, guest_name = nullif(trim(p_guest), ''), status = 'confirmed'
    where id = p_shift_id;
end; $$;

-- 9) 휴무일 (근무지별 날짜 단위 휴무 지정)
create table if not exists closures (
  work_date date not null,
  workplace text not null,
  primary key (work_date, workplace)
);
alter table closures enable row level security;
create or replace view closure_view as select work_date, workplace from closures;
grant select on closure_view to anon, authenticated;

create or replace function admin_set_day_off(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_off boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_off then
    delete from shifts where work_date = p_date and workplace = p_workplace;
    insert into closures(work_date, workplace) values (p_date, p_workplace)
      on conflict do nothing;
  else
    delete from closures where work_date = p_date and workplace = p_workplace;
  end if;
end; $$;

-- 10) 직원 권한 변경 (일반 ↔ 관리자)
create or replace function admin_set_role(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_is_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_target_id = p_admin_id and not p_is_admin then
    raise exception '본인 권한은 내릴 수 없어요'; end if;
  update staff set is_admin = p_is_admin where id = p_target_id;
end; $$;

-- 11) 이제 직원 테이블의 근무지 컬럼 제거
alter table staff drop column if exists workplace;

-- 실행 권한
grant execute on function
  staff_login, staff_directory, admin_add_staff, admin_set_pin,
  admin_add_shift, admin_update_shift, admin_set_day_event, admin_import_shifts,
  admin_set_day_off, admin_set_role
to anon, authenticated;

-- ============================================================
--  v4) 인스타그램 + 빈자리 신청(관리자 승인)
-- ============================================================

-- 직원 인스타그램 (아이디 또는 URL)
alter table staff add column if not exists instagram text;

create or replace function admin_set_instagram(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_insta text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update staff set instagram = nullif(trim(p_insta), '') where id = p_target_id;
end; $$;

-- shift_view 에 직원 인스타그램 추가
drop view if exists shift_view;
create view shift_view as
  select sh.id, sh.work_date, sh.workplace, sh.start_time, sh.end_time,
         sh.status, sh.memo, sh.staff_id, st.name as staff_name,
         sh.guest_name,
         coalesce(st.name, sh.guest_name) as display_name,
         (sh.staff_id is null and sh.guest_name is not null) as is_guest,
         st.instagram as staff_instagram
  from shifts sh
  left join staff st on st.id = sh.staff_id;
grant select on shift_view to anon, authenticated;

-- 빈자리 신청
create table if not exists slot_applications (
  id           bigint generated always as identity primary key,
  shift_id     bigint not null references shifts(id) on delete cascade,
  applicant_id bigint not null references staff(id) on delete cascade,
  status       text not null default 'open' check (status in ('open','approved','rejected')),
  created_at   timestamptz not null default now(),
  unique (shift_id, applicant_id)
);
alter table slot_applications enable row level security;

create or replace view application_view as
  select a.id, a.shift_id, a.applicant_id, st.name as applicant_name,
         sh.work_date, sh.workplace
  from slot_applications a
  join staff  st on st.id = a.applicant_id
  join shifts sh on sh.id = a.shift_id
  where a.status = 'open';
grant select on application_view to anon, authenticated;

-- 직원: 빈자리에 신청 (직접 배정 불가, 신청만)
create or replace function apply_slot(p_staff_id bigint, p_pin text, p_shift_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; sh shifts;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into sh from shifts where id = p_shift_id;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is not null or sh.guest_name is not null then
    raise exception '이미 담당자가 있는 근무예요'; end if;
  insert into slot_applications(shift_id, applicant_id) values (p_shift_id, p_staff_id)
    on conflict (shift_id, applicant_id) do update set status='open';
end; $$;

-- 직원: 본인 신청 취소
create or replace function cancel_application(p_staff_id bigint, p_pin text, p_shift_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  delete from slot_applications where shift_id = p_shift_id and applicant_id = p_staff_id and status='open';
end; $$;

-- 관리자: 신청 수락 → 배정 (다른 신청은 거절)
create or replace function admin_approve_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; a slot_applications;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  select * into a from slot_applications where id = p_app_id;
  if a.id is null then raise exception '신청을 찾을 수 없습니다'; end if;
  update shifts set staff_id = a.applicant_id, status = 'confirmed' where id = a.shift_id;
  update slot_applications set status='rejected' where shift_id = a.shift_id and status='open' and id <> p_app_id;
  update slot_applications set status='approved' where id = p_app_id;
end; $$;

-- 관리자: 신청 거절
create or replace function admin_reject_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update slot_applications set status='rejected' where id = p_app_id;
end; $$;

-- 관리자: 모든 스태프(관리자 포함) 이름 수정
create or replace function admin_rename_staff(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if nullif(trim(p_name),'') is null then raise exception '이름을 입력하세요'; end if;
  update staff set name = trim(p_name) where id = p_target_id;
end; $$;

-- 직원 본인: 자기 인스타그램 직접 수정 (관리자 아니어도 가능)
create or replace function set_my_instagram(p_staff_id bigint, p_pin text, p_insta text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  update staff set instagram = nullif(trim(p_insta), '') where id = p_staff_id;
end; $$;

-- 직원 본인: 자기 인스타그램 조회
create or replace function my_instagram(p_staff_id bigint, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  return v.instagram;
end; $$;

grant execute on function
  admin_set_instagram, apply_slot, cancel_application,
  admin_approve_application, admin_reject_application,
  admin_rename_staff, set_my_instagram, my_instagram
to anon, authenticated;

-- ============================================================
--  v5) 6자리 PIN + 로그인 실패 잠금
-- ============================================================
alter table staff add column if not exists failed_attempts int not null default 0;
alter table staff add column if not exists locked boolean not null default false;

-- 로그인: 잠금/실패횟수 처리 (5회 실패 시 잠금)
create or replace function staff_login(p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean)
language plpgsql security definer set search_path = public as $$
declare s staff;
begin
  select * into s from staff where staff.name = p_name;
  if s.id is null then return; end if;                 -- 이름 없음 → 빈 결과
  if s.locked then
    raise exception '계정이 잠겼어요. 관리자에게 문의하세요.'; end if;
  if s.pin is not null and s.pin = p_pin then
    update staff set failed_attempts = 0 where staff.id = s.id;
    return query select s.id, s.name, s.is_admin;
  else
    update staff set failed_attempts = s.failed_attempts + 1,
                     locked = (s.failed_attempts + 1 >= 5)
      where staff.id = s.id;
    if s.failed_attempts + 1 >= 5 then
      raise exception '5회 틀려 계정이 잠겼어요. 관리자에게 문의하세요.';
    else
      raise exception 'PIN이 틀렸어요. (남은 시도 %회)', 5 - (s.failed_attempts + 1);
    end if;
  end if;
end; $$;

-- 이름 목록에 잠금 상태 포함
drop function if exists staff_directory();
create function staff_directory()
returns table(id bigint, name text, is_admin boolean, has_pin boolean, locked boolean)
language sql security definer set search_path = public as $$
  select id, name, is_admin, (pin is not null) as has_pin, coalesce(locked,false) as locked
  from staff order by name;
$$;

-- 관리자: 잠금 해제
create or replace function admin_unlock_staff(p_admin_id bigint, p_pin text, p_target_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update staff set locked = false, failed_attempts = 0 where id = p_target_id;
end; $$;

-- PIN 6자리 강제 (스태프 추가 / PIN 설정)
create or replace function admin_add_staff(p_admin_id bigint, p_pin text,
  p_name text, p_new_pin text, p_is_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is not null and np !~ '^\d{6}$' then raise exception 'PIN은 6자리 숫자로 입력하세요'; end if;
  insert into staff(name, pin, is_admin) values (p_name, np, p_is_admin);
end; $$;

create or replace function admin_set_pin(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is not null and np !~ '^\d{6}$' then raise exception 'PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np where id = p_target_id;
end; $$;

grant execute on function staff_login, staff_directory, admin_unlock_staff,
  admin_add_staff, admin_set_pin to anon, authenticated;
