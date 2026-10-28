-- ============================================================
--  모에 스케줄 · v2 DB 변경 (개인 알림 · PIN 초기화 · 되돌릴 수 있는 휴무)
-- ------------------------------------------------------------
--  초안입니다. 사용자 승인 전에는 실행하지 마세요.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run (여러 번 실행해도 안전)
--
--  · 기준: 2026-10-28 에 읽은 LIVE 정의 (repo SQL 아님). 차이점은 .ui-design/v2-plan/db-v2-notes.md
--  · 기존 화면(/ , /staff.html)은 그대로 동작해야 함:
--      - 기존 RPC 의 이름 · 인자 · 반환형 · 오류 문구는 그대로
--      - 기존 함수 본문은 LIVE 그대로 두고, 앞에는 "읽기"만, 뒤에는 알림 helper 호출만 추가 (-- v2 표시)
--        예외 2곳 (-- v2 표시): accept_sub 에 잠금(근무 → 요청) 후 다시 읽기 · admin_set_day_off 의 delete 를 백업 문장 안으로
--      - 알림 기록이 실패해도 원래 동작(수락/거절/대타/공개)은 실패하지 않음 (_add_notifications 가 오류를 삼킴)
--  · 새 테이블: RLS on + anon/authenticated 직접 접근 없음 (staff_sessions 와 같은 방식)
--  · 새 내부 helper: execute 회수 (_verify 와 같은 방식) · 새 RPC: anon, authenticated 에 execute
--  · 맨 아래: ROLLBACK (주석) · DRY-RUN 테스트 (주석, 적용 후 따로 실행)
-- ============================================================


-- ------------------------------------------------------------
-- 0) 공통 helper (내부용)
-- ------------------------------------------------------------

-- '2026-10-31' → '10월 31일'
create or replace function _md_label(p_date date)
returns text language sql immutable set search_path = public as $$
  select extract(month from p_date)::int || '월 ' || extract(day from p_date)::int || '일';
$$;
revoke execute on function _md_label(date) from public, anon, authenticated;

-- '2026-11' → '11월' (형식이 다르면 받은 값 그대로 · 절대 오류를 내지 않음)
create or replace function _ym_label(p_ym text)
returns text language sql immutable set search_path = public as $$
  select case when p_ym ~ '^\d{4}-\d{2}$' then split_part(p_ym, '-', 2)::int || '월'
              else coalesce(p_ym, '') end;
$$;
revoke execute on function _ym_label(text) from public, anon, authenticated;


-- ------------------------------------------------------------
-- 1) 개인 알림
-- ------------------------------------------------------------
create table if not exists staff_notifications (
  id         bigserial primary key,
  staff_id   bigint not null references staff(id) on delete cascade,
  kind       text not null,          -- application_approved | application_rejected | swap_taken | schedule_published | submission_reminder
  title      text not null,
  body       text,
  link       jsonb,                  -- 예: {"tab":"schedule","date":"2026-10-31","workplace":"데빌"}
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  pushed_at  timestamptz               -- notify 가 웹푸시로 보낸 시각 (null = 아직). 같은 행은 한 번만 보냄
);
alter table staff_notifications add column if not exists pushed_at timestamptz;  -- 다시 실행할 때도 컬럼 보장
create index if not exists staff_notifications_staff_created_idx
  on staff_notifications(staff_id, created_at desc);
alter table staff_notifications enable row level security;
revoke all on table staff_notifications from public, anon, authenticated;
revoke all on sequence staff_notifications_id_seq from public, anon, authenticated;
-- notify 엣지 함수(service_role)가 보낼 행을 가져감: update … set pushed_at … returning (기본 ACL 에 기대지 않고 명시)
grant select, update on table staff_notifications to service_role;

