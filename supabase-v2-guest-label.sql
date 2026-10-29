-- v2 게스트 표시 선택 (2026-10-29)
-- 명단에 없는 이름으로 넣은 근무(guest_name / 야간 member_name)는 손님 페이지에 '게스트'로 떠요.
-- 직원인데 명단에 아직 없어서 이름만 넣은 경우가 있어서, 근무마다 '게스트' 표시를 끌 수 있게 해요.
--
-- 바뀌는 것
--   1) shifts.show_guest, night_members.show_guest (boolean, 기본 true → 지금 데이터는 그대로 게스트로 보여요)
--   2) shift_view / night_member_view: is_guest 가 show_guest 를 따르고, 맨 끝에 show_guest 칸이 붙어요
--      (칸 순서는 그대로라 v1 index.html·staff.html 은 그대로 읽혀요. 표시를 끈 줄만 게스트 표시가 빠져요)
--   3) admin_set_guest_label: 관리자가 날짜·매장·이름으로 그 게스트 근무(주간·야간)의 표시를 켜고 꺼요
--      기존 admin_add_shift / admin_update_shift / admin_add_night_member 는 건드리지 않아요
--
-- 적용: begin; … commit; 으로 감싸서 실행. 먼저 begin; … rollback; 으로 시험해요.

alter table public.shifts        add column if not exists show_guest boolean not null default true;
alter table public.night_members add column if not exists show_guest boolean not null default true;

create or replace view public.shift_view as
 SELECT sh.id,
    sh.work_date,
    sh.workplace,
    sh.start_time,
    sh.end_time,
    sh.status,
    sh.memo,
    sh.staff_id,
    st.name AS staff_name,
    sh.guest_name,
    COALESCE(st.name, sh.guest_name) AS display_name,
    ((sh.staff_id IS NULL) AND (sh.guest_name IS NOT NULL) AND sh.show_guest) AS is_guest,
    st.instagram AS staff_instagram,
    st.avatar_url AS staff_avatar,
    sh.show_guest
   FROM (shifts sh
     LEFT JOIN staff st ON ((st.id = sh.staff_id)));

create or replace view public.night_member_view as
 SELECT nm.id,
    nm.work_date,
    nm.workplace,
    nm.staff_id,
    COALESCE(st.name, nm.member_name) AS member_name,
    st.avatar_url AS avatar,
    st.instagram,
    ((nm.staff_id IS NULL) AND nm.show_guest) AS is_guest,
    nm.show_guest
   FROM (night_members nm
     LEFT JOIN staff st ON ((st.id = nm.staff_id)))
  ORDER BY nm.id;

-- 그 날·그 매장에서 이 이름으로 넣은 게스트 근무(주간 shifts + 야간 night_members)의 표시를 바꿔요. 바뀐 줄 수를 돌려줘요.
create or replace function public.admin_set_guest_label(
  p_admin_id bigint, p_pin text, p_date date, p_workplace text, p_name text, p_show boolean)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v staff; n1 integer; n2 integer; nm text := nullif(trim(p_name), '');
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  if nm is null then raise exception '이름이 비어 있어요'; end if;
  update shifts set show_guest = coalesce(p_show, true)
    where work_date = p_date and workplace = p_workplace and staff_id is null and guest_name = nm;
  get diagnostics n1 = row_count;
  update night_members set show_guest = coalesce(p_show, true)
    where work_date = p_date and workplace = p_workplace and staff_id is null and member_name = nm;
  get diagnostics n2 = row_count;
  return n1 + n2;
end; $function$;

revoke all on function public.admin_set_guest_label(bigint, text, date, text, text, boolean) from public;
grant execute on function public.admin_set_guest_label(bigint, text, date, text, text, boolean) to anon, authenticated;
