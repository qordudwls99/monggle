-- ============================================================
--  모에 스케줄 · PIN 셀프 변경 + 공통 임시 PIN 일괄 설정
-- ------------------------------------------------------------
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
-- ============================================================

-- 임시 PIN 여부 플래그 (true면 아직 본인 PIN으로 안 바꿈)
alter table staff add column if not exists pin_temp boolean not null default false;

-- 1) 관리자: PIN 아직 없는 직원들에게 공통 임시 PIN 일괄 부여
--    (이미 PIN이 있는 사람은 건드리지 않음. 잠김/실패횟수 초기화, 임시 표시)
create or replace function admin_set_default_pin(p_admin_id bigint, p_pin text, p_new_pin text)
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; np text; n integer;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then raise exception '임시 PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np, failed_attempts = 0, locked = false, pin_temp = true where pin is null;
  get diagnostics n = row_count;
  return n;
end; $$;

-- 2) 직원 본인: 마이페이지에서 PIN 변경 (현재 PIN 인증 후 새 PIN으로, 임시 표시 해제)
create or replace function set_my_pin(p_staff_id bigint, p_pin text, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception '현재 PIN이 올바르지 않습니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then raise exception '새 PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np, pin_temp = false where id = p_staff_id;
end; $$;

-- 3) 관리자가 개별 PIN을 직접 정하면 임시 표시 해제
create or replace function admin_set_pin(p_admin_id bigint, p_pin text,
  p_target_id bigint, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is not null and np !~ '^\d{6}$' then raise exception 'PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np, pin_temp = false where id = p_target_id;
end; $$;

-- 4) 로그인 결과에 임시 PIN 여부 포함 (잠금/아바타 로직 유지)
drop function if exists staff_login(text, text);
create function staff_login(p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean)
language plpgsql security definer set search_path = public as $$
declare s staff;
begin
  select * into s from staff where staff.name = p_name;
  if s.id is null then return; end if;
  if s.locked then raise exception '계정이 잠겼어요. 관리자에게 문의하세요.'; end if;
  if s.pin is not null and s.pin = p_pin then
    update staff set failed_attempts = 0 where staff.id = s.id;
    return query select s.id, s.name, s.is_admin, s.avatar_url, coalesce(s.pin_temp,false);
  else
    update staff set failed_attempts = s.failed_attempts + 1,
                     locked = (s.failed_attempts + 1 >= 5) where staff.id = s.id;
    if s.failed_attempts + 1 >= 5 then
      raise exception '5회 틀려 계정이 잠겼어요. 관리자에게 문의하세요.';
    else
      raise exception 'PIN이 틀렸어요. (남은 시도 %회)', 5 - (s.failed_attempts + 1);
    end if;
  end if;
end; $$;

-- 5) 스태프 목록에 임시 PIN 여부 포함 (관리자가 누가 안 바꿨는지 확인)
drop function if exists staff_directory();
create function staff_directory()
returns table(id bigint, name text, is_admin boolean, has_pin boolean, locked boolean, pin_temp boolean)
language sql security definer set search_path = public as $$
  select id, name, is_admin, (pin is not null) as has_pin,
         coalesce(locked,false) as locked, coalesce(pin_temp,false) as pin_temp
  from staff order by name;
$$;

grant execute on function admin_set_default_pin, set_my_pin, admin_set_pin,
  staff_login, staff_directory to anon, authenticated;
