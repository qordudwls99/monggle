-- ============================================================
--  출근 시프트 · 대타 게시판 댓글
-- ------------------------------------------------------------
--  이 파일만 한 번 실행하면 돼요. 여러 번 실행해도 안전합니다.
--  Supabase → SQL Editor → New query → 붙여넣기 → Run
-- ============================================================

create table if not exists swap_comments (
  id bigint generated always as identity primary key,
  request_id bigint not null references swap_requests(id) on delete cascade,
  author_id bigint references staff(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
alter table swap_comments enable row level security;

create or replace view swap_comment_view as
  select c.id, c.request_id, c.author_id,
         coalesce(st.name, '(삭제됨)') as author_name,
         st.avatar_url as avatar, c.body, c.created_at
  from swap_comments c
  left join staff st on st.id = c.author_id
  order by c.created_at;
grant select on swap_comment_view to anon, authenticated;

-- 댓글 작성 (로그인한 직원 누구나)
create or replace function add_swap_comment(p_staff_id bigint, p_pin text, p_request_id bigint, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v staff;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  if nullif(trim(p_body),'') is null then raise exception '내용을 입력하세요'; end if;
  insert into swap_comments(request_id, author_id, body) values (p_request_id, p_staff_id, trim(p_body));
end; $$;

-- 댓글 삭제 (본인 또는 관리자)
create or replace function delete_swap_comment(p_staff_id bigint, p_pin text, p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v staff; c swap_comments;
begin
  v := _verify(p_staff_id, p_pin);
  if v.id is null then raise exception 'PIN이 올바르지 않습니다'; end if;
  select * into c from swap_comments where id = p_id;
  if c.id is null then return; end if;
  if c.author_id <> p_staff_id and not v.is_admin then
    raise exception '본인 댓글만 지울 수 있어요'; end if;
  delete from swap_comments where id = p_id;
end; $$;

grant execute on function add_swap_comment, delete_swap_comment to anon, authenticated;
