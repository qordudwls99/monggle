-- ============================================================
--  모에 스케줄 · 보안 강화 1단계 (세션 토큰 · 로그인 잠금 · 입력 검증)
-- ------------------------------------------------------------
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
--  여러 번 실행해도 안전합니다. 기존 앱(PIN 방식)도 그대로 동작합니다.
--  프론트(staff.html) 배포 후 supabase-security-lockdown.sql 을 실행하세요.
--
--  · 로그인 때만 PIN 을 확인하고, 이후 요청은 무작위 세션 토큰으로 인증
--    (토큰은 기존 p_pin 자리에 그대로 넣으므로 다른 함수는 바뀌지 않음)
--  · 로그인 실패 횟수가 실제로 기록되도록 (예외 대신 결과로 반환 → 롤백 안 됨)
-- ============================================================

-- 1) 세션 토큰 (원문은 저장하지 않고 sha256 해시만 저장)
create table if not exists staff_sessions (
  token_hash text primary key,
  staff_id   bigint not null references staff(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists staff_sessions_staff_idx on staff_sessions(staff_id);
alter table staff_sessions enable row level security;
revoke all on table staff_sessions from public, anon, authenticated;

create or replace function _token_hash(p_token text)
returns text language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- 2) 로그인 : 성공하면 토큰 발급. 틀리면 오류 대신 err 로 돌려줘서 실패 횟수가 남게 함
--    (같은 계정에 동시에 시도해도 행 잠금으로 한 번씩 정확히 셈 · 5회 틀리면 잠금)
create or replace function staff_signin(p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean, avatar_url text,
              pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare s staff; tk text; n int;
begin
  select * into s from staff where staff.name = p_name for update;
  if s.id is null then return; end if;                       -- 이름 없음 → 빈 결과
  if s.locked then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '계정이 잠겼어요. 관리자에게 문의하세요.'::text;
    return;
  end if;
  if s.pin is not null and s.pin = p_pin then
    update staff set failed_attempts = 0 where staff.id = s.id;
    tk := 'tk_' || encode(extensions.gen_random_bytes(32), 'hex');
    insert into staff_sessions(token_hash, staff_id) values (_token_hash(tk), s.id);
    return query select s.id, s.name, s.is_admin, s.avatar_url, coalesce(s.pin_temp, false), tk, null::text;
  else
    update staff set failed_attempts = staff.failed_attempts + 1,
                     locked = (staff.failed_attempts + 1 >= 5)
      where staff.id = s.id
      returning staff.failed_attempts into n;
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      case when n >= 5 then '5회 틀려 계정이 잠겼어요. 관리자에게 문의하세요.'
           else format('PIN이 틀렸어요. (남은 시도 %s회)', 5 - n) end;
  end if;
end; $$;

-- 로그아웃 : 이 기기 토큰만 폐기
create or replace function staff_signout(p_staff_id bigint, p_pin text)
returns void language sql security definer set search_path = public as $$
  delete from staff_sessions where staff_id = p_staff_id and token_hash = _token_hash(p_pin);
$$;

-- 3) 인증 헬퍼 : 세션 토큰 (전환 기간에는 PIN 도 허용 → lockdown 에서 제거)
--    잠금(locked)은 PIN 로그인만 막고, 이미 로그인한 기기는 그대로 둔다
create or replace function _verify(p_staff_id bigint, p_pin text)
returns staff language sql security definer set search_path = public as $$
  select s.* from staff s
   where s.id = p_staff_id
     and ( exists (select 1 from staff_sessions ss
                    where ss.staff_id = s.id and ss.token_hash = _token_hash(p_pin))
           or (s.pin is not null and s.pin = p_pin) );
$$;

-- 4) PIN 이 바뀌면 다른 기기 로그인 해제 (지금 이 기기는 유지)
create or replace function set_my_pin(p_staff_id bigint, p_pin text, p_new_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; np text;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception '현재 PIN이 올바르지 않습니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then raise exception '새 PIN은 6자리 숫자로 입력하세요'; end if;
  update staff set pin = np, pin_temp = false where id = p_staff_id;
  delete from staff_sessions where staff_id = p_staff_id and token_hash <> _token_hash(p_pin);
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
  update staff set pin = np, pin_temp = false where id = p_target_id;
  delete from staff_sessions where staff_id = p_target_id and token_hash <> _token_hash(p_pin);
end; $$;

-- 5) 관리자 전용 스태프 목록 (PIN 유무 · 잠김 · 임시 PIN 여부)
create or replace function admin_staff_directory(p_admin_id bigint, p_pin text)
returns table(id bigint, name text, is_admin boolean, has_pin boolean, locked boolean, pin_temp boolean)
language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  return query select s.id, s.name, s.is_admin, (s.pin is not null),
                      coalesce(s.locked, false), coalesce(s.pin_temp, false)
                 from staff s order by s.name;
end; $$;

-- 6) 프로필 사진 : 우리 avatars 버킷 주소만 저장
create or replace function set_my_avatar(p_staff_id bigint, p_pin text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; u text;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  u := nullif(trim(p_url), '');
  if u is not null and u !~ '^https://izpotztbvjazfvcntqyh\.supabase\.co/storage/v1/object/public/avatars/[0-9]+-[0-9]+\.jpg$' then
    raise exception '사진 주소가 올바르지 않습니다'; end if;
  update staff set avatar_url = u where id = p_staff_id;
end; $$;

-- avatars 버킷 : jpeg · 1MB 이하, 파일 이름은 '<id>-<시각>.jpg' 만
update storage.buckets set allowed_mime_types = array['image/jpeg'], file_size_limit = 1048576
 where id = 'avatars';
drop policy if exists "avatars_insert" on storage.objects;
create policy "avatars_insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'avatars' and name ~ '^[0-9]+-[0-9]+\.jpg$');

-- 7) 권한 : 내부 헬퍼와 앱에서 안 쓰는 함수는 외부 호출 차단
revoke execute on function _verify(bigint, text), _token_hash(text),
  claim_shift(bigint, text, bigint), delete_push_subscription(text), my_instagram(bigint, text)
  from public, anon, authenticated;
grant execute on function staff_signin(text, text), staff_signout(bigint, text),
  admin_staff_directory(bigint, text), set_my_pin(bigint, text, text),
  admin_set_pin(bigint, text, bigint, text), set_my_avatar(bigint, text, text)
  to anon, authenticated;
