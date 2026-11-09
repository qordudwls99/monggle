-- 메이트유로 로그인 (2026-11-07) + 파트너+ 동기화 · 관리자 예외 (2026-11-09)
-- 메이트유 서버가 서명한 1회용 티켓(HS256 JWT, 2분)을 받아요.
--   claims: iss 'mateyou', aud 'moetable', sub 메이트유 회원 id(uuid), pp 파트너+ 여부(true/false), state, jti, iat, exp
--   PKCE 처럼: 브라우저가 비밀값 v(64 hex)를 갖고, 메이트유에는 state = sha256(v) 앞 32자만 보내요.
--   티켓을 쓰려면 v 가 있어야 해요 → 티켓을 가로채도 시작한 브라우저가 아니면 못 써요.
--   연결된 직원이면 바로 세션 토큰, 아니면 연결표(10분)를 돌려줘요.
--   연결표 + 이름 · PIN → 기존 계정에 연결 / 연결표 + 한글 닉네임 → 새로 가입 (PIN 없음, 관리자 아님).
--   연결할 때의 PIN 지문(mateyou_pin_tag)을 남겨요. PIN 이 바뀌면(본인 변경 · 관리자 재설정 · 지움) 연결이 풀려요.
--   홈 화면 앱(iOS)은 메이트유를 따로 뜨는 브라우저에서 열어 저장소가 달라요. 그 브라우저는 결과를 state 로 맡기고
--   (mateyou_signin(티켓, null)) 무작위 숫자 4자리를 보여줘요. 앱으로 돌아와 그 숫자를 넣으면 mateyou_claim(v, 숫자) 로 찾아가요.
--   숫자는 남이 보낸 링크로 들어온 사람의 결과를 링크 보낸 사람이 가져가지 못하게 막아요 (5번 틀리면 지워요).
-- 파트너+ (2026-11-09, 사장님 결정)
--   파트너+가 아니면(pp=false) 관리자만 메이트유로 연결 · 로그인할 수 있어요. 새로 가입은 파트너+만.
--   메이트유가 바뀔 때마다 + 10분마다 파트너+ 회원 목록을 서명해서 보내요(mateyou_partner_sync).
--   연결된 직원이 목록에 없으면 mateyou_pp = false: 관리자가 아니면 모든 세션을 끊고 PIN 로그인까지 막아요(정지).
--   다시 목록에 들어오면(또는 파트너+ 티켓으로 로그인하면) 저절로 풀려요.
--   staff_signin 은 supabase-security.sql 의 정의에 정지 확인만 더해 여기서 다시 만들어요(이 파일이 최신).
-- 메이트유 이름 · 사진 (2026-11-09, 사장님 결정 "사진 없을 때만 자동")
--   티켓에 nm(메이트유 이름)과 img(메이트유 프로필 사진 주소, 없으면 null)가 더 붙어요. 예전 티켓(키 없음)은 아무것도 바꾸지 않아요.
--   img 는 메이트유 사진 주소(img.mateyou.me 등 /profile-images/)만 받고, 아니면 없는 것으로 봐요(로그인은 막지 않아요).
--   모에 사진(avatar_url)이 비었거나 메이트유 사진이면 메이트유 사진을 따라가요. 직접 올린 사진은 건드리지 않아요.
--   이름 · 사진은 본인 내 정보(my_profile)에만 나가요. 연결이 풀리면 지워요. use_mateyou_avatar 로 메이트유 사진으로 바꿀 수 있어요.
--   my_profile 은 supabase-update.sql 의 정의에 메이트유 정보만 더해 여기서 다시 만들어요.
-- 서명 키는 vault 에만 있어요: 'mateyou_link_secret'(로그인 티켓, 메이트유 MOETABLE_LINK_SECRET),
--   'mateyou_push_secret'(파트너+ 동기화, 메이트유 MOETABLE_PUSH_SECRET). 이 파일에는 키를 두지 않아요.
-- 적용: begin; … commit; 으로 감싸서 db query -f. 키는 따로 vault.create_secret 으로 넣어요.

