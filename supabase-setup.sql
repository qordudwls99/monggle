-- ============================================================
--  출근 시프트 · Supabase 초기 설정 SQL
-- ------------------------------------------------------------
--  사용법:
--   1) supabase.com 에서 무료 프로젝트 생성
--   2) 좌측 메뉴 [SQL Editor] → New query
--   3) 이 파일 전체를 복사해 붙여넣고 [Run] 실행
--   4) Project Settings → API 에서 "Project URL"과 "anon public" 키를
--      복사해 shift.html 상단 CONFIG 에 입력
-- ============================================================

-- 안전하게 다시 실행할 수 있도록 기존 객체 정리(처음이면 무시됨)
drop view   if exists swap_view;
drop view   if exists shift_view;
drop table  if exists swap_requests cascade;
drop table  if exists shifts cascade;
drop table  if exists staff cascade;

-- ============================================================
-- 1. 테이블
-- ============================================================

-- 출근자(스태프) 계정 : PIN 으로 로그인
create table staff (
  id          bigint generated always as identity primary key,
  name        text    not null unique,
  pin         text    not null,                 -- 4자리 숫자 권장
  workplace   text    not null check (workplace in ('메이드','데빌','마츠리')),
  is_admin    boolean not null default false,   -- 관리자(매니저) 여부
  created_at  timestamptz not null default now()
);

-- 근무(시프트)
create table shifts (
  id          bigint generated always as identity primary key,
  work_date   date    not null,
  workplace   text    not null check (workplace in ('메이드','데빌','마츠리')),
  start_time  text    not null,                 -- 'HH:MM'
  end_time    text    not null,                 -- 'HH:MM'
  staff_id    bigint  references staff(id) on delete set null,  -- 비어있으면 모집중
  status      text    not null default 'confirmed'
              check (status in ('confirmed','seeking_sub')),
  memo        text,
  created_at  timestamptz not null default now()
);
create index on shifts (work_date);

