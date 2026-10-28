// 대타 게시판 (운영 staff.html 2312-2411): 구하는 중(근무일 16시 전까지) / 정해짐, 글 자세히(시트), 댓글 달기·지우기,
// 대신 들어가기(accept_sub), 내 글 내리기·관리자 지우기(cancel_sub). 그리고 A.swap.request(shift): 대타 구하기 시트(request_sub)
{
  const A = window.App;
  const esc = A.esc;
  const me = () => A.session;
  const where = s => `${A.fmt(s.date)} ${A.storeName(s.wp)}`;
  // 대타 마감 = 근무 당일 16:00 (운영 swapDeadline). 남은 시간 문구, 지났으면 ''
  const deadline = ds => new Date(ds + 'T16:00:00');
  const remain = ds => {
    const diff = deadline(ds) - Date.now();
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };
  const isMine = s => !!me() && s.requesterId === me().id;
  const av = n => A.avatar(n, 'av sw-av');

  // 마지막으로 그린 목록 (자세히 시트가 씀)
  let board = { open: [], done: [], cm: {} };
  const find = id => board.open.find(x => x.id === id) || board.done.find(x => x.id === id);

  // ── 목록 ──
  function rowHtml(s) {
    const open = s.status === 'open', list = board.cm[s.id] || [];
    const top = `${A.storeTag(s.wp)}<span class="sw-date">${esc(A.fmt(s.date))}</span>${isMine(s) ? '<span class="tag soft">내 글</span>' : ''}`;
    const who = open ? `${esc(s.requesterName)}님이 구해요` : `${esc(s.requesterName)}님이 구했어요`;
    const left = open ? remain(s.date) : '';
    const meta = [left ? `마감까지 ${esc(left)}` : '', `댓글 ${list.length}`].filter(Boolean).join(' · ');
    return `<button class="lrow sw" data-sw="${s.id}">
      <span class="lm">
        <span class="sw-top">${top}</span>
        <span class="sw-who">${av(s.requesterName)}<span>${who}</span></span>
        ${open ? '' : `<span class="sw-take"><span class="tag green">${esc(s.takerName || '?')}님이 들어가요</span></span>`}
        ${s.reason ? `<span class="sw-why">${esc(s.reason)}</span>` : ''}
        <span class="sw-meta">${meta}</span>
      </span>${A.ICON.chev}</button>`;
  }
  const section = (title, list, emptyText) =>
    `<section class="sec"><div class="sec-h"><h2>${title}</h2><span class="aside">${list.length}개</span></div>${list.length ? list.map(rowHtml).join('') : `<div class="none">${emptyText}</div>`}</section>`;

  let boardSeq = 0;
  A.screen('swaps', {
    async render(el) {
      const mySeq = ++boardSeq;
      const [open0, done] = await Promise.all([A.store.swaps({ status: 'open' }), A.store.swaps({ status: 'completed', limit: 10 })]);
      const open = open0.filter(s => deadline(s.date) - Date.now() > 0);   // 당일 16시 지난 글은 숨김 (운영 2357)
      const cm = await A.store.comments([...open, ...done].map(s => s.id));
      if (mySeq !== boardSeq) return;                    // 더 새 그리기가 시작됐으면 옛 데이터로 덮지 않기
      board = { open, done, cm };
      let html = A.pageHead('대타', '빠져야 하는 근무를 올리고 대신 들어갈 사람을 찾아요');
      if (!open.length && !done.length) html += A.emptyBox('swap', '지금 구하는 대타가 없어요', '내 근무에서 대타를 올릴 수 있어요');
      else {
        html += section('구하는 중', open, '지금 구하는 대타가 없어요');
        if (done.length) html += section('정해짐', done, '');
      }
      el.innerHTML = html;
      el.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => openDetail(+b.dataset.sw));
    },
  });

  // ── 글 자세히 ──
  function commentsHtml(s) {
    const list = board.cm[s.id] || [], u = me();
    return `<div class="sw-cm-h">댓글 <b>${list.length}</b></div>` + (list.length
      ? `<div class="sw-cms">${list.map(c => {
        const canDel = u && (c.authorId === u.id || u.is_admin);
        return `<div class="sw-cm">${A.avatar({ name: c.authorName, avatar: c.avatar }, 'av sw-av')}<div class="sw-cm-b"><b>${esc(c.authorName)}</b><span>${esc(c.body)}</span></div>${canDel ? `<button class="sw-cm-x" data-cdel="${c.id}" aria-label="댓글 지우기">${A.ICON.x}</button>` : ''}</div>`;
      }).join('')}</div>`
      : `<div class="none sw-none">아직 댓글이 없어요</div>`);
  }
  function detailHtml(s) {
    const open = s.status === 'open', left = open ? remain(s.date) : '';
    const note = open ? '' : `<p class="sw-state"><span class="tag green">${esc(s.takerName || '?')}님이 들어가요</span><span>대타가 정해졌어요.</span></p>`;
    return `<div class="sw-sd-top">${A.storeTag(s.wp)}${isMine(s) ? '<span class="tag soft">내 글</span>' : ''}</div>
      <div class="sw-sd-date">${esc(A.fmt(s.date))}</div>
      <div class="sw-who">${av(s.requesterName)}<span>${esc(s.requesterName)}님이 ${open ? '구해요' : '구했어요'}</span></div>
      ${s.reason ? `<div class="box sw-reason">${esc(s.reason)}</div>` : ''}
      ${left ? `<div class="sw-meta">마감까지 ${esc(left)}</div>` : ''}
      ${note}
      <div class="sw-cmbox" data-cm>${commentsHtml(s)}</div>
      ${open ? `<form class="sw-form" data-form><input class="fld" data-cmt maxlength="200" placeholder="댓글 달기" autocomplete="off" aria-label="댓글"><button type="submit" class="btn" disabled>등록</button></form>` : ''}`;
  }
  async function reloadComments(id, el) {
    const m = await A.store.comments([id]);
    board.cm[id] = m[id] || [];
    const box = el && el.querySelector('[data-cm]');
    if (box && document.contains(box)) { box.innerHTML = commentsHtml(find(id) || { id }); bindDel(id, el); }
  }
  function bindDel(id, el) {
    el.querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
      if (!await A.auth.require()) return;
      if (!await A.confirm({ title: '댓글을 지울까요?', text: '지우면 다시 볼 수 없어요.', ok: '지우기', danger: true })) return;
      const r = await A.api.rpc('delete_swap_comment', { p_staff_id: me().id, p_id: +b.dataset.cdel });
      if (r === false) return;
      await reloadComments(id, el);
      await A.render({ keep: true });
      A.toast('댓글을 지웠어요');
    });
  }
  function openDetail(id) {
    const s0 = find(id); if (!s0) return;
    const open = s0.status === 'open', admin = A.isAdmin();
    const actions = [];
    if (open && isMine(s0)) actions.push({ label: '글 내리기', kind: 'danger', onClick: c => withdraw(s0, c) });
    else if (open) {
      if (admin) actions.push({ label: '지우기', kind: 'danger', onClick: c => adminDelete(s0, c) });
      actions.push({ label: '대신 들어갈게요', kind: 'primary', onClick: c => take(s0, c) });
    }
    A.sheet({ title: '대타 글', html: detailHtml(s0), actions, onOpen: el => {
      bindDel(id, el);
      const form = el.querySelector('[data-form]');
      if (!form) return;
      const inp = form.querySelector('[data-cmt]'), btn = form.querySelector('button');
      let busy = false;
      inp.oninput = () => { btn.disabled = !inp.value.trim(); };
      form.onsubmit = async e => {
        e.preventDefault();
        const body = inp.value.trim();
        if (!body || busy) return;
        if (!await A.auth.require()) return;
        busy = true; btn.disabled = true;
        const r = await A.api.rpc('add_swap_comment', { p_staff_id: me().id, p_request_id: id, p_body: body });
        busy = false;
        if (r === false) { btn.disabled = !inp.value.trim(); return; }
        // 요청자 + 앞서 댓글 단 사람에게 푸시 (운영 2406 과 같은 body)
        A.api.notify({ request_id: id, body, author_name: me().name, author_id: me().id });
        inp.value = ''; btn.disabled = true;
        await reloadComments(id, el);
        await A.render({ keep: true });
        A.toast('댓글을 남겼어요');
        if (document.contains(inp)) inp.focus();
      };
      // Enter 로 등록 (운영 2410). 한글 조합 중에는 무시
      inp.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (form.requestSubmit) form.requestSubmit(); else form.dispatchEvent(new Event('submit', { cancelable: true })); } };
    } });
  }

  // ── 동작 ──
  // 그날 그 매장에 이미 내 근무가 있으면 true (읽기 실패면 막지 않아요)
  async function alreadyThere(s) {
    try {
      await A.store.ensure(s.date, s.date);
      return A.store.day(s.date, s.wp).shifts.some(x => x.staffId === me().id);
    } catch (e) { return false; }
  }
  async function take(s, close) {
    if (!await A.auth.require()) return;
    if (isMine(s)) { A.toast('내가 올린 대타 글이에요', true); return; }   // 로그인하고 보니 내 글
    if (await alreadyThere(s)) { A.toast('이 날 이 매장에 이미 근무가 있어서 대신 들어갈 수 없어요', true); return; }
    if (!await A.confirm({ title: `${where(s)}에 ${s.requesterName}님 대신 들어갈까요?`, text: `${s.requesterName}님은 이 근무에서 빠지고, 내 근무로 들어와요.`, ok: '들어갈게요' })) return;
    const r = await A.api.rpc('accept_sub', { p_staff_id: me().id, p_request_id: s.id });
    if (r === false) return;
    const v2 = !!(A.features && A.features.v2db);
    if (v2) A.api.notify({ event: 'swap_taken', request_id: s.id });   // 요청자에게 (v2 DB 가 있을 때만)
    close();
    A.store.invalidate(s.date, s.date);
    await A.render({ keep: true });
    A.toast(v2 ? `대타가 정해졌어요. ${s.requesterName}님에게 알려 드려요` : '대타를 맡았어요. 고마워요');
  }
  async function cancelReq(s, close, msg) {
    const r = await A.api.rpc('cancel_sub', { p_staff_id: me().id, p_request_id: s.id });
    if (r === false) return;
    close();
    A.store.invalidate(s.date, s.date);
    await A.render({ keep: true });
    A.toast(msg);
  }
  async function withdraw(s, close) {
    if (!await A.auth.require()) return;
    if (!await A.confirm({ title: '대타 글을 내릴까요?', text: `${where(s)} 근무는 그대로 내 근무로 남아요.`, ok: '글 내리기', cancel: '그대로 두기', danger: true })) return;
    await cancelReq(s, close, '대타 글을 내렸어요');
  }
  // 관리자는 남의 글도 내릴 수 있어요 (운영 2396-2399)
  async function adminDelete(s, close) {
    if (!await A.auth.require()) return;
    if (!await A.confirm({ title: '이 대타 글을 지울까요?', text: `${s.requesterName}님 · ${where(s)}. 지우면 게시판에서 사라지고, 근무는 ${s.requesterName}님에게 그대로 남아요.`, ok: '지우기', danger: true })) return;
    await cancelReq(s, close, '대타 글을 지웠어요');
  }

  // ── 대타 구하기 (내 근무, 일별 카드에서) ── shift: Shift (주간 근무만; 야간은 request_sub 가 받지 않아요)
  // 보름 안에 2번 이상 구했으면 한 번 더 물어봐요 (운영 2323-2332, 문구만 부드럽게)
  async function nagOk(u) {
    const since = new Date(Date.now() - 15 * 864e5).toISOString();
    const cnt = (await A.store.swaps({ requesterId: u.id, since })).filter(r => r.status !== 'cancelled').length;
    if (cnt < 2) return true;
    return A.confirm({ title: `최근 보름 동안 대타를 ${cnt}번 구했어요`, text: '자주 빠지면 같이 일하는 분들이 힘들 수 있어요. 그래도 올릴까요?', ok: '그래도 올리기', cancel: '다시 생각하기' });
  }
  async function request(shift) {
    if (!shift || shift.id == null || shift.night) return false;
    if (!await A.auth.require()) return false;
    return new Promise(res => {
      let done = false, busy = false;
      const fin = v => { if (!done) { done = true; res(v); } };
      A.sheet({
        title: '대타 구하기',
        html: `<p class="sheet-p">${esc(where(shift))} 근무에서 빠져요. 게시판에 올리면 대신 들어갈 사람을 찾을 수 있어요.</p>
          <label class="fld-l">빠져야 하는 이유 (안 적어도 돼요)<textarea class="fld" data-why placeholder="예: 갑자기 일이 생겼어요"></textarea></label>`,
        onClose: () => fin(false),
        actions: [{ label: '취소' }, { label: '대타 올리기', kind: 'primary', onClick: async (c, el) => {
          if (busy) return;
          const u = me(); if (!u) { c(); return; }
          const btn = el.querySelector('.sheet-a .primary');
          busy = true; btn.setAttribute('aria-busy', 'true');
          try {
            const reason = el.querySelector('[data-why]').value.trim();
            if (!await nagOk(u)) return;
            const r = await A.api.rpc('request_sub', { p_staff_id: u.id, p_shift_id: shift.id, p_reason: reason || null });
            if (r === false) return;
            A.api.notify({ to: 'admins', title: '대타 요청', body: `${u.name}님이 대타를 구해요`, exclude_id: u.id });   // 운영 2334
            fin(true); c();
            A.store.invalidate(shift.date, shift.date);
            await A.render({ keep: true });
            A.toast('대타 요청을 올렸어요');
            if (A.state.tab !== 'swaps') {
              A.confirm({ title: '대타를 올렸어요', text: '게시판에서 댓글을 받고 대신 들어갈 사람을 만날 수 있어요.', ok: '게시판 보기', cancel: '여기에 있기' })
                .then(go => { if (go) A.go('swaps'); });
            }
          } finally { busy = false; if (document.contains(btn)) btn.removeAttribute('aria-busy'); }
        } }],
        onOpen: el => el.querySelector('[data-why]').focus(),
      });
    });
  }

  A.swap = { request };
}