alter table public.staff add column if not exists mateyou_member_id uuid unique;
alter table public.staff add column if not exists mateyou_pin_tag text;
alter table public.staff add column if not exists mateyou_pp boolean;   -- 연결된 메이트유 회원의 파트너+ 여부 (모르면 null)
alter table public.staff add column if not exists mateyou_name text;    -- 연결된 메이트유 이름 (본인 내 정보에만)
alter table public.staff add column if not exists mateyou_avatar text;  -- 연결된 메이트유 프로필 사진 주소

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
alter table public.mateyou_link_tickets add column if not exists pp boolean not null default true;
alter table public.mateyou_handoffs add column if not exists pp boolean not null default true;
alter table public.mateyou_link_tickets add column if not exists prof jsonb;   -- 티켓의 {nm, img} (예전 티켓이면 null)
alter table public.mateyou_handoffs add column if not exists prof jsonb;
create table if not exists public.mateyou_sync_state (
  id int primary key default 1 check (id = 1),
  last_ts bigint not null default 0,
  synced_at timestamptz
);
alter table public.mateyou_used_tickets enable row level security;
alter table public.mateyou_link_tickets enable row level security;
alter table public.mateyou_handoffs enable row level security;
alter table public.mateyou_sync_state enable row level security;
revoke all on public.mateyou_used_tickets, public.mateyou_link_tickets, public.mateyou_handoffs, public.mateyou_sync_state from public, anon, authenticated;

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

