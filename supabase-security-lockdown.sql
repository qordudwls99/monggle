-- ============================================================
--  모에 스케줄 · 보안 강화 2단계 (PIN 직접 인증 경로 닫기)
-- ------------------------------------------------------------
--  supabase-security.sql 실행 + 세션 토큰을 쓰는 staff.html 배포 "후에" 실행하세요.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run (여러 번 실행해도 안전)
--
--  · 로그인(staff_signin) 말고는 PIN 으로 인증할 수 없음 → PIN 무차별 대입 경로 제거
--  · 이전 버전 화면이 열려 있던 기기는 새로고침하면 자동으로 토큰으로 전환됨
-- ============================================================

-- 1) 인증 헬퍼 : 세션 토큰만 허용
create or replace function _verify(p_staff_id bigint, p_pin text)
returns staff language sql security definer set search_path = public as $$
  select s.* from staff s
   where s.id = p_staff_id
     and exists (select 1 from staff_sessions ss
                  where ss.staff_id = s.id and ss.token_hash = _token_hash(p_pin));
$$;
revoke execute on function _verify(bigint, text) from public, anon, authenticated;

-- 2) 잠금이 동작하지 않던 예전 로그인 함수 제거 (staff_signin 으로 대체)
drop function if exists staff_login(text, text);

-- 3) 공개 스태프 목록에서는 PIN 유무 · 잠김 · 임시 PIN 여부를 숨김
--    (관리자는 admin_staff_directory 로 확인 · 반환 형식은 그대로)
create or replace function staff_directory()
returns table(id bigint, name text, is_admin boolean, has_pin boolean, locked boolean, pin_temp boolean)
language sql security definer set search_path = public as $$
  select id, name, is_admin, null::boolean, null::boolean, null::boolean
  from staff order by name;
$$;

-- 4) 프로필 사진 : 이미 올라간 파일은 덮어쓸 수 없음 (새 파일 올리기만 가능)
drop policy if exists "avatars_update" on storage.objects;
