-- ============================================================
--  모에 스케줄 · 시프트 제출 + 앱에서 바로 배정
-- ------------------------------------------------------------
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
--  여러 번 실행해도 안전합니다.
-- ============================================================

-- 관리자가 월별로 추가하는 야간 문항 (예: '7/4-5 데빌야간 11-5:00')
create table if not exists submission_night_q (
  id bigint generated always as identity primary key,
  ym text not null,                 -- 'YYYY-MM'
  label text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
alter table submission_night_q enable row level security;

-- 직원 제출 답변 (통합)
--   qkey = 'd:YYYY-MM-DD' (그날 희망 근무지)  또는  'n:<야간문항id>' (야간 가능여부)
--   choice(낮) = 메이드|데빌|마츠리|상관없음|출근불가능
--   choice(야간) = 가능|불가능
create table if not exists submission_answers (
  id bigint generated always as identity primary key,
  staff_id bigint not null references staff(id) on delete cascade,
  ym text not null,
  qkey text not null,
  choice text not null,
  updated_at timestamptz not null default now(),
  unique (staff_id, qkey)
);
alter table submission_answers enable row level security;

-- 야간 문항 목록 (제출폼 렌더용)
create or replace view submission_night_view as
  select id, ym, label, sort from submission_night_q;
grant select on submission_night_view to anon, authenticated;

-- 제출 현황 (이름 포함, 관리자/배정용)
create or replace view submission_answer_view as
  select a.staff_id, s.name as staff_name, a.ym, a.qkey, a.choice
  from submission_answers a join staff s on s.id = a.staff_id;
grant select on submission_answer_view to anon, authenticated;

-- 내 제출 불러오기
create or replace function my_submission(p_staff_id bigint, p_pin text, p_ym text)
returns json language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  return coalesce((select json_agg(json_build_object('qkey', qkey, 'choice', choice))
    from submission_answers where staff_id = p_staff_id and ym = p_ym), '[]'::json);
end; $$;

-- 제출(저장): 해당 월 답변 전체 교체
create or replace function submit_shift(p_staff_id bigint, p_pin text, p_ym text, p_answers jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; n int;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  if not exists (select 1 from schedule_status where ym = p_ym and submit_open) then
    raise exception '지금은 제출 기간이 아니에요';
  end if;
  delete from submission_answers where staff_id = p_staff_id and ym = p_ym;
  insert into submission_answers(staff_id, ym, qkey, choice)
    select p_staff_id, p_ym, e->>'qkey', e->>'choice'
    from jsonb_array_elements(p_answers) e
    where coalesce(e->>'choice','') <> '';
  get diagnostics n = row_count;
  return n;
end; $$;

-- 관리자: 야간 문항 추가/삭제
create or replace function admin_add_night_q(p_admin_id bigint, p_pin text, p_ym text, p_label text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if coalesce(trim(p_label),'') = '' then raise exception '문항 내용을 입력하세요'; end if;
  insert into submission_night_q(ym, label, sort)
    values (p_ym, trim(p_label), coalesce((select max(sort)+1 from submission_night_q where ym = p_ym), 0));
end; $$;

create or replace function admin_del_night_q(p_admin_id bigint, p_pin text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  delete from submission_night_q where id = p_id;
  delete from submission_answers where qkey = 'n:' || p_id;
end; $$;

-- 관리자: 제출 희망자들을 그 날짜·근무지에 한번에 배정 (이미 배정된 사람은 건너뜀)
create or replace function admin_assign_from_submission(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_staff_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; sid bigint; n int := 0;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_staff_ids is null then return 0; end if;
  foreach sid in array p_staff_ids loop
    if not exists (select 1 from shifts where work_date = p_date and workplace = p_workplace and staff_id = sid) then
      insert into shifts(work_date, workplace, start_time, end_time, staff_id)
        values (p_date, p_workplace, '', '', sid);
      n := n + 1;
    end if;
  end loop;
  return n;
end; $$;

-- 월별 상태: published(스케줄 공개) + submit_open(제출 받기)
--   published: row 없으면 '공개'로 간주 (기존 데이터 영향 없음)
--   submit_open: row 없으면 '닫힘' → 관리자가 열 때만 직원 제출 가능
create table if not exists schedule_status (
  ym text primary key,
  published boolean not null default false,
  submit_open boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table schedule_status add column if not exists submit_open boolean not null default false;
alter table schedule_status enable row level security;
create or replace view schedule_status_view as select ym, published, submit_open from schedule_status;
grant select on schedule_status_view to anon, authenticated;

-- 스케줄 공개/비공개 (새 row는 submit_open 기본 닫힘)
create or replace function admin_set_published(p_admin_id bigint, p_pin text, p_ym text, p_pub boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into schedule_status(ym, published, updated_at) values (p_ym, p_pub, now())
    on conflict (ym) do update set published = excluded.published, updated_at = now();
end; $$;

-- 제출 받기 열기/닫기 (새 row는 published 기본 공개 → 제출 열어도 스케줄 숨지 않음)
create or replace function admin_set_submit_open(p_admin_id bigint, p_pin text, p_ym text, p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into schedule_status(ym, published, submit_open, updated_at) values (p_ym, true, p_open, now())
    on conflict (ym) do update set submit_open = excluded.submit_open, updated_at = now();
end; $$;

grant execute on function my_submission, submit_shift, admin_add_night_q,
  admin_del_night_q, admin_assign_from_submission, admin_set_published,
  admin_set_submit_open to anon, authenticated;