-- 파트너+ 동기화 토큰 검사: 서명(mateyou_push_secret) · typ 'pp_sync' · 만료 · 한 번만
create or replace function public._mateyou_push_claims(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare parts text[]; k text; sig text; h jsonb; c jsonb;
begin
  parts := string_to_array(coalesce(p_token, ''), '.');
  if coalesce(array_length(parts, 1), 0) <> 3 then return null; end if;
  select decrypted_secret into k from vault.decrypted_secrets where name = 'mateyou_push_secret';
  if k is null then return null; end if;
  sig := rtrim(translate(encode(extensions.hmac(parts[1] || '.' || parts[2], k, 'sha256'), 'base64'), '+/', '-_'), '=');
  if sig <> parts[3] then return null; end if;
  begin
    h := convert_from(_b64url(parts[1]), 'UTF8')::jsonb;
    c := convert_from(_b64url(parts[2]), 'UTF8')::jsonb;
  exception when others then return null;
  end;
  if h->>'alg' is distinct from 'HS256' or c->>'iss' is distinct from 'mateyou' or c->>'aud' is distinct from 'moetable'
     or c->>'typ' is distinct from 'pp_sync' or coalesce(c->>'jti', '') = ''
     or jsonb_typeof(c->'exp') is distinct from 'number' or (c->>'exp')::numeric < extract(epoch from now())
     or jsonb_typeof(c->'ts') is distinct from 'number' or jsonb_typeof(c->'active') is distinct from 'array' then
    return null;
  end if;
  delete from mateyou_used_tickets where used_at < now() - interval '1 day';
  insert into mateyou_used_tickets(jti) values ('sync:' || (c->>'jti')) on conflict do nothing;
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

-- 연결표 → (member_id, pp). 없거나 지났으면 member_id 가 null
drop function if exists public._mateyou_link_member(text);
create or replace function public._mateyou_link_member(p_link text) returns mateyou_link_tickets
language sql security definer set search_path = public as $$
  select * from mateyou_link_tickets
   where token_hash = _token_hash(coalesce(p_link, '')) and expires_at > now()
$$;

create or replace function public._mateyou_pin_tag(p_pin text) returns text
language sql immutable set search_path = public as $$
  select _token_hash('mateyou:' || coalesce(p_pin, ''))
$$;

-- 메이트유 프로필 사진 주소인가요 (메이트유 서버 publicAvatarUrl 이 주는 곳 + 옛 S3)
create or replace function public._mateyou_is_img(u text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(char_length(u) <= 500
    and u ~ '^https://(img\.mateyou\.me|api\.mateyou\.me|www\.mateyou\.me|mateyou-media\.s3\.ap-northeast-2\.amazonaws\.com)/([^/?#[:space:]"''<>\\]+/)*profile-images/[^?#[:space:]"''<>\\]+$', false)
$$;

-- 티켓 claims → {nm, img} (티켓에 있던 키만). 둘 다 없으면 null (예전 티켓)
create or replace function public._mateyou_prof(c jsonb) returns jsonb
language plpgsql immutable set search_path = public as $$
declare o jsonb := '{}'::jsonb; n text; u text;
begin
  if c ? 'nm' then
    if jsonb_typeof(c->'nm') = 'string' then n := left(btrim(regexp_replace(c->>'nm', '[[:cntrl:]]', '', 'g')), 40); end if;
    o := o || jsonb_build_object('nm', nullif(n, ''));
  end if;
  if c ? 'img' then
    if jsonb_typeof(c->'img') = 'string' and _mateyou_is_img(c->>'img') then u := c->>'img'; end if;
    o := o || jsonb_build_object('img', u);
  end if;
  return nullif(o, '{}'::jsonb);
end $$;

-- 이름 · 사진 반영. 모에 사진이 비었거나 메이트유 사진이면 새 메이트유 사진을 따라가요 (없어졌으면 비워요)
create or replace function public._mateyou_apply_prof(p_id bigint, p jsonb) returns void
language sql security definer set search_path = public as $$
  update staff set
    mateyou_name = case when p ? 'nm' then p->>'nm' else staff.mateyou_name end,
    mateyou_avatar = case when p ? 'img' then p->>'img' else staff.mateyou_avatar end,
    avatar_url = case when p ? 'img' and (coalesce(staff.avatar_url, '') = '' or _mateyou_is_img(staff.avatar_url))
                      then p->>'img' else staff.avatar_url end
   where staff.id = p_id and p is not null
$$;

-- 메이트유 회원 m 을 모에 계정으로: 연결돼 있고 PIN 이 그대로면 세션(파트너+가 아니면 관리자만), 아니면 (PIN 이 바뀌었으면 연결을 풀고) 연결표
drop function if exists public._mateyou_resolve(uuid);
drop function if exists public._mateyou_resolve(uuid, boolean);
create or replace function public._mateyou_resolve(m uuid, p_pp boolean, p_prof jsonb)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text, pp boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare s staff; lk text; av text;
begin
  select * into s from staff where staff.mateyou_member_id = m;
  if s.id is not null and s.mateyou_pin_tag is not distinct from _mateyou_pin_tag(s.pin) then
    update staff set mateyou_pp = p_pp where staff.id = s.id;
    if not p_pp and not coalesce(s.is_admin, false) then
      delete from staff_sessions where staff_sessions.staff_id = s.id;
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
        '파트너+만 메이트유로 로그인할 수 있어요.'::text, p_pp;
      return;
    end if;
    perform _mateyou_apply_prof(s.id, p_prof);
    select staff.avatar_url into av from staff where staff.id = s.id;
    return query select s.id, s.name, s.is_admin, av, false, _mateyou_session(s.id), null::text, null::text, p_pp;
    return;
  end if;
  if s.id is not null then
    update staff set mateyou_member_id = null, mateyou_pin_tag = null, mateyou_pp = null, mateyou_name = null, mateyou_avatar = null
     where staff.id = s.id;
  end if;
  delete from mateyou_link_tickets where expires_at < now();
  lk := 'ml_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into mateyou_link_tickets(token_hash, member_id, expires_at, pp, prof) values (_token_hash(lk), m, now() + interval '10 minutes', p_pp, p_prof);
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, lk, null::text, p_pp;
end $$;

revoke execute on function public._b64url(text), public._mateyou_claims(text), public._mateyou_push_claims(text), public._mateyou_session(bigint),
  public._mateyou_link_member(text), public._mateyou_pin_tag(text), public._mateyou_is_img(text), public._mateyou_prof(jsonb),
  public._mateyou_apply_prof(bigint, jsonb), public._mateyou_resolve(uuid, boolean, jsonb) from public, anon, authenticated;

-- 1) 메이트유에서 돌아왔을 때. p_verifier: 이 브라우저가 로그인을 시작한 곳이면 그 비밀값 v (맞으면 결과를 바로),
--    아니면 null (아이폰 홈 화면 앱이 따로 연 브라우저: state 로 맡기고 숫자를 돌려줘요)
--    PIN 잠김(failed_attempts)은 PIN 로그인만 막아요. 메이트유 로그인은 PIN 을 쓰지 않으니 막지 않아요.
drop function if exists public.mateyou_signin(text);
drop function if exists public.mateyou_signin(text, boolean);
drop function if exists public.mateyou_signin(text, text);
create or replace function public.mateyou_signin(p_ticket text, p_verifier text default null)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text, code text, pp boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb; m uuid; cd text; ppv boolean; pf jsonb;
begin
  c := _mateyou_claims(p_ticket);
  if c is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text, null::text, null::boolean;
    return;
  end if;
  ppv := coalesce(c->'pp' = 'true'::jsonb, false);
  m := (c->>'sub')::uuid;
  pf := _mateyou_prof(c);
  if p_verifier is null then
    delete from mateyou_handoffs where expires_at < now();
    cd := lpad(((('x' || encode(extensions.gen_random_bytes(3), 'hex'))::bit(24)::int) % 10000)::text, 4, '0');
    insert into mateyou_handoffs(state_hash, member_id, code_hash, tries, expires_at, pp, prof)
      values (_token_hash(c->>'state'), m, _token_hash((c->>'state') || ':' || cd), 0, now() + interval '5 minutes', ppv, pf)
      on conflict (state_hash) do update set member_id = excluded.member_id, code_hash = excluded.code_hash, tries = 0,
        expires_at = excluded.expires_at, pp = excluded.pp, prof = excluded.prof;
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text, null::text, cd, null::boolean;
    return;
  end if;
  if p_verifier !~ '^[0-9a-f]{64}$' or left(_token_hash(p_verifier), 32) <> c->>'state' then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
      '메이트유 로그인을 다시 해 주세요.'::text, null::text, null::boolean;
    return;
  end if;
  return query select r.id, r.name, r.is_admin, r.avatar_url, r.pin_temp, r.token, r.link, r.err, null::text, r.pp from _mateyou_resolve(m, ppv, pf) r;
end $$;

-- 1b) 홈 화면 앱: 메이트유 브라우저에 뜬 숫자 + 이 앱의 비밀값 v 로 맡겨 둔 결과 찾아가기. 맡긴 게 없으면 빈 결과
drop function if exists public.mateyou_claim(text, text);
create or replace function public.mateyou_claim(p_verifier text, p_code text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, link text, err text, pp boolean)
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
        '숫자를 5번 틀렸어요. 메이트유 로그인을 다시 해 주세요.'::text, null::boolean;
    else
      update mateyou_handoffs set tries = tries + 1 where state_hash = h.state_hash;
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text, null::text,
        '숫자가 맞지 않아요.'::text, null::boolean;
    end if;
    return;
  end if;
  delete from mateyou_handoffs where state_hash = h.state_hash;
  return query select r.id, r.name, r.is_admin, r.avatar_url, r.pin_temp, r.token, r.link, r.err, r.pp from _mateyou_resolve(h.member_id, h.pp, h.prof) r;
