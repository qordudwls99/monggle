-- 메이트유로 로그인 (2026-11-07)
-- 메이트유 서버가 서명한 1회용 티켓(HS256 JWT, 2분)을 받아요.
--   claims: iss 'mateyou', aud 'moetable', sub 메이트유 회원 id(uuid), pp 파트너+ 여부(true), state, jti, iat, exp
--   연결된 직원이면 바로 세션 토큰, 아니면 연결표(10분)를 돌려줘요.
--   연결표 + 이름 · PIN → 기존 계정에 연결 / 연결표 + 한글 닉네임 → 새로 가입 (PIN 없음, 관리자 아님).
-- 서명 키는 vault 의 'mateyou_link_secret' 에만 있어요 (메이트유 서버 MOETABLE_LINK_SECRET 과 같은 값). 이 파일에는 키를 두지 않아요.
-- 적용: begin; … commit; 으로 감싸서 db query -f. 키는 따로 vault.create_secret 으로 넣어요.

alter table public.staff add column if not exists mateyou_member_id uuid unique;

create table if not exists public.mateyou_used_tickets (
  jti text primary key,
  used_at timestamptz not null default now()
);
create table if not exists public.mateyou_link_tickets (
  token_hash text primary key,
  member_id uuid not null,
  expires_at timestamptz not null
);
alter table public.mateyou_used_tickets enable row level security;
alter table public.mateyou_link_tickets enable row level security;
revoke all on public.mateyou_used_tickets, public.mateyou_link_tickets from public, anon, authenticated;

-- base64url → bytea
create or replace function public._b64url(p text) returns bytea
language sql immutable set search_path = public as $$
  select decode(rpad(translate(p, '-_', '+/'), (char_length(p) + 3) / 4 * 4, '='), 'base64')
$$;

