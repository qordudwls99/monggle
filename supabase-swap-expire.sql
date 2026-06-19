-- ============================================================
--  모에 스케줄 · 대타 글 당일 16시 자동 만료 + 관리자 삭제
-- ------------------------------------------------------------
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
--  여러 번 실행해도 안전합니다. (한국시간 Asia/Seoul 기준)
-- ============================================================

-- 1) 당일 오후 4시(16:00, KST)가 지난 'open' 대타 글을 자동 만료 처리
--    (게시판 열 때마다 호출 → 지난 글은 사라지고, 원래 근무자는 그대로 유지)
create or replace function expire_old_swaps()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  -- 만료될 요청의 근무는 원래 상태(confirmed)로 되돌림
  update shifts set status = 'confirmed'
   where id in (
     select sw.shift_id from swap_requests sw
     join shifts sh on sh.id = sw.shift_id
     where sw.status = 'open'
       and (sh.work_date + interval '16 hours') at time zone 'Asia/Seoul' <= now()
   );
  -- 요청 자체를 만료(취소)
  update swap_requests sw set status = 'cancelled', resolved_at = now()
   from shifts sh
   where sh.id = sw.shift_id and sw.status = 'open'
     and (sh.work_date + interval '16 hours') at time zone 'Asia/Seoul' <= now();
  get diagnostics n = row_count;
  return n;
end; $$;

-- 2) 관리자: 대타 글 삭제 (게시판에서 내리고 근무는 원래대로)
create or replace function admin_delete_swap(p_admin_id bigint, p_pin text, p_request_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; req swap_requests;
begin
  v := _verify(p_admin_id, p_pin);
  if v.id is null or not v.is_admin then raise exception '관리자만 가능합니다'; end if;
  select * into req from swap_requests where id = p_request_id;
  if req.id is null then raise exception '없는 요청이에요'; end if;
  if req.status = 'open' then
    update shifts set status = 'confirmed' where id = req.shift_id;
  end if;
  update swap_requests set status = 'cancelled', resolved_at = now() where id = p_request_id;
end; $$;

grant execute on function expire_old_swaps, admin_delete_swap to anon, authenticated;
