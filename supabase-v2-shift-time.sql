-- v2 근무 시간 직접 넣기 (2026-10-29, 초안 · 아직 적용 안 함)
-- 손님 페이지 '근무 상태'는 데빌 주간·야간 시간을 기본으로 써요.
-- 그날 다르게 나오면 그 출근자가 직원 페이지에서 자기 근무 시간을 직접 넣어요.
--
-- 바뀌는 것
--   1) night_members.start_time, end_time (text, 기본 null). 주간 shifts 에는 이미 start_time/end_time 칸이 있어요
--   2) night_member_view: 맨 끝(show_guest 뒤)에 start_time, end_time 칸이 붙어요. 앞 칸 순서는 그대로예요
--   3) set_my_shift_time: 본인 근무(주간 shifts / 야간 night_members)의 시간을 넣거나 지워요
--      - 본인 근무만, 오늘(한국 시간 06시 기준)부터의 근무만 바꿀 수 있어요
--      - HH:MM 만 받아요. 빈 값이면 지워서 데빌 기본 시간으로 돌아가요
--      관리자용 admin_add_shift / admin_update_shift 는 건드리지 않아요 (이미 p_start / p_end 를 받아요)
--
-- supabase-v2-guest-label.sql 을 적용한 뒤에 실행해요 (night_member_view 의 show_guest 칸을 그대로 둬요).
-- 적용: begin; … commit; 으로 감싸서 실행. 먼저 begin; … rollback; 으로 시험해요.

alter table public.night_members add column if not exists start_time text;
alter table public.night_members add column if not exists end_time   text;

create or replace view public.night_member_view as
 SELECT nm.id,
    nm.work_date,
    nm.workplace,
    nm.staff_id,
    COALESCE(st.name, nm.member_name) AS member_name,
    st.avatar_url AS avatar,
    st.instagram,
    ((nm.staff_id IS NULL) AND nm.show_guest) AS is_guest,
    nm.show_guest,
    nm.start_time,
    nm.end_time
   FROM (night_members nm
     LEFT JOIN staff st ON ((st.id = nm.staff_id)))
  ORDER BY nm.id;

-- p_kind: 'day' = shifts.id, 'night' = night_members.id
create or replace function public.set_my_shift_time(
  p_staff_id bigint, p_pin text, p_kind text, p_id bigint, p_start text, p_end text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v staff;
  s text := nullif(trim(p_start), '');
  e text := nullif(trim(p_end), '');
  today date := ((now() at time zone 'Asia/Seoul') - interval '6 hours')::date;
  n integer;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  if (s is not null and s !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
     or (e is not null and e !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '시간은 HH:MM 으로 적어 주세요';
  end if;
  if p_kind = 'day' then
    update shifts set start_time = coalesce(s, ''), end_time = coalesce(e, '')
      where id = p_id and staff_id = v.id and work_date >= today;
  elsif p_kind = 'night' then
    update night_members set start_time = s, end_time = e
      where id = p_id and staff_id = v.id and work_date >= today;
  else
    raise exception '잘못된 근무예요';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception '내 근무만, 오늘부터 바꿀 수 있어요'; end if;
  return true;
end; $function$;

revoke all on function public.set_my_shift_time(bigint, text, text, bigint, text, text) from public;
grant execute on function public.set_my_shift_time(bigint, text, text, bigint, text, text) to anon, authenticated;