end $$;

-- 2) PIN 이 있는 사람: 이름 · PIN 으로 기존 계정에 연결. 틀린 PIN 은 staff_signin 과 똑같이 셉니다 (5번이면 잠김)
--    파트너+가 아니면(연결표 pp=false) 관리자 계정만 연결돼요
create or replace function public.mateyou_link(p_link text, p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare t mateyou_link_tickets; m uuid; s staff; n int; av text;
begin
  t := _mateyou_link_member(p_link);
  m := t.member_id;
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
    if not t.pp and not coalesce(s.is_admin, false) then
      update staff set failed_attempts = 0 where staff.id = s.id;
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
        '파트너+만 메이트유로 연결할 수 있어요.'::text;
      return;
    end if;
    -- PIN 을 아는 사람이 이 이름의 연결을 정해요: 이 메이트유가 다른 이름에 붙어 있었으면 떼고, 이 이름에 다른 메이트유가 있었으면 바꿔요
    update staff set mateyou_member_id = null, mateyou_pin_tag = null, mateyou_pp = null, mateyou_name = null, mateyou_avatar = null
     where staff.mateyou_member_id = m and staff.id <> s.id;
    update staff set failed_attempts = 0, mateyou_member_id = m, mateyou_pin_tag = _mateyou_pin_tag(s.pin), mateyou_pp = t.pp,
                     mateyou_name = case when staff.mateyou_member_id = m then staff.mateyou_name end,
                     mateyou_avatar = case when staff.mateyou_member_id = m then staff.mateyou_avatar end
     where staff.id = s.id;
    perform _mateyou_apply_prof(s.id, t.prof);
    select staff.avatar_url into av from staff where staff.id = s.id;
    delete from mateyou_link_tickets where member_id = m;
    return query select s.id, s.name, s.is_admin, av, coalesce(s.pin_temp, false), _mateyou_session(s.id), null::text;
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

-- 3) PIN 이 없는 사람: 한글 닉네임으로 새로 가입 (PIN 없음, 관리자 아님, 파트너+만)
create or replace function public.mateyou_join(p_link text, p_name text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare t mateyou_link_tickets; m uuid; nm text := btrim(coalesce(p_name, '')); s staff; cn text;
begin
  if nm !~ '^[가-힣]{1,8}$' then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '닉네임은 한글로만 8자까지 써 주세요.'::text;
    return;
  end if;
  t := _mateyou_link_member(p_link);
  m := t.member_id;
  if m is null then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '메이트유 로그인 시간이 지났어요. 다시 시도해 주세요.'::text;
    return;
  end if;
  if not t.pp then
    return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
      '파트너+만 새로 가입할 수 있어요.'::text;
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
  insert into staff(name, pin, is_admin, mateyou_member_id, mateyou_pin_tag, mateyou_pp) values (nm, null, false, m, _mateyou_pin_tag(null), true) returning * into s;
  perform _mateyou_apply_prof(s.id, t.prof);
  select * into s from staff where staff.id = s.id;
  delete from mateyou_link_tickets where member_id = m;
  return query select s.id, s.name, s.is_admin, s.avatar_url, false, _mateyou_session(s.id), null::text;
exception when unique_violation then
  get stacked diagnostics cn = constraint_name;
  return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
    case when cn = 'staff_name_key' then '이미 있는 닉네임이에요.' else '이 메이트유 계정은 이미 가입돼 있어요. 다시 로그인해 주세요.' end;
end $$;

-- 4) 메이트유 → 파트너+ 동기화 (바뀔 때 + 10분마다). active: 지금 파트너+인 메이트유 회원 전부
--    연결된 직원의 mateyou_pp 를 맞추고, 파트너+가 아닌 관리자 아닌 직원은 세션을 모두 끊어요(정지).
--    빈 목록은 받지 않아요(메이트유 쪽 오류로 모두 정지되는 일을 막아요). 예전 것(ts 가 작거나 같음)은 무시.
create or replace function public.mateyou_partner_sync(p_token text)
returns table(linked int, active int, suspended int, revoked int, err text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare c jsonb; act uuid[]; t bigint; n_r int;
begin
  c := _mateyou_push_claims(p_token);
  if c is null then
    return query select null::int, null::int, null::int, null::int, 'bad token'::text;
    return;
  end if;
  select coalesce(array_agg(distinct lower(x.v)::uuid), '{}') into act
    from jsonb_array_elements_text(c->'active') as x(v)
   where x.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  if cardinality(act) = 0 then
    return query select null::int, null::int, null::int, null::int, 'empty'::text;
    return;
  end if;
  t := (c->>'ts')::bigint;
  insert into mateyou_sync_state(id) values (1) on conflict do nothing;
  perform 1 from mateyou_sync_state where mateyou_sync_state.id = 1 and mateyou_sync_state.last_ts < t for update;
  if not found then
    return query select null::int, null::int, null::int, null::int, 'stale'::text;
    return;
  end if;
  -- PIN 이 바뀌어 무효가 된 연결은 풀어요 (정지도 같이 풀려요)
  update staff set mateyou_member_id = null, mateyou_pin_tag = null, mateyou_pp = null, mateyou_name = null, mateyou_avatar = null
   where staff.mateyou_member_id is not null and staff.mateyou_pin_tag is distinct from _mateyou_pin_tag(staff.pin);
  update staff set mateyou_pp = (staff.mateyou_member_id = any(act))
   where staff.mateyou_member_id is not null and staff.mateyou_pp is distinct from (staff.mateyou_member_id = any(act));
  delete from staff_sessions ss using staff s
   where ss.staff_id = s.id and s.mateyou_pp = false and not coalesce(s.is_admin, false);
  get diagnostics n_r = row_count;
  update mateyou_sync_state set last_ts = t, synced_at = now() where mateyou_sync_state.id = 1;
  return query select count(*) filter (where s.mateyou_member_id is not null)::int,
                      count(*) filter (where s.mateyou_pp)::int,
                      count(*) filter (where s.mateyou_pp = false and not coalesce(s.is_admin, false))::int,
                      n_r, null::text
                 from staff s;
end $$;

-- 5) PIN 로그인 (supabase-security.sql 의 staff_signin 그대로 + 파트너+ 정지 확인)
--    정지: 메이트유와 연결(PIN 지문이 그대로)돼 있고 파트너+가 아니며 관리자가 아닌 직원
create or replace function public.staff_signin(p_name text, p_pin text)
returns table(id bigint, name text, is_admin boolean, avatar_url text, pin_temp boolean, token text, err text)
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
    if s.mateyou_pp is false and not coalesce(s.is_admin, false) and s.mateyou_member_id is not null
       and s.mateyou_pin_tag is not distinct from _mateyou_pin_tag(s.pin) then
      return query select null::bigint, null::text, null::boolean, null::text, null::boolean, null::text,
        '파트너+가 해제돼 로그인할 수 없어요. 관리자에게 문의하세요.'::text;
      return;
    end if;
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
end $$;