-- 여러 명에게 같은 알림 한 줄씩. 실패해도 호출한 함수는 계속 진행 (경고만 남김)
create or replace function _add_notifications(p_ids bigint[], p_kind text, p_title text,
  p_body text, p_link jsonb default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  begin
    insert into staff_notifications(staff_id, kind, title, body, link)
      select distinct x, p_kind, p_title, p_body, p_link
        from unnest(p_ids) x
       where x is not null and exists (select 1 from staff s where s.id = x);
    get diagnostics n = row_count;
  exception when others then
    raise warning '_add_notifications(%) failed: %', p_kind, sqlerrm;
    n := 0;
  end;
  return n;
end; $$;
revoke execute on function _add_notifications(bigint[], text, text, text, jsonb) from public, anon, authenticated;

-- 내 알림 (최신순, 최대 100)
create or replace function my_notifications(p_staff_id bigint, p_pin text, p_limit int default 30)
returns table(id bigint, kind text, title text, body text, link jsonb,
              created_at timestamptz, read_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  return query
    select n.id, n.kind, n.title, n.body, n.link, n.created_at, n.read_at
      from staff_notifications n
     where n.staff_id = p_staff_id
     order by n.created_at desc, n.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end; $$;
grant execute on function my_notifications(bigint, text, int) to anon, authenticated;

-- 읽음 처리 (p_ids null = 내 알림 전부) → 바뀐 개수
create or replace function mark_my_notifications_read(p_staff_id bigint, p_pin text, p_ids bigint[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; n int;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  update staff_notifications
     set read_at = now()
   where staff_id = p_staff_id
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function mark_my_notifications_read(bigint, text, bigint[]) to anon, authenticated;

-- 1-a) 빈자리 신청 수락 : LIVE 본문 그대로 + 신청자(수락) · 같은 근무의 다른 신청자(자동 거절)에게 알림
create or replace function admin_approve_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; a slot_applications; sh shifts; v_others bigint[];
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  select * into a from slot_applications where id = p_app_id;
  if a.id is null then raise exception '신청을 찾을 수 없습니다'; end if;
  -- v2: 알림용 읽기
  select * into sh from shifts where id = a.shift_id;
  select array_agg(applicant_id) into v_others from slot_applications
   where shift_id = a.shift_id and status = 'open' and id <> p_app_id;
  update shifts set staff_id = a.applicant_id, status = 'confirmed' where id = a.shift_id;
  update slot_applications set status='rejected' where shift_id = a.shift_id and status='open' and id <> p_app_id;
  update slot_applications set status='approved' where id = p_app_id;
  -- v2: 알림
  if a.status is distinct from 'approved' then
    perform _add_notifications(array[a.applicant_id], 'application_approved', '빈자리 신청이 수락됐어요',
      format('%s %s 근무가 확정됐어요', _md_label(sh.work_date), sh.workplace),
      jsonb_build_object('tab','schedule','date',sh.work_date,'workplace',sh.workplace,'app_id',a.id));
  end if;
  perform _add_notifications(v_others, 'application_rejected', '빈자리 신청이 거절됐어요',
    format('%s %s 신청이 거절됐어요', _md_label(sh.work_date), sh.workplace),
    jsonb_build_object('tab','schedule','date',sh.work_date,'workplace',sh.workplace));
end; $$;

-- 1-b) 빈자리 신청 거절 : LIVE 본문 그대로 (없는 id 도 오류 없이 통과) + 신청자에게 알림
create or replace function admin_reject_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; a slot_applications; sh shifts;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  -- v2: 알림용 읽기 (바뀌기 전 상태)
  select * into a from slot_applications where id = p_app_id;
  update slot_applications set status='rejected' where id = p_app_id;
  -- v2: 알림
  if a.id is not null and a.status is distinct from 'rejected' then
    select * into sh from shifts where id = a.shift_id;
    perform _add_notifications(array[a.applicant_id], 'application_rejected', '빈자리 신청이 거절됐어요',
      format('%s %s 신청이 거절됐어요', _md_label(sh.work_date), sh.workplace),
      jsonb_build_object('tab','schedule','date',sh.work_date,'workplace',sh.workplace,'app_id',a.id));
  end if;
end; $$;

-- 1-c) 대타 수락 : LIVE 본문 그대로 + 잠금(근무 → 요청, LIVE cancel_sub/admin_set_assignment 와 같은 순서) 후 다시 읽기
--      + 요청자에게 "<taker>님이 대타를 맡았어요"
create or replace function accept_sub(p_staff_id bigint, p_pin text, p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; req swap_requests; sh shifts;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into req from swap_requests where id = p_request_id;
  if req.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  -- v2: 근무 행을 먼저 잠그고(알림용 읽기 겸) 요청 행을 잠가 다시 읽음 → 동시 수락은 두 번째가 '이미 처리된 요청이에요'
  select * into sh from shifts where id = req.shift_id for update;
  select * into req from swap_requests where id = p_request_id for update;
  if req.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if req.status <> 'open' then raise exception '이미 처리된 요청이에요'; end if;
  if req.requester_id = p_staff_id then raise exception '본인 대타는 직접 설 수 없어요'; end if;
  update shifts set staff_id = p_staff_id, status = 'confirmed' where id = req.shift_id;
  update swap_requests set status = 'completed', taker_id = p_staff_id, resolved_at = now()
    where id = p_request_id;
  -- v2: 알림
  perform _add_notifications(array[req.requester_id], 'swap_taken',
    format('%s %s 대타 확정', _md_label(sh.work_date), sh.workplace),
    format('%s님이 대타를 맡았어요', v.name),
    jsonb_build_object('tab','mine','date',sh.work_date,'workplace',sh.workplace,'request_id',req.id));
end; $$;

-- 1-d) 스케줄 공개 : LIVE 본문 그대로 + "비공개(false) → 공개" 로 바뀔 때만 로그인 가능한 전 직원(본인 제외)에게
--      (row 가 없던 달은 원래 공개 상태라 알림 없음 · 이미 공개인 달을 다시 공개해도 알림 없음)
create or replace function admin_set_published(p_admin_id bigint, p_pin text, p_ym text, p_pub boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; v_prev boolean;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  -- v2: 알림용 읽기 (바뀌기 전 상태)
  select published into v_prev from schedule_status where ym = p_ym;
  insert into schedule_status(ym, published, updated_at) values (p_ym, p_pub, now())
    on conflict (ym) do update set published = excluded.published, updated_at = now();
  -- v2: 알림
  if p_pub and v_prev is false then
    perform _add_notifications(
      array(select s.id from staff s where s.pin is not null and s.id <> p_admin_id),
      'schedule_published', '스케줄 공개',
      _ym_label(p_ym) || ' 스케줄이 공개됐어요',
      jsonb_build_object('tab','schedule','ym',p_ym));
  end if;
end; $$;

-- 1-e) 미제출자 다시 알림 (새 RPC) → 알림을 받은 인원 수
--      대상: 로그인 가능한(PIN 있는) 직원 중 그 달 답변이 0개인 사람, 호출한 관리자 제외
--      여기서는 오류를 삼키지 않음 (알림 기록이 이 함수의 목적)
create or replace function admin_remind_submission(p_admin_id bigint, p_pin text, p_ym text)
returns integer language plpgsql security definer set search_path = public as $$
declare v staff; n int;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if not exists (select 1 from schedule_status where ym = p_ym and submit_open) then
    raise exception '지금은 제출 기간이 아니에요';
  end if;
  insert into staff_notifications(staff_id, kind, title, body, link)
    select s.id, 'submission_reminder', '시프트 제출 알림',
           _ym_label(p_ym) || ' 시프트를 아직 제출하지 않았어요',
           jsonb_build_object('tab','submit','ym',p_ym)
      from staff s
     where s.pin is not null
       and s.id <> p_admin_id
       and not exists (select 1 from submission_answers a where a.staff_id = s.id and a.ym = p_ym);
  get diagnostics n = row_count;
  return n;
end; $$;
grant execute on function admin_remind_submission(bigint, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 2) PIN 초기화 (새 RPC) → 임시 PIN 6자리를 관리자에게 한 번만 돌려줌
--    · 서버에서 생성: gen_random_bytes(4) → 0..2^32-1, 4294000000 이상은 버리고 다시 뽑아 % 1000000 (편향 없음)
--    · 저장 방식은 LIVE set_my_pin / admin_set_pin 과 같음 (staff.pin 에 그대로 저장)
--    · pin_temp = true, 실패 횟수 0, 잠금 해제, 대상의 모든 세션 삭제
--    · 본인은 불가 (마이페이지 set_my_pin 사용)
-- ------------------------------------------------------------
create or replace function admin_reset_pin(p_admin_id bigint, p_pin text, p_target_id bigint)
returns text language plpgsql security definer set search_path = public as $$
declare v staff; t staff; r bigint; np text;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_target_id = p_admin_id then raise exception '본인 PIN은 초기화할 수 없어요'; end if;
  select * into t from staff where id = p_target_id for update;
  if t.id is null then raise exception '직원을 찾을 수 없습니다'; end if;
  loop
    r := ('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint;
    exit when r < 4294000000;
  end loop;
  np := lpad((r % 1000000)::text, 6, '0');
  update staff set pin = np, pin_temp = true, failed_attempts = 0, locked = false
   where id = p_target_id;
  delete from staff_sessions where staff_id = p_target_id;
  return np;
end; $$;
grant execute on function admin_reset_pin(bigint, text, bigint) to anon, authenticated;


-- ------------------------------------------------------------
-- 3) 되돌릴 수 있는 휴무
--    휴무 지정: 그날+근무지 근무를 지우기 전에 근무 행 + 딸린 대타요청/댓글/빈자리신청을 통째로 백업
--              (shifts 삭제 시 FK cascade 로 swap_requests → swap_comments, slot_applications 가 같이 지워지기 때문)
--              이미 휴무인 날을 다시 지정하면 아무것도 하지 않음 (백업을 다시 만들지 않음)
--    휴무 해제: 같은 id 로 복원 → 그날 백업은 "전부" 삭제
--              · 충돌(그 사이 다시 짠 날)인 행만 버림: 같은 id 있음 / 같은 직원이 그날 어느 층이든 근무 있음 /
--                같은 이름 게스트가 그날 어느 층이든 있음 / 빈자리인데 그날+근무지에 이미 근무가 있음
--                (남겨 두면 다음 휴무→해제 때 중복 배정 + 오래된 대타요청으로 되살아나기 때문)
--              · 그 밖의 이유로 한 행이라도 복원 실패 → 오류로 해제 전체 취소 (휴무 유지 · 백업 그대로)
--    동시성: 같은 날+근무지의 지정/해제는 advisory lock 으로 순서대로 · 백업 전에 그날 근무 → 대타요청 행을 for update
--    야간(night_days / night_members)은 LIVE 와 같이 건드리지 않음
-- ------------------------------------------------------------
create table if not exists closure_shift_backup (
  shift_id          bigint primary key,           -- 원래 shifts.id
  work_date         date not null,
  workplace         text not null,
  shift_row         jsonb not null,               -- to_jsonb(shifts 행) 전체
  swap_requests     jsonb not null default '[]',  -- 그 근무의 swap_requests 행 전체 (상태 무관)
  swap_comments     jsonb not null default '[]',  -- 위 요청들의 swap_comments 행 전체
  slot_applications jsonb not null default '[]',  -- 그 근무의 slot_applications 행 전체
  closed_at         timestamptz not null default now(),
  closed_by         bigint                        -- 휴무를 지정한 관리자 id (FK 없음: 관리자 삭제와 무관하게 보존)
);
create index if not exists closure_shift_backup_day_idx on closure_shift_backup(work_date, workplace);
alter table closure_shift_backup enable row level security;
revoke all on table closure_shift_backup from public, anon, authenticated;

create or replace function admin_set_day_off(p_admin_id bigint, p_pin text,
  p_date date, p_workplace text, p_off boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; b closure_shift_backup; sid bigint; gname text; v_row jsonb;
        v_present bigint[]; v_guests text[]; v_wp_has boolean;
        n_ok int := 0; n_skip int := 0; n_fail int := 0;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  -- v2: 같은 날+근무지에 대한 동시 지정/해제를 순서대로
  perform pg_advisory_xact_lock(hashtext('admin_set_day_off:' || p_date || ':' || p_workplace));
  if p_off then
    -- v2: 이미 휴무인 날 → 아무것도 하지 않음 (백업을 다시 만들지 않음 · 휴무 중 추가된 근무도 지우지 않음)
    if exists (select 1 from closures where work_date = p_date and workplace = p_workplace) then
      return;
    end if;
    -- v2: 백업하는 동안 그날 근무에 대타요청/댓글/신청이 새로 붙거나 바뀌지 못하게 잠금
    --     (순서는 LIVE cancel_sub / admin_delete_shift / admin_set_assignment 와 같게: 근무 → 대타요청
    --      · swap_comments / slot_applications 는 이 행들의 FK 에 걸림)
    perform 1 from shifts where work_date = p_date and workplace = p_workplace for update;
    perform 1 from swap_requests r join shifts sh on sh.id = r.shift_id
      where sh.work_date = p_date and sh.workplace = p_workplace
      for update of r;
    -- v2: LIVE 의 delete 를 백업과 한 문장으로 → 지운 근무 = 백업한 근무 (그 사이 새로 들어온 근무도 빠짐없이)
    --     (같은 shift_id 가 이미 있으면 최신 상태로 덮어씀)
    with del as (
      delete from shifts where work_date = p_date and workplace = p_workplace
      returning *
    )
    insert into closure_shift_backup(shift_id, work_date, workplace, shift_row,
                                     swap_requests, swap_comments, slot_applications, closed_by)
      select sh.id, sh.work_date, sh.workplace, to_jsonb(sh),
             coalesce((select jsonb_agg(to_jsonb(r) order by r.id)
                         from swap_requests r where r.shift_id = sh.id), '[]'::jsonb),
             coalesce((select jsonb_agg(to_jsonb(c) order by c.id)
                         from swap_comments c join swap_requests r on r.id = c.request_id
                        where r.shift_id = sh.id), '[]'::jsonb),
             coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
                         from slot_applications a where a.shift_id = sh.id), '[]'::jsonb),
             p_admin_id
        from del sh
    on conflict (shift_id) do update
      set work_date = excluded.work_date, workplace = excluded.workplace,
          shift_row = excluded.shift_row, swap_requests = excluded.swap_requests,
          swap_comments = excluded.swap_comments, slot_applications = excluded.slot_applications,
          closed_at = now(), closed_by = excluded.closed_by;
    insert into closures(work_date, workplace) values (p_date, p_workplace) on conflict do nothing;
  else
    delete from closures where work_date = p_date and workplace = p_workplace;
    -- v2: 백업 복원. 충돌 판단은 복원 "전"에 이미 있던 근무 기준 (같은 직원의 근무 2개도 둘 다 복원)
    --     휴무 중에 그날을 다시 짰을 수 있음 (LIVE admin_set_assignment: 한 사람 하루 한 층)
    select coalesce(array_agg(distinct staff_id) filter (where staff_id is not null), '{}'),
           coalesce(array_agg(distinct guest_name) filter (where guest_name is not null), '{}'),
           coalesce(bool_or(workplace = p_workplace), false)
      into v_present, v_guests, v_wp_has
      from shifts where work_date = p_date;
    for b in select * from closure_shift_backup
              where work_date = p_date and workplace = p_workplace
              order by shift_id
              for update loop
      -- 행마다 따로 시도 · 충돌이 아닌 실패(FK · NOT NULL · 나중에 생긴 컬럼 등)는 세어 두었다가 아래에서 해제 전체 취소
      begin
        -- 충돌 1: 같은 id 의 근무가 이미 있음
        if exists (select 1 from shifts where id = b.shift_id) then
          n_skip := n_skip + 1;
          raise notice 'admin_set_day_off: 근무 % 는 이미 있어 복원하지 않음', b.shift_id;
          continue;
        end if;
        -- 그 사이 삭제된 직원 = FK on delete set null 과 같이 빈자리(또는 게스트)로 보고 판단
        v_row := b.shift_row;
        sid := nullif(v_row->>'staff_id', '')::bigint;
        if sid is not null and not exists (select 1 from staff where id = sid) then
          sid := null;
          v_row := v_row || '{"staff_id": null}'::jsonb;
        end if;
        gname := case when sid is null then nullif(v_row->>'guest_name', '') end;
        -- 충돌 2(a): 같은 직원이 그날 어느 근무지든 이미 근무 있음
        if sid is not null and sid = any(v_present) then
          n_skip := n_skip + 1;
          raise notice 'admin_set_day_off: 근무 % 는 직원 % 이(가) 그날 이미 배정돼 복원하지 않음', b.shift_id, sid;
          continue;
        end if;
        -- 충돌 2(b): 같은 이름의 게스트가 그날 어느 근무지든 이미 있음
        if gname is not null and gname = any(v_guests) then
          n_skip := n_skip + 1;
          raise notice 'admin_set_day_off: 근무 % 는 게스트가 그날 이미 배정돼 복원하지 않음', b.shift_id;
          continue;
        end if;
        -- 충돌 2(c): 빈자리인데 그날+근무지에 이미 근무가 있음 (다시 짠 날)
        if sid is null and gname is null and v_wp_has then
          n_skip := n_skip + 1;
          raise notice 'admin_set_day_off: 빈자리 근무 % 는 그날을 다시 짜서 복원하지 않음', b.shift_id;
          continue;
        end if;
        -- 근무
        insert into shifts overriding system value
          select x.* from jsonb_populate_record(null::shifts, v_row) x;
        -- 빈자리 신청 (삭제된 신청자 = cascade 와 같이 버림)
        insert into slot_applications overriding system value
          select x.* from jsonb_array_elements(b.slot_applications) e
            cross join lateral jsonb_populate_record(null::slot_applications, e) x
           where exists (select 1 from staff s where s.id = x.applicant_id)
        on conflict do nothing;
        -- 대타 요청 (삭제된 요청자 = cascade 와 같이 버림 · 삭제된 taker = set null)
        insert into swap_requests overriding system value
          select x.* from jsonb_array_elements(b.swap_requests) e
            cross join lateral jsonb_populate_record(null::swap_requests,
              e || case when exists (select 1 from staff s where s.id = nullif(e->>'taker_id','')::bigint)
                        then '{}'::jsonb else '{"taker_id": null}'::jsonb end) x
           where exists (select 1 from staff s where s.id = x.requester_id)
        on conflict do nothing;
        -- 댓글 (복원된 요청의 댓글만 · 삭제된 작성자 = set null)
        insert into swap_comments overriding system value
          select x.* from jsonb_array_elements(b.swap_comments) e
            cross join lateral jsonb_populate_record(null::swap_comments,
              e || case when exists (select 1 from staff s where s.id = nullif(e->>'author_id','')::bigint)
                        then '{}'::jsonb else '{"author_id": null}'::jsonb end) x
           where exists (select 1 from swap_requests r where r.id = x.request_id)
        on conflict do nothing;
        -- 열린 대타 요청이 복원되지 못했으면 근무 상태를 확정으로 (대타 게시판과 어긋나지 않게)
        update shifts set status = 'confirmed'
         where id = b.shift_id and status = 'seeking_sub'
           and not exists (select 1 from swap_requests r where r.shift_id = b.shift_id and r.status = 'open');
        n_ok := n_ok + 1;
      exception when others then
        n_fail := n_fail + 1;
        raise warning 'admin_set_day_off: 근무 % 복원 실패: %', b.shift_id, sqlerrm;
      end;
    end loop;
    -- v2: 충돌이 아닌 실패가 하나라도 있으면 해제 전체 취소 (휴무 유지 · 백업 그대로 · 아무것도 조용히 버리지 않음)
    if n_fail > 0 then
      raise exception '근무 %건을 되돌리지 못해 휴무를 풀지 않았어요. 관리자에게 알려 주세요', n_fail;
    end if;
    -- v2: 충돌로 건너뛴 행까지 그날 백업은 전부 삭제 (대타요청/댓글/신청 백업도 같은 행에 있어 함께 사라짐)
    delete from closure_shift_backup where work_date = p_date and workplace = p_workplace;
    if n_ok + n_skip > 0 then
      raise notice 'admin_set_day_off(%, %): restored=% skipped=%', p_date, p_workplace, n_ok, n_skip;
    end if;
  end if;