-- 티켓 검사: 서명 · 발급처 · 받는 곳 · 만료 · 한 번만. 통과하면 claims, 아니면 null
create or replace function public._mateyou_claims(p_ticket text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare parts text[]; k text; sig text; h jsonb; c jsonb;
begin
  parts := string_to_array(coalesce(p_ticket, ''), '.');
  if coalesce(array_length(parts, 1), 0) <> 3 then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'mateyou_link_secret';
  if k is null then return null; end if;
  sig := rtrim(translate(encode(extensions.hmac(parts[1] || '.' || parts[2], k, 'sha256'), 'base64'), '+/', '-_'), '=');
  if sig <> parts[3] then return null; end if;
  begin
    h := convert_from(_b64url(parts[1]), 'UTF8')::jsonb;
    c := convert_from(_b64url(parts[2]), 'UTF8')::jsonb;
  exception when others then return null;
  end;
  if h->>'alg' is distinct from 'HS256' or c->>'iss' is distinct from 'mateyou' or c->>'aud' is distinct from 'moetable'
     or jsonb_typeof(c->'exp') is distinct from 'number' or (c->>'exp')::numeric < extract(epoch from now())
     or coalesce(c->>'jti', '') = '' or coalesce(c->>'sub', '') !~ '^[0-9a-fA-F-]{36}$' then
    return null;
  end if;
  delete from mateyou_used_tickets where used_at < now() - interval '1 day';
  insert into mateyou_used_tickets(jti) values (c->>'jti') on conflict do nothing;
  if not found then return null; end if;
  return c;
end $$;

create or replace function public._mateyou_session(p_staff_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare tk text := 'tk_' || encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into staff_sessions(token_hash, staff_id) values (_token_hash(tk), p_staff_id);
  return tk;
end $$;

create or replace function public._mateyou_link_member(p_link text) returns uuid
language sql security definer set search_path = public as $$
  select member_id from mateyou_link_tickets
   where token_hash = _token_hash(coalesce(p_link, '')) and expires_at > now()
$$;

revoke execute on function public._b64url(text), public._mateyou_claims(text), public._mateyou_session(bigint),
  public._mateyou_link_member(text) from public, anon, authenticated;

-- 1) 메이트유에서 돌아왔을 때. 연결돼 있으면 token, 아니면 link(연결표)
--    PIN 잠김(failed_attempts)은 PIN 로그인만 막아요. 메이트유 로그인은 PIN 을 쓰지 않으니 막지 않아요.
create or replace function public.mateyou_signin(p_ticket text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb; m uuid; s staff; lk text;
begin
  c := _mateyou_claims(p_ticket);
  if c is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text;
    return;
  end if;
  if c->'pp' is distinct from 'true'::jsonb then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '파트너+만 메이트유로 로그인할 수 있어요.'::text;
    return;
  end if;
  m := (c->>'sub')::uuid;
  select * into s from staff where staff.mateyou_member_id = m;
  if s.id is not null then
    return query select s.id, s.name, s.is_admin, s.avatar_url, false, _mateyou_session(s.id), null::text, null::text;
    return;
  end if;
  delete from mateyou_link_tickets where expires_at < now();
  lk := 'ml_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into mateyou_link_tickets(token_hash, member_id, expires_at) values (_token_hash(lk), m, now() + interval '10 minutes');
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, lk, null::text;
end $$;

-- 2) PIN 이 있는 사람: 이름 · PIN 으로 기존 계정에 연결. 틀린 PIN 은 staff_signin 과 똑같이 셉니다 (5번이면 잠김)
create or replace function public.mateyou_link(p_link text, p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare m uuid; s staff; n int;
begin
  m := _mateyou_link_member(p_link);
  if m is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text;
    return;
  end if;
  select * into s from staff where staff.name = btrim(coalesce(p_name, '')) for update;
  if s.id is null then return; end if;                       -- 이름 없음 → 빈 결과 (staff_signin 과 같아요)
  if s.locked then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '계정이 잠겼어요. 관리자에게 문의하세요.'::text;
    return;
  end if;
  if s.pin is not null and s.pin = p_pin then
    if s.mateyou_member_id is not null and s.mateyou_member_id <> m then
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
        '이미 다른 메이트유 계정과 연결된 이름이에요.'::text;
      return;
    end if;
    if exists (select 1 from staff x where x.mateyou_member_id = m and x.id <> s.id) then
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
        '이 메이트유 계정은 이미 다른 이름과 연결돼 있어요.'::text;
      return;
    end if;
    update staff set failed_attempts = 0, mateyou_member_id = m where staff.id = s.id;
    delete from mateyou_link_tickets where member_id = m;
    return query select s.id, s.name, s.is_admin, s.avatar_url, coalesce(s.pin_temp, false), _mateyou_session(s.id), null::text;
  else
    update staff set failed_attempts = staff.failed_attempts + 1,
                     locked = (staff.failed_attempts + 1 >= 5)
      where staff.id = s.id
      returning staff.failed_attempts into n;
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      case when n >= 5 then '5회 틀려 계정이 잠겼어요. 관리자에게 문의하세요.'
           else format('PIN이 틀렸어요. (남은 시도 %s회)', 5 - n) end;
  end if;
end $$;

-- 3) PIN 이 없는 사람: 한글 닉네임으로 새로 가입 (PIN 없음, 관리자 아님)
create or replace function public.mateyou_join(p_link text, p_name text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare m uuid; nm text := btrim(coalesce(p_name, '')); s staff;
begin
  if nm !~ '^[가-힣]{1,8}$' then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '닉네임은 한글로만 8자까지 써 주세요.'::text;
    return;
  end if;
  m := _mateyou_link_member(p_link);
  if m is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text;
    return;
  end if;
  if exists (select 1 from staff x where x.mateyou_member_id = m) then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '이 메이트유 계정은 이미 가입돼 있어요. 다시 로그인해 주세요.'::text;
    return;
  end if;
  if exists (select 1 from staff x where x.name = nm) then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '이미 있는 닉네임이에요.'::text;
    return;
  end if;
  insert into staff(name, pin, is_admin, mateyou_member_id) values (nm, null, false, m) returning * into s;
  delete from mateyou_link_tickets where member_id = m;
  return query select s.id, s.name, s.is_admin, s.avatar_url, false, _mateyou_session(s.id), null::text;
exception when unique_violation then
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
    '이미 있는 닉네임이에요.'::text;
end $$;

revoke execute on function public.mateyou_signin(text), public.mateyou_link(text, text, text), public.mateyou_join(text, text) from public;
grant execute on function public.mateyou_signin(text), public.mateyou_link(text, text, text), public.mateyou_join(text, text) to anon, authenticated;