-- 대타 요청 : 근무 변경은 반드시 이 흐름을 거친다
create table swap_requests (
  id            bigint generated always as identity primary key,
  shift_id      bigint not null references shifts(id) on delete cascade,
  requester_id  bigint not null references staff(id) on delete cascade,
  taker_id      bigint references staff(id) on delete set null,
  reason        text,
  status        text not null default 'open'
                check (status in ('open','completed','cancelled')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- ============================================================
-- 2. 보안(RLS) : staff 테이블의 PIN 은 절대 외부에 노출하지 않는다
-- ============================================================
alter table staff          enable row level security;
alter table shifts         enable row level security;
alter table swap_requests  enable row level security;
-- 위 3개 테이블에 anon(익명) 정책을 만들지 않으므로,
-- 브라우저에서 테이블을 직접 읽거나 쓰는 것은 모두 차단된다.
-- 데이터 조회는 아래 "뷰", 변경은 아래 "함수"를 통해서만 가능하다.

-- ============================================================
-- 3. 조회용 뷰 (PIN 제외 · 손님/출근자 모두 읽기 가능)
-- ============================================================
create view shift_view as
  select sh.id, sh.work_date, sh.workplace, sh.start_time, sh.end_time,
         sh.status, sh.memo, sh.staff_id, st.name as staff_name
  from shifts sh
  left join staff st on st.id = sh.staff_id;

create view swap_view as
  select sw.id, sw.shift_id, sw.status, sw.reason, sw.created_at,
         sw.requester_id, rq.name as requester_name,
         sw.taker_id,    tk.name as taker_name,
         sh.work_date, sh.workplace, sh.start_time, sh.end_time
  from swap_requests sw
  join shifts sh on sh.id = sw.shift_id
  join staff  rq on rq.id = sw.requester_id
  left join staff tk on tk.id = sw.taker_id;

grant select on shift_view to anon, authenticated;
grant select on swap_view  to anon, authenticated;

-- ============================================================
-- 4. 함수 (모든 변경 작업 · PIN 검증 포함)
--    SECURITY DEFINER 로 동작하여 RLS 를 우회하지만,
--    각 함수가 직접 PIN/권한을 확인한다.
-- ============================================================

-- 로그인 : 이름 + PIN 이 맞으면 정보 반환(PIN 제외)
create or replace function staff_login(p_name text, p_pin text)
returns table(id bigint, name text, workplace text, is_admin boolean)
language sql security definer set search_path = public as $$
  select id, name, workplace, is_admin
  from staff where name = p_name and pin = p_pin;
$$;

-- 이름 목록 (로그인 드롭다운/관리자용 · PIN 제외)
create or replace function staff_directory()
returns table(id bigint, name text, workplace text, is_admin boolean)
language sql security definer set search_path = public as $$
  select id, name, workplace, is_admin from staff order by workplace, name;
$$;

-- 내부 헬퍼 : PIN 검증
create or replace function _verify(p_staff_id bigint, p_pin text)
returns staff language sql security definer set search_path = public as $$
  select * from staff where id = p_staff_id and pin = p_pin;
$$;

-- 대타 구하기 : 본인 근무에 대해서만 요청 가능
create or replace function request_sub(p_staff_id bigint, p_pin text,
                                       p_shift_id bigint, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; sh shifts;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into sh from shifts where id = p_shift_id;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is distinct from p_staff_id then
    raise exception '본인 근무만 대타를 구할 수 있어요'; end if;
  if exists (select 1 from swap_requests where shift_id = p_shift_id and status = 'open') then
    raise exception '이미 대타를 구하는 중이에요'; end if;
  update shifts set status = 'seeking_sub' where id = p_shift_id;
  insert into swap_requests(shift_id, requester_id, reason)
    values (p_shift_id, p_staff_id, p_reason);
end; $$;

-- 대타 서기 : 다른 사람의 열린 요청을 수락 → 근무가 나에게 넘어옴
create or replace function accept_sub(p_staff_id bigint, p_pin text, p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; req swap_requests;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into req from swap_requests where id = p_request_id;
  if req.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if req.status <> 'open' then raise exception '이미 처리된 요청이에요'; end if;
  if req.requester_id = p_staff_id then raise exception '본인 대타는 직접 설 수 없어요'; end if;
  update shifts set staff_id = p_staff_id, status = 'confirmed' where id = req.shift_id;
  update swap_requests set status = 'completed', taker_id = p_staff_id, resolved_at = now()
    where id = p_request_id;
end; $$;

-- 대타 요청 취소 : 요청자 본인 또는 관리자
create or replace function cancel_sub(p_staff_id bigint, p_pin text, p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; req swap_requests;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into req from swap_requests where id = p_request_id;
  if req.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if req.status <> 'open' then raise exception '이미 처리된 요청이에요'; end if;
  if req.requester_id <> p_staff_id and not v.is_admin then
    raise exception '본인 요청만 취소할 수 있어요'; end if;
  update shifts set status = 'confirmed' where id = req.shift_id;
  update swap_requests set status = 'cancelled', resolved_at = now() where id = p_request_id;
end; $$;

-- 빈 자리(모집중) 채우기 : 담당자가 없는 근무를 직접 맡음
create or replace function claim_shift(p_staff_id bigint, p_pin text, p_shift_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; sh shifts;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into sh from shifts where id = p_shift_id;
  if sh.id is null then raise exception '근무를 찾을 수 없습니다'; end if;
  if sh.staff_id is not null then raise exception '이미 담당자가 있는 근무예요'; end if;
  update shifts set staff_id = p_staff_id, status = 'confirmed' where id = p_shift_id;
end; $$;

-- ---- 관리자 전용 함수 ----------------------------------------

create or replace function admin_add_shift(p_admin_id bigint, p_pin text,
  p_work_date date, p_workplace text, p_start text, p_end text,
  p_assignee bigint default null, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into shifts(work_date, workplace, start_time, end_time, staff_id, memo)
    values (p_work_date, p_workplace, p_start, p_end, p_assignee, p_memo);
end; $$;

create or replace function admin_delete_shift(p_admin_id bigint, p_pin text, p_shift_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  delete from shifts where id = p_shift_id;
end; $$;

create or replace function admin_add_staff(p_admin_id bigint, p_pin text,
  p_name text, p_new_pin text, p_workplace text, p_is_admin boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into staff(name, pin, workplace, is_admin)
    values (p_name, p_new_pin, p_workplace, p_is_admin);
end; $$;

create or replace function admin_delete_staff(p_admin_id bigint, p_pin text, p_target_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_target_id = p_admin_id then raise exception '본인 계정은 삭제할 수 없어요'; end if;
  delete from staff where id = p_target_id;
end; $$;

-- 함수 실행 권한을 익명 사용자에게 부여 (검증은 함수 내부에서 처리)
grant execute on function
  staff_login, staff_directory, request_sub, accept_sub, cancel_sub, claim_shift,
  admin_add_shift, admin_delete_shift, admin_add_staff, admin_delete_staff
to anon, authenticated;

-- ============================================================
-- 5. 시작용 샘플 데이터 (반드시 PIN 을 바꿔서 사용하세요!)
-- ============================================================
insert into staff(name, pin, workplace, is_admin) values
  ('관리자', '0000', '메이드', true),
  ('아카리', '1111', '메이드', false),
  ('유우키', '2222', '데빌',  false),
  ('하루',   '3333', '마츠리', false);

-- 오늘 날짜 예시 근무 몇 개 (원하면 삭제하세요)
insert into shifts(work_date, workplace, start_time, end_time, staff_id) values
  (current_date, '메이드', '12:00', '18:00', (select id from staff where name='아카리')),
  (current_date, '데빌',  '18:00', '23:00', (select id from staff where name='유우키')),
  (current_date, '마츠리', '14:00', '20:00', null);   -- 빈 자리(모집중) 예시
