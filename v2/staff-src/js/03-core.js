// 공통 틀: 날짜·매장 도우미, 시트·확인·입력·알림, 탭과 화면 등록, 그리기(늦게 끝난 그리기는 버림),
// 해시 바로가기, 당겨서 새로고침, 위 바·아래 메뉴. 화면 파일은 App.screen()/App.view()로 자기를 등록해요.
{
  const A = window.App;
  let pendingRoot = null;   // 지금 그리는 중인 (아직 붙이지 않은) 화면
  // 위 바·아래 메뉴 같은 틀 요소용. 화면 안에서는 el.querySelector 를 쓰세요.
  const $ = id => (pendingRoot && pendingRoot.querySelector('#' + CSS.escape(id))) || document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = ds => new Date(ds + 'T00:00:00');
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  const fmt = (ds, opt = {}) => { const d = parse(ds); return `${opt.year ? d.getFullYear() + '년 ' : ''}${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`; };
  const fmtShort = ds => { const d = parse(ds); return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`; };
  const ymOf = ds => String(ds).slice(0, 7);
  const firstSyl = n => [...String(n || '').trim()][0] || '';
  const today = () => ymd(new Date());
  // 주는 일요일부터
  const sundayOf = d => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; };
  // 'YYYY-MM' 달 옮기기 (말일 넘김 없음)
  const ymShift = (ym, delta) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const igUrl = h => { h = String(h || '').trim(); if (!h) return null; return /^https?:\/\//i.test(h) ? h : 'https://instagram.com/' + h.replace(/^@/, ''); };

  // 층 순서: 3층 데빌 → 2층 메이드 → 1층 마츠리
  const FLOORS = [['데빌', '3층', 'devil'], ['메이드', '2층', 'maid'], ['마츠리', '1층', 'matsuri']];
  const THEMES = {
    '전체':  { key: 'all',     c: '#17151a', cs: '#f4f2f5', ci: '#17151a' },
    '데빌':  { key: 'devil',   c: '#26211f', cs: '#f4f1f1', ci: '#26211f' },
    '메이드': { key: 'maid',    c: '#d94079', cs: '#fdedf3', ci: '#b8285f' },
    '마츠리': { key: 'matsuri', c: '#e0452e', cs: '#fdede8', ci: '#c2381f' },
  };
  const floorOf = wp => (FLOORS.find(f => f[0] === wp) || [])[1] || '';
  const themeKey = wp => (THEMES[wp] || THEMES['전체']).key;
  const logo = wp => `assets/logo-${themeKey(wp)}.jpg`;
  // 층 번호는 출근표 층 머리와 매장 칩에만. 나머지 문장·표시는 매장 이름만
  const storeName = wp => wp;
  // 받침에 따라 을/를 같은 조사 고르기
  const josa = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1); return (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? a : b; };

  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="9" r="2.6"/><path d="M15.5 14.2c2.6-.3 4.5 1.4 5 4.3"/></svg>',
    mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.5V3h6v1.5M9 12.5l2 2 4-4"/></svg>',
    submit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/></svg>',
    closed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-5.5h5V20"/><path d="M3 21h18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };
  const emptyBox = (ic, t, s) => `<div class="empty-box"><div class="e-ic">${ICON[ic] || ''}</div><div class="e-t">${esc(t)}</div>${s ? `<div class="e-s">${esc(s)}</div>` : ''}</div>`;
  // 사진 주소 안의 따옴표·괄호 등은 %인코딩 → style 밖으로 못 빠져나감 (운영 avStyle)
  const cssUrl = url => String(url).replace(/["'()\\<>&\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'));
  // avatar(name, cls, url) 또는 avatar({name, avatar}, cls): 사진이 있으면 사진, 없으면 첫 글자
  const avatar = (name, cls = 'av', url = null) => {
    if (name && typeof name === 'object') { url = url ?? name.avatar; name = name.name; }
    return url ? `<span class="${cls} photo" style="background-image:url('${cssUrl(url)}')"></span>` : `<span class="${cls}">${esc(firstSyl(name))}</span>`;
  };
  const storeTag = (wp, cls = 'store-tag') => `<span class="${cls}"><img src="${logo(wp)}" alt=""><span>${esc(storeName(wp))}</span></span>`;
  const pageHead = (title, sub) => `<header class="page-h"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header>`;
  const isAdmin = () => !!(A.session && A.session.is_admin);

  // ── 시트·확인·입력·알림 ──
  let sheetSeq = 0;
  function sheet({ title, html = '', actions = [], onOpen, onClose } = {}) {
    const id = 'sheet' + (++sheetSeq);
    const wrap = document.createElement('div');
    wrap.className = 'modal show'; wrap.id = id;
    wrap.innerHTML = `<div class="modal-c" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(title || '')}"><div class="grab"></div>
      <div class="sheet-h"><b>${esc(title || '')}</b><button class="closex" data-x>닫기</button></div>
      <div class="sheet-b">${html}</div>${actions.length ? `<div class="sheet-a">${actions.map((a, i) => `<button class="btn lg ${a.kind || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    const back = document.activeElement;
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      wrap.remove(); document.removeEventListener('keydown', onKey);
      if (onClose) { try { onClose(); } catch (e) { console.error(e); } }
      if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
    };
    const onKey = e => { if (e.key === 'Escape' && [...document.querySelectorAll('#app > .modal')].pop() === wrap) close(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = actions[+b.dataset.a]; if (a.onClick) a.onClick(close, wrap); else close(); });
    document.addEventListener('keydown', onKey);
    document.getElementById('app').appendChild(wrap);
    wrap.querySelector('.modal-c').focus({ preventScroll: true });
    if (onOpen) onOpen(wrap, close);
    return { el: wrap, close };
  }
  // 확인: 주 버튼은 오른쪽(마지막) 하나, 지우기·빼기는 연한 빨강. 닫으면 false
  const confirmBox = ({ title, text = '', ok = '확인', cancel = '취소', danger = false } = {}) => new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    sheet({ title, html: text ? `<p class="sheet-p">${esc(text)}</p>` : '', onClose: () => fin(false), actions: [
      { label: cancel, onClick: c => { fin(false); c(); } },
      { label: ok, kind: danger ? 'danger' : 'primary', onClick: c => { fin(true); c(); } }] });
  });
  // 한 줄 입력: 다듬은 글자 또는 null(취소). validate(v) 가 문구를 돌려주면 시트 안에 보여 주고 기다려요.
  const promptBox = ({ title, text = '', label = '', value = '', placeholder = '', inputmode = '', maxlength, validate, ok = '확인', cancel = '취소' } = {}) => new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const attrs = `${inputmode ? ` inputmode="${esc(inputmode)}"` : ''}${maxlength ? ` maxlength="${+maxlength}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}`;
    const html = `${text ? `<p class="sheet-p">${esc(text)}</p>` : ''}<label class="fld-l">${esc(label)}<input class="fld" data-prompt autocomplete="off" aria-label="${esc(label || title || '')}" value="${esc(value)}"${attrs}></label><p class="sheet-err" hidden></p>`;
    let busy = false;
    const submit = async (c, el) => {
      if (busy) return;
      const inp = el.querySelector('[data-prompt]'), err = el.querySelector('.sheet-err'), v = inp.value.trim();
      busy = true;
      let msg = '';
      try { msg = validate ? await validate(v) : ''; } finally { busy = false; }
      if (msg) { err.hidden = false; err.textContent = msg; inp.focus(); return; }
      fin(v); c();
    };
    sheet({ title, html, onClose: () => fin(null),
      actions: [{ label: cancel, onClick: c => { fin(null); c(); } }, { label: ok, kind: 'primary', onClick: submit }],
      onOpen: (el, close) => {
        const inp = el.querySelector('[data-prompt]');
        inp.focus(); if (inp.value) inp.select();
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(close, el); } });
      } });
  });
  let toastT;
  function toast(msg, err = false) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 3200 : 2200);
  }

  // ── 상태·화면 ──
  const TABS = [['schedule', '스케줄', 'cal'], ['swaps', '대타', 'swap'], ['mine', '내 근무', 'mine'], ['submit', '제출', 'submit'], ['admin', '관리', 'admin']];
  const TAB_KEYS = TABS.map(t => t[0]);
  const ALIAS = { swap: 'swaps' };
  const tabFromHash = () => { const h = (location.hash || '').replace('#', ''); const k = ALIAS[h] || h; return TAB_KEYS.includes(k) ? k : null; };
  const state = { tab: 'schedule', view: 'day', date: parse(today()), wp: '전체', edit: false, dir: 0, quiet: false };
  // role: 'admin' | 'staff' | 'out' (로그아웃)
  Object.defineProperty(state, 'role', { enumerable: true, get: () => !A.session ? 'out' : A.session.is_admin ? 'admin' : 'staff' });
  const screens = {}, views = {};

  function renderShell() {
    const s = A.session, admin = isAdmin();
    const right = s
      ? `<button class="icon-btn bell" id="bellBtn" aria-label="알림">${ICON.bell}</button><button class="icon-btn me-btn" id="whoBtn" aria-label="내 정보">${avatar(s.name, 'me-av', s.avatar)}</button>`
      : `<button class="btn sm top-login" id="loginBtn">로그인</button>`;
    const top = document.getElementById('top');
    top.innerHTML = `<span class="brand">모에 스케줄<em>직원</em></span>${right}`;
    const tabs = TABS.filter(t => t[0] !== 'admin' || admin);
    const bar = document.getElementById('tabbar');
    bar.style.gridTemplateColumns = `repeat(${tabs.length},1fr)`;
    bar.innerHTML = tabs.map(([k, l, ic]) => `<button class="mtab${state.tab === k ? ' on' : ''}" data-tab="${k}"${state.tab === k ? ' aria-current="page"' : ''}>${ICON[ic]}<span>${l}</span></button>`).join('');
    bar.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
    if (s) {
      const bell = top.querySelector('#bellBtn');
      if (A.bell && A.bell.mount) { try { A.bell.mount(bell); } catch (e) { console.error(e); } }
      else bell.onclick = () => toast('알림은 준비 중이에요');
      top.querySelector('#whoBtn').onclick = () => (A.account && A.account.open) ? A.account.open() : toast('내 정보는 준비 중이에요');
    } else {
      top.querySelector('#loginBtn').onclick = () => A.auth.openLogin();
    }
  }
  const syncHash = () => { const h = '#' + state.tab; if (location.hash !== h) history.replaceState(null, '', h); };

  // 그리기: 떼어 둔 화면(el)에 그린 뒤, 그 사이 더 새 그리기가 시작되지 않았을 때만 붙여요.
  // keep: 같은 화면에서 내용만 바뀔 때(쓰기 뒤) 스크롤 자리를 두고 움직임을 뺌. 붙였으면 true
  let seq = 0;
  async function render({ keep = false } = {}) {
    const my = ++seq;
    if (state.tab === 'admin' && !isAdmin()) state.tab = 'schedule';
    syncHash();
    renderShell();
    const host = document.getElementById('screen');
    const s = screens[state.tab];
    if (keep) state.dir = 0;
    state.quiet = keep;
    const root = document.createElement('div');
    root.className = 'screen-root';
    pendingRoot = root;
    host.setAttribute('aria-busy', 'true');
    try {
      if (s) await s.render(root, { keep });
      else root.innerHTML = emptyBox('cal', '준비 중인 화면이에요');
    } catch (e) {
      console.error(e);
      if (my !== seq) return false;
      root.innerHTML = emptyBox('cal', '화면을 불러오지 못했어요', '당겨서 새로고침해 주세요');
    }
    if (my !== seq) return false;
    pendingRoot = null;
    const top = host.scrollTop;
    document.body.dataset.theme = root.dataset.theme || 'all';
    host.replaceChildren(root);
    host.scrollTop = keep ? top : 0;
    host.removeAttribute('aria-busy');
    state.quiet = false;
    return true;
  }
  function go(tab, opts = {}) {
    tab = ALIAS[tab] || tab;
    state.tab = TAB_KEYS.includes(tab) ? tab : 'schedule';
    if (opts.date) state.date = typeof opts.date === 'string' ? parse(opts.date) : new Date(opts.date);
    if (opts.view) state.view = opts.view;
    if (opts.wp) state.wp = opts.wp;
    state.dir = 0;
    return render();
  }
  const goDay = (ds, wp) => go('schedule', { date: ds, view: 'day', wp });

  // ── 당겨서 새로고침 (운영 setupPTR) ──
  function setupPTR(container, onRefresh) {
    let startY = 0, mode = 0, applied = 0, refreshing = false;   // mode: 0 미정, 1 당기는 중, -1 일반 스크롤
    const THRESH = 60, MAX = 90, DEAD = 12;
    const ptr = document.getElementById('ptr'), txt = document.getElementById('ptrTxt'), spin = document.getElementById('ptrSpin');
    const show = v => { if (ptr) ptr.style.opacity = String(Math.min(1, v / THRESH)); };
    container.addEventListener('touchstart', e => {
      if (refreshing || e.touches.length !== 1 || document.querySelector('#app > .modal')) { mode = -1; return; }
      mode = 0; applied = 0; startY = e.touches[0].clientY;
    }, { passive: true });
    container.addEventListener('touchmove', e => {
      if (refreshing || mode === -1) return;
      const dy = e.touches[0].clientY - startY;
      if (mode === 0) {
        if (container.scrollTop > 0 || dy < 0) { mode = -1; return; }
        if (dy < DEAD) return;
        mode = 1;
      }
      if (container.scrollTop > 0) { mode = -1; container.style.transform = ''; show(0); return; }
      applied = Math.max(0, Math.min((dy - DEAD) * 0.5, MAX));
      container.style.transform = `translateY(${applied}px)`;
      show(applied);
      if (txt) txt.textContent = applied >= THRESH ? '놓으면 새로고침' : '당겨서 새로고침';
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    const finish = async () => {
      if (mode !== 1) { mode = 0; return; }
      const goNow = applied >= THRESH; mode = 0;
      container.style.transition = 'transform .22s';
      if (goNow) {
        refreshing = true;
        container.style.transform = 'translateY(44px)';
        show(THRESH);
        if (spin) spin.hidden = false;
        if (txt) txt.textContent = '새로고침 중…';
        try { await onRefresh(); } catch (e) { console.error(e); }
        refreshing = false;
        if (spin) spin.hidden = true;
        if (txt) txt.textContent = '당겨서 새로고침';
      }
      container.style.transform = '';
      show(0);
      setTimeout(() => { container.style.transition = ''; }, 240);
      applied = 0;
    };
    container.addEventListener('touchend', finish);
    container.addEventListener('touchcancel', finish);
  }

  // ── 시작: 모든 파일이 등록을 마친 뒤 (한 모듈 안이라 microtask 가 맨 끝에 돌아요) ──
  async function boot() {
    try { if (A.auth) await A.auth.boot(); } catch (e) { console.error(e); }
    const t = tabFromHash(); if (t) state.tab = t;
    window.addEventListener('hashchange', () => { const k = tabFromHash(); if (k && k !== state.tab) go(k); });
    setupPTR(document.getElementById('screen'), async () => { A.store.invalidateAll(); await render({ keep: true }); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    await render();
    if (A.auth) A.auth.afterBoot();
  }

  Object.assign(A, {
    $, esc, pad, ymd, parse, DAYS, fmt, fmtShort, ymOf, firstSyl, today, sundayOf, ymShift, igUrl,
    FLOORS, THEMES, floorOf, themeKey, logo, storeName, josa, ICON, emptyBox, avatar, storeTag, pageHead, isAdmin,
    sheet, confirm: confirmBox, prompt: promptBox, toast,
    state, TABS, go, goDay, render, renderShell, screens, views,
    screen: (k, def) => { screens[ALIAS[k] || k] = def; },
    view: (k, def) => { views[k] = def; },
  });
  queueMicrotask(boot);
}
