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
drop function if exists admin_add_staff(bigint, text, text, text, boolean);
create function admin_add_staff(p_admin_id bigint, p_pin text,
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
create or replace view shift_view as
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
drop function if exists admin_add_shift(bigint, text, date, text, text, text, bigint, text, text);
create function admin_add_shift(p_admin_id bigint, p_pin text,
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

-- 9) 이제 직원 테이블의 근무지 컬럼 제거
alter table staff drop column if exists workplace;

-- 실행 권한
grant execute on function
  staff_login, staff_directory, admin_add_staff, admin_set_pin,
  admin_add_shift, admin_update_shift, admin_set_day_event, admin_import_shifts
to anon, authenticated;
