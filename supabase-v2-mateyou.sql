-- 메이트유로 로그인 (2026-11-07)
-- 메이트유 서버가 서명한 1회용 티켓(HS256 JWT, 2분)을 받아요.
--   claims: iss 'mateyou', aud 'moetable', sub 메이트유 회원 id(uuid), pp 파트너+ 여부(true), state, jti, iat, exp
--   PKCE 처럼: 브라우저가 비밀값 v(64 hex)를 갖고, 메이트유에는 state = sha256(v) 앞 32자만 보내요.
--   티켓을 쓰려면 v 가 있어야 해요 → 티켓을 가로채도 시작한 브라우저가 아니면 못 써요.
--   연결된 직원이면 바로 세션 토큰, 아니면 연결표(10분)를 돌려줘요.
--   연결표 + 이름 · PIN → 기존 계정에 연결 / 연결표 + 한글 닉네임 → 새로 가입 (PIN 없음, 관리자 아님).
--   연결할 때의 PIN 지문(mateyou_pin_tag)을 남겨요. PIN 이 바뀌면(본인 변경 · 관리자 재설정 · 지움) 연결이 풀려요.
--   홈 화면 앱(iOS)은 메이트유를 따로 뜨는 브라우저에서 열어 저장소가 달라요. 그 브라우저는 결과를 state 로 맡기고
--   (mateyou_signin(티켓, null)) 무작위 숫자 4자리를 보여줘요. 앱으로 돌아와 그 숫자를 넣으면 mateyou_claim(v, 숫자) 로 찾아가요.
--   숫자는 남이 보낸 링크로 들어온 사람의 결과를 링크 보낸 사람이 가져가지 못하게 막아요 (5번 틀리면 지워요).
-- 서명 키는 vault 의 'mateyou_link_secret' 에만 있어요 (메이트유 서버 MOETABLE_LINK_SECRET 과 같은 값). 이 파일에는 키를 두지 않아요.
-- 적용: begin; … commit; 으로 감싸서 db query -f. 키는 따로 vault.create_secret 으로 넣어요.

alter table public.staff add column if not exists mateyou_member_id uuid unique;
alter table public.staff add column if not exists mateyou_pin_tag text;

create table if not exists public.mateyou_used_tickets (
  jti text primary key,
  used_at timestamptz not null default now()
);
create table if not exists public.mateyou_link_tickets (
  token_hash text primary key,
  member_id uuid not null,
  expires_at timestamptz not null
);
create table if not exists public.mateyou_handoffs (
  state_hash text primary key,
  member_id uuid not null,
  code_hash text not null,
  tries int not null default 0,
  expires_at timestamptz not null
);
alter table public.mateyou_used_tickets enable row level security;
alter table public.mateyou_link_tickets enable row level security;
alter table public.mateyou_handoffs enable row level security;
revoke all on public.mateyou_used_tickets, public.mateyou_link_tickets, public.mateyou_handoffs from public, anon, authenticated;

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
     or coalesce(c->>'jti', '') = '' or coalesce(c->>'state', '') !~ '^[0-9a-f]{32}$'
     or coalesce(c->>'sub', '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
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

create or replace function public._mateyou_pin_tag(p_pin text) returns text
language sql immutable set search_path = public as $$
  select _token_hash('mateyou:' || coalesce(p_pin, ''))
$$;

-- 메이트유 회원 m 을 모에 계정으로: 연결돼 있고 PIN 이 그대로면 세션, 아니면 (PIN 이 바뀌었으면 연결을 풀고) 연결표
create or replace function public._mateyou_resolve(m uuid)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare s staff; lk text;
begin
  select * into s from staff where staff.mateyou_member_id = m;
  if s.id is not null and s.mateyou_pin_tag is not distinct from _mateyou_pin_tag(s.pin) then
    return query select s.id, s.name, s.is_admin, s.avatar_url, false, _mateyou_session(s.id), null::text, null::text;
    return;
  end if;
  if s.id is not null then
    update staff set mateyou_member_id = null, mateyou_pin_tag = null where staff.id = s.id;
  end if;
  delete from mateyou_link_tickets where expires_at < now();
  lk := 'ml_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into mateyou_link_tickets(token_hash, member_id, expires_at) values (_token_hash(lk), m, now() + interval '10 minutes');
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, lk, null::text;
end $$;

revoke execute on function public._b64url(text), public._mateyou_claims(text), public._mateyou_session(bigint),
  public._mateyou_link_member(text), public._mateyou_pin_tag(text), public._mateyou_resolve(uuid) from public, anon, authenticated;

-- 1) 메이트유에서 돌아왔을 때. p_verifier: 이 브라우저가 로그인을 시작한 곳이면 그 비밀값 v (맞으면 결과를 바로),
--    아니면 null (아이폰 홈 화면 앱이 따로 연 브라우저: state 로 맡기고 숫자를 돌려줘요)
--    PIN 잠김(failed_attempts)은 PIN 로그인만 막아요. 메이트유 로그인은 PIN 을 쓰지 않으니 막지 않아요.
drop function if exists public.mateyou_signin(text);
drop function if exists public.mateyou_signin(text, boolean);
create or replace function public.mateyou_signin(p_ticket text, p_verifier text default null)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text, code text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb; m uuid; cd text;
begin
  c := _mateyou_claims(p_ticket);
  if c is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text, null::text;
    return;
  end if;
  if c->'pp' is distinct from 'true'::jsonb then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '파트너+만 메이트유로 로그인할 수 있어요.'::text, null::text;
    return;
  end if;
  m := (c->>'sub')::uuid;
  if p_verifier is null then
    delete from mateyou_handoffs where expires_at < now();
    cd := lpad(((('x' || encode(extensions.gen_random_bytes(3), 'hex'))::bit(24)::int) % 10000)::text, 4, '0');
    insert into mateyou_handoffs(state_hash, member_id, code_hash, tries, expires_at)
      values (_token_hash(c->>'state'), m, _token_hash((c->>'state') || ':' || cd), 0, now() + interval '5 minutes')
      on conflict (state_hash) do update set member_id = excluded.member_id, code_hash = excluded.code_hash, tries = 0, expires_at = excluded.expires_at;
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text, null::text, cd;
    return;
  end if;
  if p_verifier !~ '^[0-9a-f]{64}$' or left(_token_hash(p_verifier), 32) <> c->>'state' then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '메이트유 로그인을 다시 해 주세요.'::text, null::text;
    return;
  end if;
  return query select r.id, r.name, r.is_admin, r.avatar_url, r.pin_temp, r.token, r.link, r.err, null::text from _mateyou_resolve(m) r;
