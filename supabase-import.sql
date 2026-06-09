-- ============================================================
--  출근 시프트 · 스프레드시트 가져오기 추가 기능 (증분 SQL)
-- ------------------------------------------------------------
--  ⚠️ 이미 supabase-setup.sql 을 실행한 프로젝트에 "추가로" 실행하세요.
--     기존 데이터는 지우지 않습니다.
--  실행: Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

-- 1) 자동 등록되는 스태프는 PIN 없이 생성될 수 있도록 허용
alter table staff alter column pin drop not null;

-- 2) 스태프 목록에 PIN 설정 여부(has_pin) 추가
drop function if exists staff_directory();
create or replace function staff_directory()
returns table(id bigint, name text, workplace text, is_admin boolean, has_pin boolean)
language sql security definer set search_path = public as $$
  select id, name, workplace, is_admin, (pin is not null) as has_pin
  from staff order by workplace, name;
$$;

-- 3) 관리자가 스태프 PIN 설정/초기화
create or replace function admin_set_pin(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update staff set pin = nullif(trim(p_new_pin), '') where id = p_target_id;
end; $$;

-- 4) 스프레드시트 일괄 가져오기
--    p_rows : [{ "d":"2026-06-02", "s":"15:00", "e":"21:00", "name":"츠나", "memo":"" }, ...]
--    name 이 비었거나 '부족' 이면 → 빈 자리(모집중)로 등록
--    p_replace=true 이면 해당 근무지의 가져온 날짜범위 기존 근무를 먼저 삭제
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
        insert into staff(name, pin, workplace) values (nm, null, p_workplace)
          returning id into sid;
        created := created + 1;
      end if;
    end if;
    insert into shifts(work_date, workplace, start_time, end_time, staff_id, memo)
      values (d, p_workplace, e->>'s', e->>'e', sid, nullif(e->>'memo',''));
    cnt := cnt + 1;
  end loop;

  return json_build_object('inserted', cnt, 'new_staff', created,
                           'from', mind, 'to', maxd);
end; $$;

grant execute on function admin_set_pin, admin_import_shifts to anon, authenticated;
