-- ============================================================
--  Monggle · MateYou OIDC 로그인 전환
-- ------------------------------------------------------------
--  선행 조건
--   1) 기존 supabase-*.sql 적용 완료
--   2) Supabase Auth에 custom:mateyou OAuth provider 등록
--   3) sync-mateyou-entitlements Edge Function 배포
--
--  이 스크립트는 기존 출근 데이터와 함수 시그니처를 보존하면서
--  브라우저 PIN 세션을 Supabase Auth 세션으로 교체합니다.
-- ============================================================

begin;

-- MateYou 계정과 Monggle 출근자 레코드는 별도 생명주기를 가집니다.
-- 일반 MateYou 회원도 profile을 가질 수 있고, 직원 연결은 선택입니다.
create table if not exists public.mateyou_profiles (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  mateyou_sub             text not null unique
                          check (mateyou_sub ~ '^usr_[a-f0-9]{36}$'),
  display_name            text,
  email                   text,
  avatar_url              text,
  is_partner_plus         boolean not null default false,
  entitlements            text[] not null default array['basic']::text[],
  entitlement_checked_at  timestamptz,
  staff_id                bigint references public.staff(id) on delete set null,
  linked_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists mateyou_profiles_staff_id_unique
  on public.mateyou_profiles(staff_id)
  where staff_id is not null;

alter table public.mateyou_profiles enable row level security;
revoke all on table public.mateyou_profiles from anon, authenticated;

-- 기존 p_pin 인자는 배포 호환을 위해 남기되 더는 인증 수단으로 사용하지 않습니다.
-- SECURITY DEFINER 함수는 auth.uid()와 연결된 직원만 반환합니다.
create or replace function public._verify(p_staff_id bigint, p_pin text)
returns public.staff
language sql
stable
security definer
set search_path = public
as $$
  select s.*
    from public.staff s
    join public.mateyou_profiles p on p.staff_id = s.id
   where p.user_id = auth.uid()
     and s.id = p_staff_id;
$$;

create or replace function public._require_partner_plus()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.mateyou_profiles;
begin
  select * into p
    from public.mateyou_profiles
   where user_id = auth.uid();

  if p.user_id is null then
    raise exception '메이트유 로그인이 필요해요';
  end if;
  if p.entitlement_checked_at is null
     or p.entitlement_checked_at < now() - interval '15 minutes' then
    raise exception '파트너+ 권한을 다시 확인해 주세요';
  end if;
  if not p.is_partner_plus then
    raise exception '이 기능은 출근부 파트너+ 전용이에요';
  end if;
end;
$$;

-- 로그인 직후 화면에 필요한 계정/권한/직원 연결 정보를 한 번에 반환합니다.
create or replace function public.my_monggle_session()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.mateyou_profiles;
  s public.staff;
begin
  if auth.uid() is null then
    raise exception '메이트유 로그인이 필요해요';
  end if;

  select * into p
    from public.mateyou_profiles
   where user_id = auth.uid();

  if p.user_id is null then
    raise exception '메이트유 계정 정보를 먼저 동기화해 주세요';
  end if;

  if p.staff_id is not null then
    select * into s from public.staff where id = p.staff_id;
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'user_id', p.user_id,
      'mateyou_sub', p.mateyou_sub,
      'display_name', p.display_name,
      'email', p.email,
      'avatar_url', p.avatar_url,
      'is_partner_plus', p.is_partner_plus,
      'entitlements', p.entitlements,
      'entitlement_checked_at', p.entitlement_checked_at
    ),
    'staff', case
      when s.id is null then null
      else jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'is_admin', s.is_admin,
        'avatar_url', s.avatar_url,
        'instagram', s.instagram
      )
    end
  );
end;
$$;