end $$;

-- 1b) 홈 화면 앱: 메이트유 브라우저에 뜬 숫자 + 이 앱의 비밀값 v 로 맡겨 둔 결과 찾아가기. 맡긴 게 없으면 빈 결과
drop function if exists public.mateyou_claim(text, text);
create or replace function public.mateyou_claim(p_verifier text, p_code text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare h mateyou_handoffs; st text;
begin
  if coalesce(p_verifier, '') !~ '^[0-9a-f]{64}$' or coalesce(p_code, '') !~ '^[0-9]{4}$' then return; end if;
  st := left(_token_hash(p_verifier), 32);
  select * into h from mateyou_handoffs where state_hash = _token_hash(st) and expires_at > now() for update;
  if h.state_hash is null then return; end if;
  if h.code_hash <> _token_hash(st || ':' || p_code) then
    if h.tries + 1 >= 5 then
      delete from mateyou_handoffs where state_hash = h.state_hash;
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
        '숫자를 5번 틀렸어요. 메이트유 로그인을 다시 해 주세요.'::text;
    else
      update mateyou_handoffs set tries = tries + 1 where state_hash = h.state_hash;
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
        '숫자가 맞지 않아요.'::text;
    end if;
    return;
  end if;
  delete from mateyou_handoffs where state_hash = h.state_hash;
  return query select r.id, r.name, r.is_admin, r.avatar_url, r.pin_temp, r.token, r.link, r.err from _mateyou_resolve(h.member_id) r;
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
    -- PIN 을 아는 사람이 이 이름의 연결을 정해요: 이 메이트유가 다른 이름에 붙어 있었으면 떼고, 이 이름에 다른 메이트유가 있었으면 바꿔요
    update staff set mateyou_member_id = null, mateyou_pin_tag = null where staff.mateyou_member_id = m and staff.id <> s.id;
    update staff set failed_attempts = 0, mateyou_member_id = m, mateyou_pin_tag = _mateyou_pin_tag(s.pin) where staff.id = s.id;
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
exception when unique_violation then
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
    '잠시 뒤 다시 시도해 주세요.'::text;
end $$;

-- 3) PIN 이 없는 사람: 한글 닉네임으로 새로 가입 (PIN 없음, 관리자 아님)
create or replace function public.mateyou_join(p_link text, p_name text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare m uuid; nm text := btrim(coalesce(p_name, '')); s staff; cn text;
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
  insert into staff(name, pin, is_admin, mateyou_member_id, mateyou_pin_tag) values (nm, null, false, m, _mateyou_pin_tag(null)) returning * into s;
  delete from mateyou_link_tickets where member_id = m;
  return query select s.id, s.name, s.is_admin, s.avatar_url, false, _mateyou_session(s.id), null::text;
exception when unique_violation then
  get stacked diagnostics cn = constraint_name;
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
    case when cn = 'staff_name_key' then '이미 있는 닉네임이에요.' else '이 메이트유 계정은 이미 가입돼 있어요. 다시 로그인해 주세요.' end;
end $$;

revoke execute on function public.mateyou_signin(text, text), public.mateyou_claim(text, text), public.mateyou_link(text, text, text), public.mateyou_join(text, text) from public;
grant execute on function public.mateyou_signin(text, text), public.mateyou_claim(text, text), public.mateyou_link(text, text, text), public.mateyou_join(text, text) to anon, authenticated;