end; $$;


-- ============================================================
--  ROLLBACK (주석 · 필요할 때만 블록을 풀어서 실행)
-- ------------------------------------------------------------
--  전체 순서: v2 화면 되돌리기 → 이 SQL → notify 이전 버전 재배포
--            (이 SQL 뒤에는 새 notify 의 event 경로가 테이블이 없어 500 을 냄 · 기존 경로는 영향 없음)
--  이 SQL 순서: ① 휴무 백업 처리 ② 기존 함수 LIVE 본문 복구 ③ 새 RPC/helper 삭제 ④ 테이블 삭제
-- ============================================================
/*
-- ① 휴무 백업 처리. 백업 행은 "지금 휴무인 날"에만 있음 (해제할 때마다 그날 백업은 전부 지워지므로)
--    테이블을 지우면 그날들의 근무를 되살릴 방법이 없어지므로, 아래 둘 중 하나를 고른 뒤에만 ①-c 가 통과함
--
-- ①-a 백업이 있는 휴무일 목록 (읽기 전용)
--   select b.work_date, b.workplace, count(*) as shifts,
--          sum(jsonb_array_length(b.swap_requests)) as swap_requests,
--          sum(jsonb_array_length(b.slot_applications)) as applications,
--          bool_or(c.work_date is not null) as still_closed
--     from closure_shift_backup b
--     left join closures c on c.work_date = b.work_date and c.workplace = b.workplace
--    group by 1, 2 order by 1, 2;
--
-- 방법 A (권장): v2 SQL 이 아직 살아 있을 때 위 목록의 날을 관리자 화면에서 '휴무 해제' → 근무가 복원되고 백업이 비워짐.
--               그날을 계속 쉬게 하려면 롤백이 끝난 뒤 다시 휴무 지정 (LIVE 방식: 근무는 다시 삭제됨)
-- 방법 B: 백업을 통째로 내보내 파일로 보관한 뒤, 일부러 비우기
--   ①-b 내보내기 (읽기 전용 · 결과 JSON 을 파일로 저장해 두세요)
--   select json_agg(to_jsonb(b) order by b.work_date, b.workplace, b.shift_id) from closure_shift_backup b;
--   저장을 확인한 뒤에만 이 한 줄을 따로 실행 (휴무일 근무를 버리는 결정):
--   -- delete from closure_shift_backup;
--
-- ①-c 확인: 백업이 남아 있으면 여기서 중단 (조용히 버리는 일은 없음)
do $$ declare n bigint := 0; begin
  if to_regclass('public.closure_shift_backup') is not null then
    execute 'select count(*) from closure_shift_backup' into n;
  end if;
  if n > 0 then
    raise exception 'closure_shift_backup 에 % 행이 남아 있어요. 방법 A(휴무 해제) 또는 방법 B(내보낸 뒤 삭제)를 먼저 하세요.', n;
  end if;
end $$;

-- ② LIVE 본문 복구 (2026-10-28 pg_get_functiondef 그대로)
create or replace function admin_approve_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; a slot_applications;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  select * into a from slot_applications where id = p_app_id;
  if a.id is null then raise exception '신청을 찾을 수 없습니다'; end if;
  update shifts set staff_id = a.applicant_id, status = 'confirmed' where id = a.shift_id;
  update slot_applications set status='rejected' where shift_id = a.shift_id and status='open' and id <> p_app_id;
  update slot_applications set status='approved' where id = p_app_id;
end; $$;

create or replace function admin_reject_application(p_admin_id bigint, p_pin text, p_app_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  update slot_applications set status='rejected' where id = p_app_id;
end; $$;

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

create or replace function admin_set_published(p_admin_id bigint, p_pin text, p_ym text, p_pub boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  insert into schedule_status(ym, published, updated_at) values (p_ym, p_pub, now())
    on conflict (ym) do update set published = excluded.published, updated_at = now();
end; $$;

create or replace function admin_set_day_off(p_admin_id bigint, p_pin text, p_date date, p_workplace text, p_off boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if p_off then
    delete from shifts where work_date = p_date and workplace = p_workplace;
    insert into closures(work_date, workplace) values (p_date, p_workplace) on conflict do nothing;
  else
    delete from closures where work_date = p_date and workplace = p_workplace;
  end if;
end; $$;

-- ③ 새 RPC / helper 삭제
drop function if exists admin_reset_pin(bigint, text, bigint);
drop function if exists admin_remind_submission(bigint, text, text);
drop function if exists mark_my_notifications_read(bigint, text, bigint[]);
drop function if exists my_notifications(bigint, text, int);
drop function if exists _add_notifications(bigint[], text, text, text, jsonb);
drop function if exists _ym_label(text);
drop function if exists _md_label(date);

-- ④ 테이블 삭제 (알림 기록은 사라짐 · 필요하면 먼저 내보내기)
drop table if exists closure_shift_backup;
drop table if exists staff_notifications;
*/