-- 기존 직원 레코드는 이름+PIN으로 딱 한 번 연결합니다.
-- 실패도 JSON으로 반환해 실패 횟수/잠금 업데이트가 롤백되지 않게 합니다.
create or replace function public.claim_existing_staff(p_name text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.mateyou_profiles;
  s public.staff;
  next_attempts integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', '메이트유 로그인이 필요해요');
  end if;

  select * into p
    from public.mateyou_profiles
   where user_id = auth.uid()
   for update;

  if p.user_id is null then
    return jsonb_build_object('ok', false, 'error', '메이트유 계정 정보를 먼저 동기화해 주세요');
  end if;
  if p.staff_id is not null then
    return jsonb_build_object('ok', true, 'staff_id', p.staff_id, 'already_linked', true);
  end if;
  if nullif(trim(p_name), '') is null or p_pin !~ '^\d{6}$' then
    return jsonb_build_object('ok', false, 'error', '이름과 6자리 PIN을 확인해 주세요');
  end if;

  select * into s
    from public.staff
   where name = trim(p_name)
   for update;

  if s.id is null then
    return jsonb_build_object('ok', false, 'error', '이름 또는 PIN이 올바르지 않아요');
  end if;
  if coalesce(s.locked, false) then
    return jsonb_build_object('ok', false, 'error', '직원 계정이 잠겼어요. 관리자에게 문의해 주세요');
  end if;
  if exists (
    select 1 from public.mateyou_profiles other
     where other.staff_id = s.id
       and other.user_id <> auth.uid()
  ) then
    return jsonb_build_object('ok', false, 'error', '이미 다른 메이트유 계정에 연결된 직원이에요');
  end if;

  if s.pin is null or s.pin <> p_pin then
    next_attempts := coalesce(s.failed_attempts, 0) + 1;
    update public.staff
       set failed_attempts = next_attempts,
           locked = next_attempts >= 5
     where id = s.id;
    return jsonb_build_object(
      'ok', false,
      'error', case
        when next_attempts >= 5 then '5회 틀려 직원 계정이 잠겼어요. 관리자에게 문의해 주세요'
        else format('PIN이 틀렸어요. (남은 시도 %s회)', 5 - next_attempts)
      end
    );
  end if;

  update public.staff
     set failed_attempts = 0,
         locked = false,
         pin = null,
         pin_temp = false
   where id = s.id;

  update public.mateyou_profiles
     set staff_id = s.id,
         linked_at = now(),
         updated_at = now()
   where user_id = auth.uid();

  return jsonb_build_object('ok', true, 'staff_id', s.id, 'name', s.name);
end;
$$;

-- 민감한 관리자 조회는 공개 view 대신 인증된 관리자 RPC로만 제공합니다.
create or replace function public.admin_application_list(
  p_admin_id bigint,
  p_pin text,
  p_date date
)
returns table(
  id bigint,
  shift_id bigint,
  applicant_id bigint,
  applicant_name text,
  work_date date,
  workplace text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  v := public._verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then
    raise exception '관리자만 가능합니다';
  end if;

  return query
    select a.id, a.shift_id, a.applicant_id, st.name, sh.work_date, sh.workplace
      from public.slot_applications a
      join public.staff st on st.id = a.applicant_id
      join public.shifts sh on sh.id = a.shift_id
     where a.status = 'open'
       and (p_date is null or sh.work_date = p_date);
end;
$$;

create or replace function public.admin_submission_answers(
  p_admin_id bigint,
  p_pin text,
  p_ym text
)
returns table(
  staff_id bigint,
  staff_name text,
  ym text,
  qkey text,
  choice text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  v := public._verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then
    raise exception '관리자만 가능합니다';
  end if;

  return query
    select a.staff_id, s.name, a.ym, a.qkey, a.choice
      from public.submission_answers a
      join public.staff s on s.id = a.staff_id
     where a.ym = p_ym;
end;
$$;

create or replace function public.my_application_list(
  p_staff_id bigint,
  p_pin text,
  p_date date
)
returns table(
  id bigint,
  shift_id bigint,
  applicant_id bigint,
  applicant_name text,
  work_date date,
  workplace text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;

  return query
    select a.id, a.shift_id, a.applicant_id, v.name, sh.work_date, sh.workplace
      from public.slot_applications a
      join public.shifts sh on sh.id = a.shift_id
     where a.applicant_id = p_staff_id
       and a.status = 'open'
       and sh.work_date = p_date;
end;
$$;

-- 직원 목록은 연결된 관리자만 조회할 수 있습니다.
drop function if exists public.staff_directory();
create function public.staff_directory()
returns table(
  id bigint,
  name text,
  is_admin boolean,
  has_pin boolean,
  locked boolean,
  pin_temp boolean,
  is_linked boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  select s.* into v
    from public.mateyou_profiles p
    join public.staff s on s.id = p.staff_id
   where p.user_id = auth.uid();
  if v.id is null or not v.is_admin then
    raise exception '관리자만 가능합니다';
  end if;

  return query
    select s.id, s.name, s.is_admin, (s.pin is not null),
           coalesce(s.locked, false), coalesce(s.pin_temp, false),
           exists (
             select 1 from public.mateyou_profiles p where p.staff_id = s.id
           )
      from public.staff s
     order by s.name;
end;
$$;

create or replace function public.admin_set_default_pin(
  p_admin_id bigint,
  p_pin text,
  p_new_pin text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  np text;
  n integer;
begin
  v := public._verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  np := nullif(trim(p_new_pin), '');
  if np is null or np !~ '^\d{6}$' then
    raise exception '연결 PIN은 6자리 숫자로 입력하세요';
  end if;

  update public.staff s
     set pin = np,
         failed_attempts = 0,
         locked = false,
         pin_temp = true
   where s.pin is null
     and not exists (
       select 1 from public.mateyou_profiles p where p.staff_id = s.id
     );
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.admin_unlink_staff(
  p_admin_id bigint,
  p_pin text,
  p_target_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  v := public._verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_target_id = p_admin_id then
    raise exception '본인 연결은 다른 관리자가 해제해야 해요';
  end if;

  update public.mateyou_profiles
     set staff_id = null,
         linked_at = null,
         updated_at = now()
   where staff_id = p_target_id;
end;
$$;

-- Partner+가 필요한 출근 액션은 UI와 무관하게 DB에서 재검증합니다.
create or replace function public.request_sub(
  p_staff_id bigint,
  p_pin text,
  p_shift_id bigint,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  sh public.shifts;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  select * into sh from public.shifts where id = p_shift_id;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is distinct from p_staff_id then
    raise exception '본인 근무만 대타를 구할 수 있어요'; end if;
  if exists (
    select 1 from public.swap_requests
     where shift_id = p_shift_id and status = 'open'
  ) then
    raise exception '이미 대타를 구하는 중이에요';
  end if;
  update public.shifts set status = 'seeking_sub' where id = p_shift_id;
  insert into public.swap_requests(shift_id, requester_id, reason)
    values (p_shift_id, p_staff_id, p_reason);
end;
$$;

create or replace function public.accept_sub(
  p_staff_id bigint,
  p_pin text,
  p_request_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  req public.swap_requests;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  select * into req from public.swap_requests where id = p_request_id for update;
  if req.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if req.status <> 'open' then raise exception '이미 처리된 요청이에요'; end if;
  if req.requester_id = p_staff_id then raise exception '본인 대타는 직접 설 수 없어요'; end if;
  update public.shifts
     set staff_id = p_staff_id, status = 'confirmed'
   where id = req.shift_id;
  update public.swap_requests
     set status = 'completed', taker_id = p_staff_id, resolved_at = now()
   where id = p_request_id;
end;
$$;

create or replace function public.claim_shift(
  p_staff_id bigint,
  p_pin text,
  p_shift_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  sh public.shifts;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  select * into sh from public.shifts where id = p_shift_id for update;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is not null then raise exception '이미 담당자가 있는 근무예요'; end if;
  update public.shifts
     set staff_id = p_staff_id, status = 'confirmed'
   where id = p_shift_id;
end;
$$;

create or replace function public.apply_slot(
  p_staff_id bigint,
  p_pin text,
  p_shift_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  sh public.shifts;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  select * into sh from public.shifts where id = p_shift_id;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is not null or sh.guest_name is not null then
    raise exception '이미 담당자가 있는 근무예요';
  end if;
  insert into public.slot_applications(shift_id, applicant_id)
    values (p_shift_id, p_staff_id)
    on conflict (shift_id, applicant_id) do update set status = 'open';
end;
$$;

create or replace function public.my_submission(
  p_staff_id bigint,
  p_pin text,
  p_ym text
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  return coalesce((
    select json_agg(json_build_object('qkey', qkey, 'choice', choice))
      from public.submission_answers
     where staff_id = p_staff_id and ym = p_ym
  ), '[]'::json);
end;
$$;

create or replace function public.submit_shift(
  p_staff_id bigint,
  p_pin text,
  p_ym text,
  p_answers jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
  n integer;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  if not exists (
    select 1 from public.schedule_status
     where ym = p_ym and submit_open
  ) then
    raise exception '지금은 제출 기간이 아니에요';
  end if;
  delete from public.submission_answers
   where staff_id = p_staff_id and ym = p_ym;
  insert into public.submission_answers(staff_id, ym, qkey, choice)
    select p_staff_id, p_ym, e->>'qkey', e->>'choice'
      from jsonb_array_elements(p_answers) e
     where coalesce(e->>'choice', '') <> '';
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.add_swap_comment(
  p_staff_id bigint,
  p_pin text,
  p_request_id bigint,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.staff;
begin
  perform public._require_partner_plus();
  v := public._verify(p_staff_id, p_pin);
  if v.id is null then raise exception '연결된 직원 계정이 필요해요'; end if;
  if nullif(trim(p_body), '') is null then raise exception '내용을 입력하세요'; end if;
  if not exists (
    select 1 from public.swap_requests where id = p_request_id and status = 'open'
  ) then
    raise exception '진행 중인 대타 요청을 찾을 수 없어요';
  end if;
  insert into public.swap_comments(request_id, author_id, body)
    values (p_request_id, p_staff_id, trim(p_body));
end;
$$;

-- 기존 공개 아바타는 계속 읽을 수 있지만 쓰기는 인증 사용자 자신의 폴더만 허용합니다.
drop policy if exists "avatars_insert" on storage.objects;
drop policy if exists "avatars_update" on storage.objects;
create policy "avatars_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "avatars_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 신청자·제출 내용은 공개 view로 직접 읽지 못하게 합니다.
revoke select on public.application_view from public, anon, authenticated;
revoke select on public.submission_answer_view from public, anon, authenticated;

-- 과거 SQL이 PUBLIC/anon에 부여한 SECURITY DEFINER 실행권을 일괄 회수합니다.
do $block$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format(
      'revoke all privileges on function %s from public, anon, authenticated',
      f.signature
    );
  end loop;
end
$block$;

-- 현재 화면이 사용하는 RPC만 authenticated 역할에 다시 엽니다.
do $block$
declare
  f record;
  allowed_names text[] := array[
    'staff_directory',
    'my_monggle_session',
    'claim_existing_staff',
    'admin_application_list',
    'admin_submission_answers',
    'my_application_list',
    'request_sub',
    'accept_sub',
    'cancel_sub',
    'claim_shift',
    'apply_slot',
    'cancel_application',
    'add_swap_comment',
    'delete_swap_comment',
    'my_submission',
    'submit_shift',
    'my_profile',
    'set_my_avatar',
    'set_my_instagram',
    'my_instagram',
    'save_push_subscription',
    'expire_old_swaps',
    'admin_add_shift',
    'admin_update_shift',
    'admin_delete_shift',
    'admin_add_staff',
    'admin_delete_staff',
    'admin_set_pin',
    'admin_set_default_pin',
    'admin_unlink_staff',
    'admin_set_day_event',
    'admin_import_shifts',
    'admin_set_day_off',
    'admin_set_role',
    'admin_set_instagram',
    'admin_approve_application',
    'admin_reject_application',
    'admin_rename_staff',
    'admin_unlock_staff',
    'admin_set_night',
    'admin_add_night_member',
    'admin_remove_night_member',
    'admin_add_night_q',
    'admin_del_night_q',
    'admin_assign_from_submission',
    'admin_move_shift',
    'admin_set_assignment',
    'admin_set_published',
    'admin_set_submit_open',
    'admin_delete_swap'
  ];
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.proname = any(allowed_names)
  loop
    execute format('grant execute on function %s to authenticated', f.signature);
  end loop;
end
$block$;

-- PIN 로그인/변경은 OAuth 전환 후 브라우저에서 사용할 수 없습니다.
-- 관리자는 기존 PIN을 직원 연결용 일회성 코드로 설정할 수 있습니다.
revoke all privileges on function public.staff_login(text, text)
  from public, anon, authenticated;
revoke all privileges on function public.set_my_pin(bigint, text, text)
  from public, anon, authenticated;

commit;
