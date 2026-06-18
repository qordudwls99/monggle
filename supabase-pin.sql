-- ============================================================
--  모에 스케줄 · PIN 셀프 변경 + 공통 임시 PIN 일괄 설정
-- ------------------------------------------------------------
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
-- ============================================================

-- 1) 관리자: PIN 아직 없는 직원들에게 공통 임시 PIN 일괄 부여
--    (이미 PIN이 있는 사람은 건드리지 않음. 잠김/실패횟수도 초기화)
create or replace function admin_set_default_pin(p_admin_id bigint, p_pin text, p_new_pin text)
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; np text; n integer;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then raise exception '임시 PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np, failed_attempts = 0, locked = false where pin is null;
  get diagnostics n = row_count;
  return n;
end; $$;

-- 2) 직원 본인: 마이페이지에서 PIN 변경 (현재 PIN으로 인증 후 새 PIN으로)
create or replace function set_my_pin(p_staff_id bigint, p_pin text, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception '현재 PIN이 올바르지 않습니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then raise exception '새 PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np where id = p_staff_id;
end; $$;

grant execute on function admin_set_default_pin, set_my_pin to anon, authenticated;