-- 6) 내 정보 (supabase-update.sql 의 my_profile 그대로 + 메이트유). 연결(PIN 지문이 그대로)돼 있을 때만 mateyou 가 나가요
create or replace function public.my_profile(p_staff_id bigint, p_pin text)
returns json language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  return json_build_object('name',v.name,'instagram',v.instagram,'avatar_url',v.avatar_url,'is_admin',v.is_admin,
    'mateyou', case when v.mateyou_member_id is not null and v.mateyou_pin_tag is not distinct from _mateyou_pin_tag(v.pin)
                    then json_build_object('name', v.mateyou_name, 'pp', v.mateyou_pp, 'avatar', v.mateyou_avatar) end);
end; $$;

-- 7) 메이트유 사진 쓰기: 저장된 메이트유 사진으로 바꿔요 (주소는 서버가 정해요). 바뀐 주소를 돌려줘요
create or replace function public.use_mateyou_avatar(p_staff_id bigint, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  if v.mateyou_member_id is null or v.mateyou_pin_tag is distinct from _mateyou_pin_tag(v.pin) or v.mateyou_avatar is null then
    raise exception '메이트유 사진이 없어요'; end if;
  update staff set avatar_url = v.mateyou_avatar where staff.id = v.id;
  return v.mateyou_avatar;
end; $$;

revoke execute on function public.mateyou_signin(text, text), public.mateyou_claim(text, text), public.mateyou_link(text, text, text),
  public.mateyou_join(text, text), public.mateyou_partner_sync(text), public.use_mateyou_avatar(bigint, text) from public;
grant execute on function public.mateyou_signin(text, text), public.mateyou_claim(text, text), public.mateyou_link(text, text, text),
  public.mateyou_join(text, text), public.mateyou_partner_sync(text), public.use_mateyou_avatar(bigint, text) to anon, authenticated;
