// 스케줄 화면 틀(보기 전환·편집·매장 칩·날짜 줄·달력 시트) + 일별 보기 + 관리자 편집 도구
// 주간·월간·야간은 11-views.js 가 App.view() 로 등록해요. 끌어 옮기기는 13-drag.js (App.drag.bind).
// 운영 staff.html: 렌더 2052-2147, 근무 카드 2170-2220, 근무 시트 2223-2310, 달력 1732-1753
{
  const A = window.App;
  const S = A.state, I = A.ICON, esc = A.esc;
  const VIEWS = [['day', '일별'], ['week', '주간'], ['month', '월간'], ['night', '야간']];
  const NIGHT_DEFAULT = '주간 16:00~23:00 · 야간 23:00~익일 05:00';
  const me = () => A.session;
  const isMine = p => !!(me() && p.staffId != null && p.staffId === me().id);
  const where = (ds, wp) => `${A.fmt(ds)} ${A.storeName(wp)}`;
  const v2db = () => !!(A.features && A.features.v2db);
  const rpc = (fn, args, opt) => A.api.rpc(fn, args, opt);
  const adminId = () => (me() ? me().id : null);
  // 쓰기 성공 뒤: 캐시 비우기 → 다시 그리기 → 알림
  async function done(ds, msg, all = false) {
    if (all) A.store.invalidateAll(); else A.store.invalidate(ds, ds);
    await A.render({ keep: true });
    if (msg) A.toast(msg);
  }

  // ── 모든 보기가 같이 쓰는 도우미 (공개 전 달) ──
  A.draftBar = ds => `<div class="draft-bar">${I.lock}<span><b>${+String(ds).slice(5, 7)}월은 작성 중</b> · 직원·손님에겐 안 보여요</span><button class="btn sm primary" data-publish="${A.ymOf(ds)}">공개하기</button></div>`;
  A.lockedMonth = () => A.emptyBox('lock', '아직 공개되지 않은 달이에요', '스케줄이 확정되면 볼 수 있어요');
  A.bindDraft = root => root.querySelectorAll('[data-publish]').forEach(b => b.onclick = async () => {
    const ym = b.dataset.publish, m = +ym.slice(5);
    if (!await A.confirm({ title: `${m}월 스케줄을 공개할까요?`, text: '공개하면 직원과 손님이 이 달 스케줄을 볼 수 있어요.', ok: '공개하기' })) return;
    const r = await rpc('admin_set_published', { p_admin_id: adminId(), p_ym: ym, p_pub: true });
    if (r === false) return;
    if (v2db()) A.api.notify({ event: 'published', ym });   // 직원들에게 (v2 DB 가 있을 때만)
    await done(`${ym}-01`, `${m}월 스케줄을 공개했어요`, true);
  });

  // ── 스케줄 화면 ──
  function chipsHtml() {
    const chip = (wp, inner, cls = '') => { const t = A.THEMES[wp];
      return `<button class="chip${cls}${S.wp === wp ? ' on' : ''}" data-chip="${wp}" aria-pressed="${S.wp === wp}" style="--c:${t.c};--cs:${t.cs};--ci:${t.ci}">${inner}</button>`; };
    return `<div class="chips" role="group" aria-label="매장">${chip('전체', '<b>전체</b>', ' all')}${A.FLOORS.map(([wp, fl]) =>
      chip(wp, `<img src="${A.logo(wp)}" alt=""><span class="ct"><b>${wp}</b><small>${fl}</small></span>`)).join('')}</div>`;
  }

  A.screen('schedule', { async render(el) {
    const admin = A.isAdmin();
    if (!admin || S.view !== 'day') S.edit = false;
    const v = A.views[S.view];
    const nav = v || A.views.day;                         // 아직 등록 안 된 보기: 날짜 줄은 일별 규칙으로
    el.dataset.theme = A.themeKey(S.wp);
    const editBtn = admin && S.view === 'day'
      ? `<button class="btn sm edit-tg${S.edit ? ' on' : ''}" data-edit-tg aria-pressed="${S.edit}">${S.edit ? '완료' : '편집'}</button>` : '';
    el.innerHTML = `<div class="sched-h"><div class="seg" role="tablist" aria-label="보기">${VIEWS.map(([k, l]) => `<button data-v="${k}" role="tab" aria-selected="${S.view === k}" class="${S.view === k ? 'on' : ''}">${l}</button>`).join('')}</div>${editBtn}</div>
      ${v && v.chips === false ? '' : chipsHtml()}
      <div class="datebar"><button class="nav" data-step="-1" aria-label="이전">${I.prev}</button><button class="dlabel" data-cal></button><button class="nav" data-step="1" aria-label="다음">${I.next}</button></div>
      <div class="subline"><span class="today-tag" data-today-tag hidden></span><button class="today-btn" data-today hidden></button></div>
      <div id="list"></div>`;
    const q = s => el.querySelector(s);
    const title = nav.title(S.date), now = nav.isNow(S.date), [tagT, btnT] = nav.now || ['오늘', '오늘로'];
    q('[data-cal]').textContent = title;
    q('[data-cal]').setAttribute('aria-label', `${title} · 눌러서 날짜 고르기`);
    q('[data-today-tag]').textContent = tagT; q('[data-today-tag]').hidden = !now;
    q('[data-today]').textContent = btnT; q('[data-today]').hidden = now;
    el.querySelectorAll('.sched-h [data-v]').forEach(b => b.onclick = () => { if (S.view === b.dataset.v) return; S.view = b.dataset.v; S.dir = 0; A.render(); });
    el.querySelectorAll('.chips [data-chip]').forEach(b => b.onclick = () => { if (S.wp === b.dataset.chip) return; S.wp = b.dataset.chip; S.dir = 0; A.render(); });
    el.querySelectorAll('.datebar [data-step]').forEach(b => b.onclick = () => { const dir = +b.dataset.step; S.date = nav.step(S.date, dir); S.dir = dir; A.render(); });
    q('[data-today]').onclick = () => { const t = A.today(); S.dir = A.ymd(S.date) < t ? 1 : -1; S.date = A.parse(t); A.render(); };
    q('[data-cal]').onclick = () => openCalendar();
    const tg = q('[data-edit-tg]');
    if (tg) tg.onclick = async () => { S.edit = !S.edit; await A.render({ keep: true }); A.toast(S.edit ? '편집 중이에요. 바꾼 내용은 바로 저장돼요' : '편집을 마쳤어요'); };
    const list = q('#list');
    if (!v) list.innerHTML = A.emptyBox('cal', '준비 중인 보기예요', '다른 보기를 골라 주세요');
    else await v.render(list, { ds: A.ymd(S.date), wp: S.wp, admin, edit: admin && S.edit });
    if (!S.quiet) list.classList.add(S.dir > 0 ? 'anim-r' : S.dir < 0 ? 'anim-l' : 'anim-f');
    A.bindDraft(list);
  } });

  // ── 달력 시트 (운영 openCalendar/renderCal) ──
  function openCalendar() {
    const sel = A.ymd(S.date);
    let y = S.date.getFullYear(), m = S.date.getMonth();
    const grid = () => {
      const t = A.today(), first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
      let h = '';
      for (let i = 0; i < first; i++) h += '<span class="calp-c blank" aria-hidden="true"></span>';
      for (let d = 1; d <= n; d++) {
        const ds = A.ymd(new Date(y, m, d)), dow = new Date(y, m, d).getDay();
        h += `<button class="calp-c${dow === 0 ? ' sun' : dow === 6 ? ' sat' : ''}${ds === t ? ' today' : ''}${ds === sel ? ' sel' : ''}" data-d="${ds}" aria-label="${A.fmt(ds)}"${ds === sel ? ' aria-current="date"' : ''}>${d}</button>`;
      }
      return h;
    };
    const html = `<div class="calp"><div class="calp-h"><button class="nav" data-cm="-1" aria-label="이전 달">${I.prev}</button><b data-ct></b><button class="nav" data-cm="1" aria-label="다음 달">${I.next}</button></div>
      <div class="calp-dow">${A.DAYS.map((x, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${x}</span>`).join('')}</div><div class="calp-g" data-cg></div></div>`;
    A.sheet({ title: '날짜 고르기', html, onOpen: (wrap, close) => {
      const paint = () => {
        wrap.querySelector('[data-ct]').textContent = `${y}년 ${m + 1}월`;
        const g = wrap.querySelector('[data-cg]');
        g.innerHTML = grid();
        g.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { close(); S.date = A.parse(b.dataset.d); S.dir = 0; A.render(); });
      };
      wrap.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => { const d = new Date(y, m + +b.dataset.cm, 1); y = d.getFullYear(); m = d.getMonth(); paint(); });
      paint();
    } });
  }

  // ── 일별 보기 ──
  const igBtn = p => { const u = !p.guest ? A.igUrl(p.insta) : null;
    return u ? `<a class="ig" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${esc(p.name)} 인스타그램"><span>${I.ig}</span></a>` : ''; };
  const itemAttrs = (p, night) => night
    ? ` data-night-id="${p.id}" data-date="${esc(p.date)}" data-wp="${esc(p.wp)}" data-name="${esc(p.name)}"`
    : ` data-shift-id="${p.id}" data-date="${esc(p.date)}" data-wp="${esc(p.wp)}" data-name="${esc(p.empty ? '빈 자리' : p.name)}"`;
  const moreBtn = (p, night, label) => `<button class="more" data-more="${night ? 'n' : 's'}:${p.id}" aria-label="${esc(label)} 근무 바꾸기">${I.more}</button>`;

  function memberRow(p, ctx, night, sm) {
    if (night && p.short) {
      return `<div class="row short${sm ? ' sm' : ''}"${itemAttrs(p, true)}><span class="av empty">${I.plus}</span><span class="nm">부족</span>${ctx.edit ? moreBtn(p, true, '부족') : ''}</div>`;
    }
    const mine = isMine(p);
    const seek = !night && p.status === 'seeking_sub' ? '<span class="seek">대타 구하는 중</span>' : '';
    let tail, hasSub = false;
    if (ctx.edit) tail = moreBtn(p, night, p.name);
    else {
      const sub = !night && mine && !ctx.admin && p.status === 'confirmed'
        ? `<button class="btn sm sub-btn" data-sub="${p.id}" aria-label="${esc(where(p.date, p.wp))} 대타 구하기">${sm ? '대타' : '대타 구하기'}</button>` : '';
      hasSub = !!sub;
      tail = sub && sm ? sub : sub + igBtn(p);   // 좁은 칸: 내 줄은 대타 버튼만
    }
    return `<div class="row${sm ? ' sm' : ''}${mine ? ' me' : ''}"${itemAttrs(p, night)}>${A.avatar({ name: p.name, avatar: p.guest ? null : p.avatar })}<span class="nm">${esc(p.name)}</span>${p.guest ? '<span class="gbadge">게스트</span>' : ''}${mine && !(sm && hasSub) ? '<span class="mybadge">나</span>' : ''}${seek}${tail}</div>`;
  }
  function slotRow(s, ctx) {
    let side = '', sub = '';
    const apps = s.applicants || [];
    if (ctx.admin) {
      if (apps.length === 1) { sub = `${esc(apps[0].name)}님이 신청했어요`;
        side = `<div class="slot-a"><button class="btn sm ghost" data-app-no="${apps[0].appId}" data-slot="${s.id}">거절</button><button class="btn sm" data-app-ok="${apps[0].appId}" data-slot="${s.id}">수락</button></div>`; }
      else if (apps.length > 1) { sub = `${apps.length}명이 신청했어요`; side = `<button class="btn sm" data-slot-pick="${s.id}">고르기</button>`; }
      else sub = '아직 신청한 사람이 없어요';
      if (ctx.edit) side += moreBtn(s, false, '빈 자리');
    } else {
      const mine = !!me() && apps.some(a => a.staffId === me().id);
      sub = mine ? (v2db() ? '신청했어요 · 관리자가 확인하면 알려 드려요' : '신청했어요 · 관리자 확인을 기다려요') : '이 자리에 들어갈 수 있어요';
      side = mine ? `<button class="btn sm ghost" data-slot-cancel="${s.id}">신청 취소</button>` : `<button class="btn sm" data-slot-apply="${s.id}">신청하기</button>`;
    }
    return `<div class="row slot"${itemAttrs(s, false)}><span class="av empty">${I.plus}</span><span class="nm">빈 자리<span class="ap">${sub}</span></span>${side}</div>`;
  }
  function floorTools(info) {
    const b = (k, l) => `<button class="btn sm" data-tool="${k}" data-twp="${info.wp}">${l}</button>`;
    if (info.closed) return `<div class="ftools">${b('closed', '휴무 풀기')}</div>`;
    const add = info.night ? b('add', '+ 주간에 넣기') + b('nadd', '+ 야간에 넣기') : b('add', '+ 사람 넣기');
    return `<div class="ftools">${add}${b('event', info.event ? '이벤트 바꾸기' : '이벤트')}${info.wp === '데빌' ? b('night', info.night ? '야간 시간' : '야간 열기') : ''}${b('closed', '휴무로')}</div>`;
  }
  // 영업시간 글은 그대로 보여 줘요. '주간 … · 야간 …' 모양이면 칸 머리에 나눠 싣고, 아니면 한 줄로 (손님 페이지와 같음)
  function dnHtml(info, ctx) {
    const hrs = info.night.hours;
    const pick = k => ((String(hrs).match(new RegExp(k + '\\s*([^·]+)')) || [])[1] || '').trim();
    const dh = pick('주간'), nh = pick('야간');
    const sm = !ctx.edit;                                  // 편집 중에는 이름이 잘리지 않게 위아래로 쌓음
    const people = info.night.members.filter(p => !p.short);
    const col = (cls, head, h, count, html, empty) => `<div class="dn-col${cls}"><div class="dn-h">${head}<span>${count}명</span>${h ? `<small>${esc(h)}</small>` : ''}</div>${html || `<div class="none">${empty}</div>`}</div>`;
    const dayHtml = info.shifts.map(p => memberRow(p, ctx, false, sm)).join('') + info.slots.map(s => slotRow(s, ctx)).join('');
    const nightHtml = info.night.members.map(p => memberRow(p, ctx, true, sm)).join('');
    return `${(!dh && !nh) ? `<div class="hrs-line">${esc(hrs)}</div>` : ''}<div class="dn${sm ? '' : ' stack'}">${col('', '<b>주간</b>', dh, info.shifts.length, dayHtml, '없음')}${col(' night', `${I.moon}<b>야간</b>`, nh, people.length, nightHtml, '미정')}</div>`;
  }

  // ── 편집 중 희망자 (출근표 짜기를 스케줄에 합침, 2026-10-28) ──
  // 이 매장을 고른 사람(이 매장에 아직 없을 때) + 상관없음(그날 아무 데도 없을 때). 운영 희망자 넣기와 같은 기준
  const ansCache = {};
  async function hopeData(ds) {
    const ym = A.ymOf(ds), c = ansCache[ym];
    if (!c || Date.now() - c.at > 60000) ansCache[ym] = { at: Date.now(), list: await A.store.answers(ym) };
    const placed = {};
    A.FLOORS.forEach(([w]) => A.store.day(ds, w).shifts.forEach(x => { if (x.staffId != null) (placed[x.staffId] = placed[x.staffId] || new Set()).add(w); }));
    const day = ansCache[ym].list.filter(a => a.qkey === 'd:' + ds), byName = (a, b) => String(a.staffName).localeCompare(String(b.staffName), 'ko');
    // 다른 매장에 이미 있으면 칩에 그 매장을 작게 적어서 겹치는 걸 알 수 있게
    const elsewhere = (a, w) => [...(placed[a.staffId] || [])].filter(x => x !== w).map(A.storeName).join('·');
    return w => ({
      p: day.filter(a => a.choice === w && !(placed[a.staffId] && placed[a.staffId].has(w))).map(a => ({ ...a, also: elsewhere(a, w) })).sort(byName),
      any: day.filter(a => a.choice === '상관없음' && !placed[a.staffId]).sort(byName),
      total: day.filter(a => a.choice === w || a.choice === '상관없음').length,
    });
  }
  function hopeHtml(h, w) {
    const chip = (a, any) => `<button class="hchip${any ? ' any' : ''}" data-hope="${esc(a.staffId)}" data-hwp="${esc(w)}" data-hn="${esc(a.staffName)}" aria-label="${esc(a.staffName)}님을 ${esc(w)}에 넣기${a.also ? ` (지금 ${esc(a.also)}에 있어요)` : ''}">${esc(a.staffName)}${a.also ? `<small>${esc(a.also)}</small>` : ''}${I.plus}</button>`;
    const has = h.p.length || h.any.length;
    const body = has ? `<div class="hchips">${h.p.map(a => chip(a, false)).join('')}${h.any.map(a => chip(a, true)).join('')}</div>`
      : `<p class="hope-none">${h.total ? '희망한 사람은 모두 넣었어요' : '이 날 고른 사람이 없어요'}</p>`;
    return `<div class="hope"><div class="hope-h"><b>희망</b>${has ? `<span>눌러서 넣어요${h.any.length ? ' · 흐린 이름은 상관없음' : ''}${h.p.some(a => a.also) ? ' · 빨간 글씨는 이미 들어간 매장' : ''}</span>` : ''}</div>${body}</div>`;
  }
  let hoping = false;
  async function addHope(ds, b) {
    if (hoping) return;
    hoping = true; b.disabled = true; b.setAttribute('aria-busy', 'true');
    try {
      const wp = b.dataset.hwp, name = b.dataset.hn;
      const r = await rpc('admin_assign_from_submission', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_staff_ids: [Number(b.dataset.hope)] });
      if (r === false) { b.disabled = false; b.removeAttribute('aria-busy'); return; }
      await done(ds, r === 0 ? `${name}님은 이미 ${A.storeName(wp)}에 있어요` : `${name}님을 ${A.storeName(wp)}에 넣었어요`);
    } finally { hoping = false; }
  }

  async function renderDayList(list, { ds, wp, admin, edit }) {
    const ok = await A.store.ensure(ds, ds);
    if (A.store.isDraft(ds) && !admin) { list.innerHTML = A.lockedMonth(); return; }
    if (!ok) { list.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '당겨서 새로고침해 주세요'); return; }
    const all = wp === '전체';
    edit = !!(admin && edit);
    const ctx = { admin, edit };
    const hopes = edit ? await hopeData(ds) : null;
    let html = admin && A.store.isDraft(ds) ? A.draftBar(ds) : '', shown = 0, closedAll = true;
    (all ? A.FLOORS.map(f => f[0]) : [wp]).forEach(w => {
      const info = A.store.day(ds, w);
      if (!info.closed) closedAll = false;
      const empty = !info.shifts.length && !info.night && !info.slots.length;
      if (all && !edit && (info.closed || empty)) return;
      shown++;
      let inner = edit ? floorTools(info) : '';
      if (info.closed) inner += all || edit ? '<div class="none">휴무일이에요</div>' : A.emptyBox('closed', '휴무일이에요', `이 날은 ${w} 매장이 쉬어요`);
      else {
        if (info.event) inner += `<div class="event"><span class="ev-tag">이벤트</span><span class="ev-name">${esc(info.event)}</span></div>`;
        if (info.night) inner += dnHtml(info, ctx);
        else if (!empty) inner += info.shifts.map(p => memberRow(p, ctx, false)).join('') + info.slots.map(s => slotRow(s, ctx)).join('');
        else inner += '<div class="none">근무 없음</div>';
        if (hopes) inner += hopeHtml(hopes(w), w);
      }
      const nightPeople = info.night ? info.night.members.filter(p => !p.short) : [];
      const guests = info.shifts.filter(p => p.guest).length + nightPeople.filter(p => p.guest).length;
      const cnt = info.closed ? '휴무' : info.night ? `주간 ${info.shifts.length} · 야간 ${nightPeople.length}` : `${info.shifts.length}명`;
      html += `<section class="floor" data-theme="${A.themeKey(w)}" data-drop-wp="${w}" data-date="${ds}"><div class="floor-h"><span class="store"><img src="${A.logo(w)}" alt=""><span class="fl">${A.floorOf(w)}</span><b>${w}</b></span><span class="cnt">${!info.closed && guests ? `<span class="gcount">게스트 ${guests}</span>` : ''}${cnt}</span></div>${inner}</section>`;
    });
    if (!shown) html += closedAll ? A.emptyBox('closed', '휴무일이에요', '이 날은 모든 매장이 쉬어요') : A.emptyBox('cal', '이 날은 등록된 근무가 없어요', '다른 날짜를 확인해 보세요');
    list.innerHTML = html;
    bindDay(list, ds);
    A.drag?.bind?.(list);
  }
  A.view('day', {
    title: d => A.fmt(A.ymd(d)),
    isNow: d => A.ymd(d) === A.today(),
    now: ['오늘', '오늘로'],
    step: (d, dir) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir),
    render: renderDayList,
  });

  // ── 일별 동작 ──
  const findShift = (ds, id) => { for (const [w] of A.FLOORS) { const i = A.store.day(ds, w); const s = [...i.shifts, ...i.slots].find(x => String(x.id) === String(id)); if (s) return s; } return null; };
  const findNight = (ds, id) => { for (const [w] of A.FLOORS) { const i = A.store.day(ds, w); const m = i.night && i.night.members.find(x => String(x.id) === String(id)); if (m) return m; } return null; };

  function bindDay(list, ds) {
    list.querySelectorAll('[data-app-ok]').forEach(b => b.onclick = () => { const s = findShift(ds, b.dataset.slot); const a = s && s.applicants.find(x => String(x.appId) === b.dataset.appOk); if (a) approve(s, a); });
    list.querySelectorAll('[data-app-no]').forEach(b => b.onclick = () => { const s = findShift(ds, b.dataset.slot); const a = s && s.applicants.find(x => String(x.appId) === b.dataset.appNo); if (a) reject(s, a); });
    list.querySelectorAll('[data-slot-pick]').forEach(b => b.onclick = () => { const s = findShift(ds, b.dataset.slotPick); if (s) pickApplicant(s); });
    list.querySelectorAll('[data-slot-apply]').forEach(b => b.onclick = () => apply(ds, b.dataset.slotApply));
    list.querySelectorAll('[data-slot-cancel]').forEach(b => b.onclick = () => cancelApply(ds, b.dataset.slotCancel));
    list.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => { const s = findShift(ds, b.dataset.sub); if (!s) return;
      if (A.swap && A.swap.request) A.swap.request(s); else A.toast('대타 구하기는 준비 중이에요'); });
    list.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.more.split(':');
      if (k === 'n') { const m = findNight(ds, id); if (m) nightMenu(m); } else { const s = findShift(ds, id); if (s) shiftMenu(s); } });
    list.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => TOOLS[b.dataset.tool](ds, b.dataset.twp));
    list.querySelectorAll('[data-hope]').forEach(b => b.onclick = () => addHope(ds, b));
  }

  // 빈 자리 신청 (관리자: 수락·거절 / 직원: 신청·취소)
  let deciding = false;   // 수락·거절 하나 처리 중에는 다른 결정 막기
  async function approve(s, a) {
    if (deciding) return;
    const others = s.applicants.length - 1;
    if (!await A.confirm({ title: `${a.name}님 신청을 수락할까요?`, text: `${where(s.date, s.wp)} 근무에 들어가요.${others ? ` 다른 신청 ${others}개는 거절돼요.` : ''}`, ok: '수락' })) return;
    deciding = true;
    try {
      if (await rpc('admin_approve_application', { p_admin_id: adminId(), p_app_id: Number(a.appId) }) === false) return;
      if (v2db()) A.api.notify({ event: 'application_decided', app_id: Number(a.appId) });   // 신청자들에게 (v2 DB 가 있을 때만)
      await done(s.date, `${a.name}님을 넣었어요`);   // 다시 그릴 때까지 막아 둬요
    } finally { deciding = false; }
  }
  async function reject(s, a) {
    if (deciding) return;
    if (!await A.confirm({ title: `${a.name}님 신청을 거절할까요?`, text: v2db() ? `${a.name}님에게 거절 알림이 가요.` : '', ok: '거절하기', danger: true })) return;
    deciding = true;
    try {
      if (await rpc('admin_reject_application', { p_admin_id: adminId(), p_app_id: Number(a.appId) }) === false) return;
      if (v2db()) A.api.notify({ event: 'application_decided', app_id: Number(a.appId) });
      await done(s.date, `${a.name}님 신청을 거절했어요`);
    } finally { deciding = false; }
  }
  function pickApplicant(s) {
    const html = `<p class="sheet-p">${esc(where(s.date, s.wp))} 빈 자리에 신청한 사람이에요.</p><div class="pick-list">${s.applicants.map(a => `<div class="lrow">${A.avatar(a.name)}<span class="lm"><span class="lt">${esc(a.name)}</span></span><span class="la"><button class="btn sm ghost" data-pno="${a.appId}">거절</button><button class="btn sm" data-pok="${a.appId}">수락</button></span></div>`).join('')}</div>`;
    A.sheet({ title: '빈 자리에 넣을 사람', html, onOpen: (el, close) => {
      const of = id => s.applicants.find(x => String(x.appId) === id);
      el.querySelectorAll('[data-pok]').forEach(b => b.onclick = () => { close(); approve(s, of(b.dataset.pok)); });
      el.querySelectorAll('[data-pno]').forEach(b => b.onclick = () => { close(); reject(s, of(b.dataset.pno)); });
    } });
  }
  async function apply(ds, id) {
    if (!await A.auth.require()) return;
    if (A.isAdmin()) return;                               // 관리자로 로그인했으면 다시 그려진 화면에서 고르기
    const s = me();
    if (await rpc('apply_slot', { p_staff_id: s.id, p_shift_id: Number(id) }) === false) return;
    A.api.notify({ to: 'admins', title: '빈자리 신청', body: `${s.name}님이 빈자리에 신청했어요`, exclude_id: s.id });
    await done(ds, v2db() ? '신청했어요. 관리자가 확인하면 알려 드려요' : '신청했어요. 관리자 확인을 기다려 주세요');
  }
  async function cancelApply(ds, id) {
    if (!await A.auth.require()) return;
    if (!await A.confirm({ title: '신청을 취소할까요?', ok: '신청 취소', cancel: '그대로 두기', danger: true })) return;
    if (await rpc('cancel_application', { p_staff_id: me().id, p_shift_id: Number(id) }) === false) return;
    await done(ds, '신청을 취소했어요');
  }

  // 두 번 부르는 옮기기: 넣기가 된 뒤에만 빼요. 하나라도 됐으면 다시 그려요
  async function twoStep(ds, add, remove, msg, afterAdd) {
    if (await rpc(add[0], add[1]) === false) return;
    if (afterAdd) await afterAdd();
    const r = await rpc(remove[0], remove[1]);
    await done(ds, r === false ? '' : msg);
  }
  const nightAddArgs = (ds, wp, p) => ({ p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_staff_id: p.staffId ?? null, p_name: p.staffId != null ? null : (p.short ? '부족' : p.name) });
  // 게스트 표시 (supabase-v2-guest-label.sql 적용 뒤에만 A.guestLabel): 그 날·매장·이름의 게스트 근무(주간·야간) 표시를 켜고 꺼요
  const setGuestLabel = (ds, wp, name, show) => rpc('admin_set_guest_label', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_name: name, p_show: !!show });
  const labelRow = p => A.guestLabel && p.gname ? `<button class="menu-row" data-glabel>${p.showGuest === false ? "손님 페이지에 '게스트' 표시하기" : "'게스트' 표시 끄기"}${I.chev}</button>` : '';
  const bindLabel = (el, close, p) => { const b = el.querySelector('[data-glabel]'); if (!b) return;
    b.onclick = async () => { close(); const on = p.showGuest === false;
      if (await setGuestLabel(p.date, p.wp, p.name, on) === false) return;
      await done(p.date, on ? `${p.name}님을 다시 게스트로 표시해요` : `${p.name}님은 이제 게스트로 표시하지 않아요`); }; };
  // 주간↔야간 옮기면 새 줄이 생겨서 표시가 기본(켜짐)으로 돌아가요 → 꺼 둔 표시를 새 자리에도 다시 꺼요
  const keepLabel = (p, ds, wp) => A.guestLabel && p.gname && p.showGuest === false ? setGuestLabel(ds, wp, p.name, false) : null;

  // 줄 ⋯ (주간 근무·빈 자리): 수정 · 다른 층으로 · 야간으로 · 게스트→직원 · 빼기
  function shiftMenu(s) {
    const ds = s.date, wp = s.wp, info = A.store.day(ds, wp), label = s.empty ? '빈 자리' : s.name;
    const moves = A.FLOORS.filter(f => f[0] !== wp && !A.store.day(ds, f[0]).closed).map(([w]) => `<button class="menu-row" data-mv="${w}">${A.storeName(w)}로 옮기기${I.chev}</button>`).join('');
    const flip = info.night && !s.empty ? `<button class="menu-row" data-flip>야간으로 옮기기${I.chev}</button>` : '';
    const conv = s.gname && A.guest && A.guest.convert ? `<button class="menu-row" data-conv>직원으로 바꾸기${I.chev}</button>` : '';
    A.sheet({ title: `${label} · 주간`, html: `<p class="sheet-p">${esc(where(ds, wp))}</p><div class="menu-list"><button class="menu-row" data-edit>수정하기${I.chev}</button>${moves}${flip}${labelRow(s)}${conv}</div>`,
      actions: [{ label: '이 날 근무에서 빼기', kind: 'danger', onClick: async c => { c();
        if (!await A.confirm({ title: s.empty ? '빈 자리를 지울까요?' : `${label}님을 뺄까요?`, text: `${where(ds, wp)} 주간 근무에서 빠져요.`, ok: '빼기', danger: true })) return;
        if (await rpc('admin_delete_shift', { p_admin_id: adminId(), p_shift_id: Number(s.id) }) === false) return;
        await done(ds, s.empty ? '빈 자리를 지웠어요' : `${label}님을 뺐어요`); } }],
      onOpen: (el, close) => {
        el.querySelector('[data-edit]').onclick = () => { close(); A.editShift(s); };
        el.querySelectorAll('[data-mv]').forEach(x => x.onclick = async () => { close(); const to = x.dataset.mv;
          if (await rpc('admin_move_shift', { p_admin_id: adminId(), p_shift_id: Number(s.id), p_workplace: to }) === false) return;
          await done(ds, s.empty ? `빈 자리를 ${A.storeName(to)}로 옮겼어요` : `${label}님을 ${A.storeName(to)}로 옮겼어요`); });
        const f = el.querySelector('[data-flip]');
        if (f) f.onclick = () => { close();
          twoStep(ds, ['admin_add_night_member', nightAddArgs(ds, wp, s)], ['admin_delete_shift', { p_admin_id: adminId(), p_shift_id: Number(s.id) }], `${label}님을 야간으로 옮겼어요`, () => keepLabel(s, ds, wp)); };
        bindLabel(el, close, s);
        const cv = el.querySelector('[data-conv]');
        if (cv) cv.onclick = () => { close(); A.guest?.convert?.(s.name); };
      } });
  }
  // 줄 ⋯ (야간 멤버): 다른 층 야간으로 · 주간으로 · 게스트→직원 · 빼기
  function nightMenu(m) {
    const ds = m.date, wp = m.wp, label = m.short ? '부족' : m.name;
    const moves = A.FLOORS.filter(f => f[0] !== wp && A.store.day(ds, f[0]).night).map(([w]) => `<button class="menu-row" data-mv="${w}">${A.storeName(w)} 야간으로 옮기기${I.chev}</button>`).join('');
    const conv = m.gname && A.guest && A.guest.convert ? `<button class="menu-row" data-conv>직원으로 바꾸기${I.chev}</button>` : '';
    A.sheet({ title: `${label} · 야간`, html: `<p class="sheet-p">${esc(where(ds, wp))}</p><div class="menu-list">${moves}<button class="menu-row" data-flip>${m.short ? '주간 빈 자리로 바꾸기' : '주간으로 옮기기'}${I.chev}</button>${labelRow(m)}${conv}</div>`,
      actions: [{ label: '야간에서 빼기', kind: 'danger', onClick: c => { c();
        if (A.night && A.night.remove) A.night.remove(m); else A.toast('야간 멤버 빼기는 준비 중이에요'); } }],
      onOpen: (el, close) => {
        el.querySelectorAll('[data-mv]').forEach(x => x.onclick = () => { close(); const to = x.dataset.mv;
          twoStep(ds, ['admin_add_night_member', nightAddArgs(ds, to, m)], ['admin_remove_night_member', { p_admin_id: adminId(), p_id: Number(m.id) }], `${label}${m.short ? '' : '님'}을 ${A.storeName(to)} 야간으로 옮겼어요`, () => keepLabel(m, ds, to)); });
        el.querySelector('[data-flip]').onclick = () => { close();
          const add = { p_admin_id: adminId(), p_work_date: ds, p_workplace: wp, p_start: '', p_end: '', p_assignee: m.staffId ?? null, p_memo: null, p_guest: m.staffId != null || m.short ? null : m.name };
          twoStep(ds, ['admin_add_shift', add], ['admin_remove_night_member', { p_admin_id: adminId(), p_id: Number(m.id) }], m.short ? '주간 빈 자리로 바꿨어요' : `${label}님을 주간으로 옮겼어요`, () => keepLabel(m, ds, wp)); };
        bindLabel(el, close, m);
        const cv = el.querySelector('[data-conv]');
        if (cv) cv.onclick = () => { close(); A.guest?.convert?.(m.name); };
      } });
  }

  // 층별 도구 (편집 중)
  const TOOLS = {
    async closed(ds, wp) {
      const info = A.store.day(ds, wp);
      if (info.closed) {
        if (!await A.confirm({ title: `${A.storeName(wp)} 휴무를 풀까요?`, text: `${A.fmt(ds)}에 다시 문을 열어요.${v2db() ? ' 쉬는 동안 지워 둔 근무가 돌아와요.' : ''}`, ok: '휴무 풀기' })) return;
        if (await rpc('admin_set_day_off', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_off: false }) === false) return;
        return done(ds, '휴무를 풀었어요');
      }
      const n = info.shifts.length, slots = info.slots.length;
      const text = v2db() ? `${A.fmt(ds)}. 휴무를 풀면 근무가 돌아와요.` : `${A.fmt(ds)}.${n ? ` 이 날 근무 ${n}명이 지워져요.` : ''}${slots ? ` 빈 자리 ${slots}개도 지워져요.` : ''}`;
      if (!await A.confirm({ title: `${A.storeName(wp)}${A.josa(wp, '을', '를')} 휴무로 할까요?`, text, ok: '휴무로', danger: !v2db() && n + slots > 0 })) return;
      if (await rpc('admin_set_day_off', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_off: true }) === false) return;
      await done(ds, `${A.fmt(ds)} ${wp}${A.josa(wp, '을', '를')} 휴무로 했어요`);
    },
    async night(ds, wp) {
      const info = A.store.day(ds, wp), cur = info.night && info.night.hours;
      const ask = async () => {
        const v = await A.prompt({ title: cur ? '야간 시간 바꾸기' : '야간 열기', text: `${where(ds, wp)} · 손님 페이지에 이 글 그대로 보여요.`, label: '영업시간 표시', value: cur || NIGHT_DEFAULT, maxlength: 60, ok: cur ? '저장' : '야간 열기' });
        if (v === null) return;
        const hrs = v || cur || NIGHT_DEFAULT;
        if (cur && hrs === cur) return;
        if (await rpc('admin_set_night', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_on: true, p_hours: hrs }) === false) return;
        await done(ds, cur ? '야간 시간을 바꿨어요' : '야간을 열었어요');
      };
      if (!cur) return ask();
      const n = info.night.members.length;
      A.sheet({ title: '야간', html: `<p class="sheet-p">${esc(where(ds, wp))}</p><div class="box hrs-box">${esc(cur)}</div>`, actions: [
        { label: '야간 닫기', kind: 'danger', onClick: async c => { c();
          if (!await A.confirm({ title: '야간을 닫을까요?', text: n ? `야간 멤버 ${n}명도 같이 빠져요.` : '', ok: '야간 닫기', danger: true })) return;
          if (await rpc('admin_set_night', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_on: false, p_hours: cur }) === false) return;
          await done(ds, '야간을 닫았어요'); } },
        { label: '시간 바꾸기', kind: 'primary', onClick: c => { c(); ask(); } }] });
    },
    async event(ds, wp) {
      const cur = A.store.day(ds, wp).event || '';
      const v = await A.prompt({ title: cur ? '이벤트 바꾸기' : '이벤트 넣기', text: `${where(ds, wp)}${cur ? ' · 비우고 저장하면 이벤트가 지워져요' : ''}`, label: '이벤트 이름', value: cur, placeholder: '예: 할로윈', maxlength: 30, ok: '저장',
        validate: x => (!x && !cur ? '이벤트 이름을 적어 주세요' : '') });
      if (v === null || v === cur) return;
      if (await rpc('admin_set_day_event', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_event: v }) === false) return;
      await done(ds, v ? '이벤트를 저장했어요' : '이벤트를 지웠어요');
    },
    hopes(ds, wp) { if (A.adminTools && A.adminTools.openHopes) A.adminTools.openHopes(ds, wp); else A.toast('희망자 보기는 준비 중이에요'); },
    add(ds, wp) { A.addShift(ds, wp); },
    nadd(ds, wp) { if (A.night && A.night.openAdd) A.night.openAdd(ds, wp); else A.toast('야간 멤버 넣기는 준비 중이에요'); },
  };

  // ── 근무 시트 (관리자): 직원 / 게스트 / 빈 자리, 시작·끝, 지우기 (운영 2223-2267, 2305-2310) ──
  async function shiftSheet(s, ds, wp) {
    const staff = A.store.staff().length ? A.store.staff() : await A.store.directory();
    const edit = !!s;
    let kind = !s ? 'staff' : s.staffId != null ? 'staff' : s.gname ? 'guest' : 'open';
    const KINDS = [['staff', '직원'], ['guest', '게스트'], ['open', '빈 자리']];
    const conv = edit && s.gname && A.guest && A.guest.convert ? `<div class="menu-list"><button class="menu-row" data-conv>직원으로 바꾸기${I.chev}</button></div>` : '';
    const html = `<p class="sheet-p">${esc(where(ds, wp))}</p>
      <div class="seg" role="radiogroup" aria-label="누가 들어가나요">${KINDS.map(([k, l]) => `<button data-k="${k}" role="radio" aria-checked="${kind === k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${A.staffPick({ staff, sel: s ? s.staffId : null, attr: 'data-f="staff"', wrap: 'data-p="staff"' })}
      <label class="fld-l" data-p="guest">게스트 이름<input class="fld" data-f="guest" maxlength="30" autocomplete="off" value="${esc(s && s.gname ? s.name : '')}" placeholder="예: 하루"></label>
      ${A.guestLabel ? `<label class="chk-row" data-p="guest"><input type="checkbox" data-f="showGuest"${s && s.gname && s.showGuest === false ? '' : ' checked'}><span class="lm"><span class="lt">손님 페이지에 '게스트'로 표시</span><span class="ls">직원인데 명단에 아직 없으면 꺼 두세요</span></span></label>` : ''}
      <p class="sheet-note" data-p="open">직원들이 이 빈 자리에 신청할 수 있어요.</p>
      <div class="fld-row"><label class="fld-l">시작 (선택)<input class="fld" data-f="start" maxlength="10" autocomplete="off" value="${esc(s ? s.start : '')}" placeholder="예: 18:00"></label><label class="fld-l">끝 (선택)<input class="fld" data-f="end" maxlength="10" autocomplete="off" value="${esc(s ? s.end : '')}" placeholder="예: 23:00"></label></div>
      ${conv}<p class="sheet-err" hidden></p>`;
    let busy = false;
    const save = async (close, el) => {
      if (busy) return;
      const err = el.querySelector('.sheet-err'), show = m => { err.hidden = false; err.textContent = m; };
      const f = k => el.querySelector(`[data-f="${k}"]`);
      let assignee = null, guest = null;
      if (kind === 'staff') { assignee = f('staff').value ? Number(f('staff').value) : null; if (!assignee) { show('직원을 골라 주세요'); return; } }
      else if (kind === 'guest') { guest = f('guest').value.trim(); if (!guest) { show('게스트 이름을 적어 주세요'); f('guest').focus(); return; } }
      const start = f('start').value.trim(), end = f('end').value.trim();
      busy = true; err.hidden = true;
      const btn = el.querySelector('.sheet-a .primary'); if (btn) btn.setAttribute('aria-busy', 'true');
      const r = edit
        ? await rpc('admin_update_shift', { p_admin_id: adminId(), p_shift_id: Number(s.id), p_start: start, p_end: end, p_assignee: assignee, p_guest: guest })
        : await rpc('admin_add_shift', { p_admin_id: adminId(), p_work_date: ds, p_workplace: wp, p_start: start, p_end: end, p_assignee: assignee, p_memo: null, p_guest: guest });
      // 게스트 표시: 넣을 때 끄거나, 고칠 때 바꿨으면 이름 기준으로 따로 저장 (새 줄은 켜짐으로 시작)
      const lb = kind === 'guest' && A.guestLabel ? f('showGuest') : null, want = lb ? lb.checked : true;
      const was = edit && s.gname ? s.showGuest !== false : true;
      const lr = r !== false && lb && (!want || want !== was) ? await setGuestLabel(ds, wp, guest, want) : null;
      busy = false; if (btn) btn.removeAttribute('aria-busy');
      if (r === false) return;
      close();
      await done(ds, (edit ? '근무를 고쳤어요' : kind === 'open' ? '빈 자리를 만들었어요. 직원들이 신청할 수 있어요' : '근무를 넣었어요') + (lb && !want && lr !== false ? ' · 게스트 표시 없이' : ''));
    };
    const del = async c => { c();
      if (!await A.confirm({ title: '이 근무를 지울까요?', text: `${where(ds, wp)}${s.empty ? ' 빈 자리' : ` ${s.name}님`} 근무가 지워져요.`, ok: '지우기', danger: true })) return;
      if (await rpc('admin_delete_shift', { p_admin_id: adminId(), p_shift_id: Number(s.id) }) === false) return;
      await done(ds, '근무를 지웠어요'); };
    A.sheet({ title: edit ? '근무 고치기' : '근무 넣기', html,
      actions: edit ? [{ label: '지우기', kind: 'danger', onClick: del }, { label: '저장', kind: 'primary', onClick: save }]
                    : [{ label: '취소' }, { label: '넣기', kind: 'primary', onClick: save }],
      onOpen: (el, close) => {
        A.bindStaffPick(el);
        const paint = () => {
          el.querySelectorAll('[data-k]').forEach(b => { const on = b.dataset.k === kind; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
          el.querySelectorAll('[data-p]').forEach(p => { p.hidden = p.dataset.p !== kind; });
        };
        el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; paint(); });
        const cv = el.querySelector('[data-conv]');
        if (cv) cv.onclick = () => { close(); A.guest?.convert?.(s.name); };
        paint();
      } });
  }
  A.editShift = shift => { if (shift) shiftSheet(shift, shift.date, shift.wp); };
  A.addShift = (ds, wp) => shiftSheet(null, ds, wp);
}