-- ============================================================
--  DRY-RUN 테스트 (주석 · 사용자 승인 후, 위 SQL 적용 "다음에" 이 블록만 따로 실행)
-- ------------------------------------------------------------
--  · 테스트용 관리자/직원/세션/근무를 만들고 검사한 뒤 마지막에 raise exception → 전부 롤백 (DB 에 남는 것 없음)
--  · 성공하면 'DRYRUN OK: ...' 오류 메시지로 끝남. 다른 메시지면 그 단계가 실패한 것
--  · PIN 값은 출력하지 않고 일치 여부만 검사
--  · 적용 전에 시험하려면: begin; <위 SQL 전체>; <이 블록>; rollback;  (같은 세션에서)
-- ============================================================
/*
do $$
declare
  d date := date '2099-01-15'; wp text := '데빌'; wp2 text := '메이드'; v_ym text := '2099-01';
  tk_a text := 'tk_dryrun_admin'; tk_1 text := 'tk_dryrun_s1'; tk_2 text := 'tk_dryrun_s2';
  a_id bigint; s1 bigint; s2 bigint;
  sh1 bigint; sh2 bigint; sh3 bigint; sh4 bigint; app1 bigint; req1 bigint; com1 bigint; app3 bigint;
  shA bigint; shG bigint; shE bigint; v_cd text; v_cw text; v_good jsonb;
  n int; n_pub int; n_rem int; tmp text; msg text;
begin
  insert into staff(name, pin, is_admin) values ('__dryrun_admin', '900001', true) returning id into a_id;
  insert into staff(name, pin) values ('__dryrun_s1', '900002') returning id into s1;
  insert into staff(name, pin) values ('__dryrun_s2', '900003') returning id into s2;
  insert into staff_sessions(token_hash, staff_id)
    values (_token_hash(tk_a), a_id), (_token_hash(tk_1), s1), (_token_hash(tk_2), s2);

  -- [1a] 신청 수락 → s1 수락 알림, s2 자동 거절 알림, 근무 배정
  insert into shifts(work_date, workplace, start_time, end_time) values (d, wp, '16:00', '22:00') returning id into sh1;
  insert into slot_applications(shift_id, applicant_id) values (sh1, s1) returning id into app1;
  insert into slot_applications(shift_id, applicant_id) values (sh1, s2);
  perform admin_approve_application(a_id, tk_a, app1);
  assert (select staff_id from shifts where id = sh1) = s1, '1a assign';
  assert (select count(*) from staff_notifications where staff_id = s1 and kind = 'application_approved') = 1, '1a approved row';
  assert (select count(*) from staff_notifications where staff_id = s2 and kind = 'application_rejected') = 1, '1a auto-reject row';
  assert (select body from staff_notifications where staff_id = s1 and kind = 'application_approved') = '1월 15일 데빌 근무가 확정됐어요', '1a body';
  -- 오류 문구 그대로
  begin perform admin_approve_application(a_id, 'tk_wrong', app1); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '관리자만 가능합니다', '1a err: ' || msg;
  begin perform admin_approve_application(a_id, tk_a, -1); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '신청을 찾을 수 없습니다', '1a err2: ' || msg;
  -- notify 의 "가져가기" 를 그대로 옮김 (index.ts 의 PostgREST 필터와 같은 조건):
  --   .is('pushed_at', null) .gt('created_at', 10분 전) + event 별 kind / link 키 · update … returning staff_id,title,body
  -- application_decided {app_id}: 신청 → 근무의 work_date · workplace 를 읽어 link->>date / link->>workplace 로 맞춤
  select sh.work_date::text, sh.workplace into v_cd, v_cw
    from slot_applications a join shifts sh on sh.id = a.shift_id where a.id = app1;
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind in ('application_approved', 'application_rejected')
                and link->>'date' = v_cd and link->>'workplace' = v_cw
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 2, '1a claim approved + auto-rejected: ' || n;
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind in ('application_approved', 'application_rejected')
                and link->>'date' = v_cd and link->>'workplace' = v_cw
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 0, '1a claim only once: ' || n;

  -- [1b] 거절 → 이미 거절된 s2 에게는 중복 알림 없음 / 없는 id 는 오류 없이 통과 (LIVE 와 같음)
  perform admin_reject_application(a_id, tk_a, (select id from slot_applications where shift_id = sh1 and applicant_id = s2));
  assert (select count(*) from staff_notifications where staff_id = s2 and kind = 'application_rejected') = 1, '1b no dup';
  perform admin_reject_application(a_id, tk_a, -1);

  -- [1c] 대타: s1 요청 → s2 수락 → s1 에게 '__dryrun_s2님이 대타를 맡았어요'
  perform request_sub(s1, tk_1, sh1, 'dryrun');
  select id into req1 from swap_requests where shift_id = sh1 and status = 'open';
  begin perform accept_sub(s1, tk_1, req1); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '본인 대타는 직접 설 수 없어요', '1c err: ' || msg;
  perform accept_sub(s2, tk_2, req1);
  assert (select body from staff_notifications where staff_id = s1 and kind = 'swap_taken') = '__dryrun_s2님이 대타를 맡았어요', '1c body';
  assert (select staff_id from shifts where id = sh1) = s2, '1c moved';
  -- notify(swap_taken {request_id}) 의 관문 + 가져가기: link->>request_id
  assert exists (select 1 from swap_requests where id = req1 and status = 'completed' and taker_id = s2), '1c notify gate';
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'swap_taken'
                and link->>'request_id' = req1::text
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 1, '1c claim: ' || n;
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'swap_taken'
                and link->>'request_id' = req1::text
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 0, '1c claim only once: ' || n;

  -- [1d] 공개: false → true 일 때만, 한 번만
  insert into schedule_status(ym, published) values (v_ym, false);
  perform admin_set_published(a_id, tk_a, v_ym, true);
  select count(*) into n_pub from staff_notifications where kind = 'schedule_published' and link->>'ym' = v_ym;
  assert n_pub = (select count(*) from staff where pin is not null and id <> a_id), '1d count';
  assert exists (select 1 from staff_notifications where staff_id = s1 and kind = 'schedule_published' and body = '1월 스케줄이 공개됐어요'), '1d body';
  perform admin_set_published(a_id, tk_a, v_ym, true);
  assert (select count(*) from staff_notifications where kind = 'schedule_published' and link->>'ym' = v_ym) = n_pub, '1d no dup';
  -- notify(published {ym}) 가져가기: link->>ym · 쓴 행 수만큼, 두 번째는 0 (다시 보내기 방지)
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'schedule_published'
                and link->>'ym' = v_ym
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = n_pub, '1d claim';
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'schedule_published'
                and link->>'ym' = v_ym
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 0, '1d claim only once';
  -- 형식이 이상한 ym: 초안 행을 먼저 만들어 알림(_ym_label) 경로를 실제로 탐 → LIVE 처럼 오류 없이 통과
  assert _ym_label('bad-ym') = 'bad-ym' and _ym_label(null) = '', '1d _ym_label direct';
  insert into schedule_status(ym, published) values ('bad-ym', false);
  perform admin_set_published(a_id, tk_a, 'bad-ym', true);
  assert exists (select 1 from staff_notifications where staff_id = s1 and kind = 'schedule_published'
                  and link->>'ym' = 'bad-ym' and body = 'bad-ym 스케줄이 공개됐어요'), '1d bad-ym row';

  -- [1e] 미제출자 알림: 제출 마감 상태면 오류 → 열고 s1 만 제출 → s1 제외, s2 포함
  begin perform admin_remind_submission(a_id, tk_a, v_ym); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '지금은 제출 기간이 아니에요', '1e closed: ' || msg;
  perform admin_set_submit_open(a_id, tk_a, v_ym, true);
  perform submit_shift(s1, tk_1, v_ym, '[{"qkey":"d:2099-01-15","choice":"가능"}]'::jsonb);
  n_rem := admin_remind_submission(a_id, tk_a, v_ym);
  assert not exists (select 1 from staff_notifications where staff_id = s1 and kind = 'submission_reminder'), '1e s1 excluded';
  assert exists (select 1 from staff_notifications where staff_id = s2 and kind = 'submission_reminder'), '1e s2 included';
  assert not exists (select 1 from staff_notifications where staff_id = a_id and kind = 'submission_reminder'), '1e caller excluded';
  -- notify(remind_submission {ym}) 가져가기: link->>ym
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'submission_reminder'
                and link->>'ym' = v_ym
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = n_rem, '1e claim: ' || n;
  with c as (update staff_notifications set pushed_at = now()
              where pushed_at is null and created_at > now() - interval '10 minutes'
                and kind = 'submission_reminder'
                and link->>'ym' = v_ym
              returning staff_id, title, body)
  select count(*) into n from c;
  assert n = 0, '1e claim only once: ' || n;
  begin perform admin_remind_submission(s1, tk_1, v_ym); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '관리자만 가능합니다', '1e non-admin: ' || msg;

  -- [1f] 내 알림 / 읽음 처리 (남의 알림은 못 건드림)
  assert (select count(*) from my_notifications(s1, tk_1)) = (select count(*) from staff_notifications where staff_id = s1), '1f list';
  n := mark_my_notifications_read(s2, tk_2, array(select id from staff_notifications where staff_id = s1));
  assert n = 0, '1f other ids';
  n := mark_my_notifications_read(s1, tk_1, null);
  assert n = (select count(*) from staff_notifications where staff_id = s1) and n > 0, '1f mark all';
  assert not exists (select 1 from my_notifications(s1, tk_1) where read_at is null), '1f all read';
  begin perform my_notifications(s1, 'tk_wrong'); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = 'PIN이 올바르지 않습니다', '1f err: ' || msg;

  -- [3] 휴무: s2 근무(sh2)에 열린 대타요청 + 댓글, 빈 근무(sh3)에 s1 신청 → 휴무 → 해제 → 같은 id 로 복원
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 1, wp, '16:00', '22:00', s2) returning id into sh2;
  insert into shifts(work_date, workplace, start_time, end_time) values (d + 1, wp, '22:00', '05:00') returning id into sh3;
  perform request_sub(s2, tk_2, sh2, 'dryrun');
  select id into req1 from swap_requests where shift_id = sh2 and status = 'open';
  perform add_swap_comment(s1, tk_1, req1, 'dryrun comment');
  select id into com1 from swap_comments where request_id = req1;
  perform apply_slot(s1, tk_1, sh3);
  select id into app3 from slot_applications where shift_id = sh3;
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, true);
  assert not exists (select 1 from shifts where work_date = d + 1 and workplace = wp), '3 shifts moved';
  assert (select count(*) from closure_shift_backup where work_date = d + 1 and workplace = wp) = 2, '3 backup rows';
  assert exists (select 1 from closures where work_date = d + 1 and workplace = wp), '3 closure on';
  assert not exists (select 1 from swap_requests where id = req1), '3 cascade happened';
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, false);
  assert (select staff_id from shifts where id = sh2) = s2, '3 sh2 restored same id';
  assert (select status from shifts where id = sh2) = 'seeking_sub', '3 sh2 status';
  assert exists (select 1 from shifts where id = sh3 and staff_id is null), '3 sh3 restored';
  assert (select status from swap_requests where id = req1) = 'open', '3 request restored';
  assert exists (select 1 from swap_comments where id = com1 and request_id = req1), '3 comment restored';
  assert exists (select 1 from slot_applications where id = app3 and status = 'open'), '3 application restored';
  assert not exists (select 1 from closure_shift_backup where work_date = d + 1 and workplace = wp), '3 backup cleared';
  assert not exists (select 1 from closures where work_date = d + 1 and workplace = wp), '3 closure off';
  -- [3-2] 다시 휴무 → 이미 휴무인 날 다시 지정은 아무것도 안 함
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, true);
  assert (select count(*) from closure_shift_backup where work_date = d + 1 and workplace = wp) = 2, '3-2 re-close backup';
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, true);
  assert (select count(*) from closure_shift_backup where work_date = d + 1 and workplace = wp) = 2, '3-2 close twice no-op';
  -- 휴무 중 같은 직원(s2)을 다시 배정 (근무 추가 RPC 는 closures 를 보지 않음) → 다시 지정해도 지우지 않음
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 1, wp, '16:00', '22:00', s2) returning id into sh4;
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, true);
  assert exists (select 1 from shifts where id = sh4), '3-2 no-op close keeps sh4';
  assert not exists (select 1 from closure_shift_backup where shift_id = sh4), '3-2 no-op close no backup';
  -- 해제 → (a) s2 가 그날 이미 근무 → sh2 버림 (열린 대타요청도 안 돌아옴)
  --        (c) 빈자리 sh3 는 그날+근무지에 이미 근무(sh4)가 있어 버림 (다시 짠 날) · 백업은 전부 비움
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, false);
  assert (select count(*) from shifts where work_date = d + 1 and workplace = wp and staff_id = s2) = 1, '3-2 no duplicate';
  assert not exists (select 1 from shifts where id = sh2), '3-2 (a) conflicting sh2 dropped';
  assert not exists (select 1 from swap_requests where id = req1), '3-2 stale request dropped';
  assert not exists (select 1 from shifts where id = sh3), '3-2 (c) empty slot dropped on re-planned day';
  assert not exists (select 1 from slot_applications where id = app3), '3-2 (c) its application dropped';
  assert not exists (select 1 from closure_shift_backup where work_date = d + 1 and workplace = wp), '3-2 backup empty after un-close';
  assert not exists (select 1 from closures where work_date = d + 1 and workplace = wp), '3-2 closure off';
  -- [3-3] 충돌이 아닌 실패 → 해제 전체 취소 (휴무 유지 · 백업 그대로), 고친 뒤 다시 해제하면 복원 · 예전 sh2 는 되살아나지 않음
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, true);
  assert (select count(*) from closure_shift_backup where work_date = d + 1 and workplace = wp) = 1, '3-3 backup rows';
  select shift_row into v_good from closure_shift_backup where shift_id = sh4;
  update closure_shift_backup set shift_row = shift_row || '{"id": "not-a-number"}'::jsonb where shift_id = sh4;
  begin perform admin_set_day_off(a_id, tk_a, d + 1, wp, false); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '근무 1건을 되돌리지 못해 휴무를 풀지 않았어요. 관리자에게 알려 주세요', '3-3 err: ' || msg;
  assert exists (select 1 from closures where work_date = d + 1 and workplace = wp), '3-3 still closed';
  assert (select count(*) from closure_shift_backup where work_date = d + 1 and workplace = wp) = 1, '3-3 backup kept';
  assert not exists (select 1 from shifts where id = sh4), '3-3 nothing restored';
  update closure_shift_backup set shift_row = v_good where shift_id = sh4;
  perform admin_set_day_off(a_id, tk_a, d + 1, wp, false);
  assert exists (select 1 from shifts where id = sh4 and staff_id = s2), '3-3 sh4 restored';
  assert (select count(*) from shifts where work_date = d + 1 and workplace = wp and staff_id = s2) = 1, '3-3 no resurrection';
  assert not exists (select 1 from shifts where id = sh2), '3-3 sh2 stays gone';
  assert not exists (select 1 from closure_shift_backup where work_date = d + 1 and workplace = wp), '3-3 backup empty after un-close';
  assert not exists (select 1 from closures where work_date = d + 1 and workplace = wp), '3-3 closure off';
  -- [3-4] 다른 근무지로 다시 짠 날: (a) 같은 직원이 다른 층에 있음 · (b) 같은 이름 게스트가 다른 층에 있음 → 버림
  --       (c) 그 근무지는 비어 있으므로 빈자리는 복원
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 3, wp, '16:00', '22:00', s1) returning id into shA;
  insert into shifts(work_date, workplace, start_time, end_time, guest_name) values (d + 3, wp, '16:00', '22:00', '__dryrun_guest') returning id into shG;
  insert into shifts(work_date, workplace, start_time, end_time) values (d + 3, wp, '22:00', '05:00') returning id into shE;
  perform admin_set_day_off(a_id, tk_a, d + 3, wp, true);
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 3, wp2, '16:00', '22:00', s1);
  insert into shifts(work_date, workplace, start_time, end_time, guest_name) values (d + 3, wp2, '16:00', '22:00', '__dryrun_guest');
  perform admin_set_day_off(a_id, tk_a, d + 3, wp, false);
  assert not exists (select 1 from shifts where id = shA), '3-4 (a) staff on another floor';
  assert (select count(*) from shifts where work_date = d + 3 and staff_id = s1) = 1, '3-4 (a) one floor per day';
  assert not exists (select 1 from shifts where id = shG), '3-4 (b) guest on another floor';
  assert (select count(*) from shifts where work_date = d + 3 and guest_name = '__dryrun_guest') = 1, '3-4 (b) one guest per day';
  assert exists (select 1 from shifts where id = shE and staff_id is null and guest_name is null), '3-4 (c) empty slot restored';
  assert not exists (select 1 from closure_shift_backup where work_date = d + 3), '3-4 backup empty';
  -- 같은 직원의 근무 2개 → 둘 다 같은 id 로 복원
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 2, wp, '16:00', '22:00', s1) returning id into sh1;
  insert into shifts(work_date, workplace, start_time, end_time, staff_id) values (d + 2, wp, '22:00', '05:00', s1) returning id into sh3;
  perform admin_set_day_off(a_id, tk_a, d + 2, wp, true);
  perform admin_set_day_off(a_id, tk_a, d + 2, wp, false);
  assert (select count(*) from shifts where id in (sh1, sh3) and staff_id = s1) = 2, '3 two shifts same staff restored';
  assert not exists (select 1 from closure_shift_backup where work_date = d + 2), '3 two shifts backup cleared';
  begin perform admin_set_day_off(s1, tk_1, d + 1, wp, true); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '관리자만 가능합니다', '3 err: ' || msg;

  -- [2] PIN 초기화 (마지막: s1 세션이 사라지므로)
  begin perform admin_reset_pin(a_id, tk_a, a_id); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '본인 PIN은 초기화할 수 없어요', '2 self: ' || msg;
  begin perform admin_reset_pin(s2, tk_2, s1); msg := 'no error';
  exception when others then msg := sqlerrm; end;
  assert msg = '관리자만 가능합니다', '2 non-admin: ' || msg;
  update staff set failed_attempts = 4, locked = true where id = s1;
  tmp := admin_reset_pin(a_id, tk_a, s1);
  assert tmp ~ '^\d{6}$', '2 format';
  assert exists (select 1 from staff where id = s1 and pin = tmp and pin_temp and not locked and failed_attempts = 0), '2 stored';
  assert not exists (select 1 from staff_sessions where staff_id = s1), '2 sessions cleared';
  assert exists (select 1 from staff_sessions where staff_id = a_id), '2 admin session kept';
  assert (select count(*) from staff_signin('__dryrun_s1', tmp) where token is not null) = 1, '2 can sign in';
  tmp := null;

  raise exception 'DRYRUN OK: published_rows=% reminder_rows=%', n_pub, n_rem;
end $$;
*/
