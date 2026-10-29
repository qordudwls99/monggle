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

  // Lucide icons © Lucide Contributors (ISC License) — https://lucide.dev (ig 는 브랜드 마크라 그대로)
  const ICON = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/></svg>',
    mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>',
    submit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    closed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
    ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
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

  // ── 이름 찾기: 초성도 돼요 (ㄹㅇ → 레인) ──
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const cho = s => [...String(s)].map(c => { const k = c.charCodeAt(0) - 0xAC00; return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c; }).join('');
  const nameHit = (name, q) => { q = String(q || '').trim(); if (!q) return true; const n = String(name || ''); return n.toLowerCase().includes(q.toLowerCase()) || cho(n).includes(cho(q)); };

  // ── 직원 고르기: 찾기 칸 + 목록. 고른 id 는 숨은 input(attr)에 담겨서 .value 로 읽어요 ──
  // staffPick({ staff, sel, attr: 'data-f="staff"', wrap: 'data-p="staff"' }) → html, bindStaffPick(el) 로 연결
  const koColl = new Intl.Collator('ko');
  const staffPick = ({ staff = [], sel = null, attr = '', wrap = '', label = '직원' }) => {
    const list = staff.slice().sort((a, b) => koColl.compare(String(a.name || ''), String(b.name || '')));
    const cur = list.find(s => sel != null && String(s.id) === String(sel));
    const rows = list.map(s => { const on = cur === s;
      return `<button type="button" class="lrow spk-row${on ? ' on' : ''}" role="option" aria-selected="${on}" data-id="${esc(s.id)}" data-n="${esc(s.name)}">${avatar(s.name, 'av', s.avatar_url || s.avatar || null)}<span class="lm"><span class="lt">${esc(s.name)}</span></span><span class="spk-ck">${ICON.check}</span></button>`; }).join('');
    return `<div class="spk" data-spk ${wrap}><input type="hidden" ${attr} value="${cur ? esc(cur.id) : ''}">
      <div class="spk-h"><span>${esc(label)}</span><b data-spk-cur>${cur ? esc(cur.name) : ''}</b></div>
      <input class="fld" type="search" data-spk-q placeholder="이름 찾기 (초성도 돼요)" aria-label="${esc(label)} 이름 찾기" autocomplete="off" enterkeyhint="done">
      <div class="spk-list" role="listbox" aria-label="${esc(label)}">${rows}<div class="none" data-spk-none hidden></div></div></div>`;
  };
  const bindStaffPick = el => el.querySelectorAll('[data-spk]').forEach(w => {
    const hid = w.querySelector('input[type=hidden]'), q = w.querySelector('[data-spk-q]'), box = w.querySelector('.spk-list');
    const rows = [...w.querySelectorAll('.spk-row')], none = w.querySelector('[data-spk-none]'), curEl = w.querySelector('[data-spk-cur]');
    const pick = r => {
      rows.forEach(x => { const on = x === r; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
      hid.value = r.dataset.id; curEl.textContent = r.dataset.n; q.blur();
    };
    rows.forEach(r => r.onclick = () => pick(r));
    q.oninput = () => {
      let n = 0;
      rows.forEach(r => { const hit = nameHit(r.dataset.n, q.value); r.hidden = !hit; if (hit) n++; });
      none.hidden = !!n; none.textContent = `'${q.value.trim()}' 이름이 없어요`; box.scrollTop = 0;
    };
    q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const r = rows.find(x => !x.hidden); if (r) pick(r); } };
    const on = rows.find(r => r.classList.contains('on'));
    if (on) requestAnimationFrame(() => { box.scrollTop = on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2; });
  });

  // ── 시트·확인·입력·알림 ──
  let sheetSeq = 0;
  // 바텀시트: 화면 가장자리에서 띄운 카드. 손잡이·제목 줄을 끌면 따라 내려오고, 충분히 내리거나 빠르게 튕기면 닫혀요.
  // 내용은 맨 위에서 아래로 당길 때만 같이 끌려요 (안쪽 목록·입력칸에서는 안 끌림). close() 는 바로 정리하고 화면만 내려가며 사라져요.
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function sheet({ title, html = '', actions = [], onOpen, onClose } = {}) {
    const id = 'sheet' + (++sheetSeq);
    const wrap = document.createElement('div');
    wrap.className = 'modal show'; wrap.id = id;
    wrap.innerHTML = `<div class="modal-c" role="dialog" aria-modal="true" tabindex="-1" aria-label="${esc(title || '')}">
      <div class="sheet-top"><div class="grab"></div><div class="sheet-h"><b>${esc(title || '')}</b><button class="sheet-x" data-x aria-label="닫기">${ICON.x}</button></div></div>
      <div class="sheet-b">${html}</div>${actions.length ? `<div class="sheet-a">${actions.map((a, i) => `<button class="btn lg ${a.kind || ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    const c = wrap.querySelector('.modal-c'), body = wrap.querySelector('.sheet-b'), top = wrap.querySelector('.sheet-top');
    const back = document.activeElement;
    let closed = false, drag = null;
    const remove = () => wrap.remove();
    const close = () => {
      if (closed) return; closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.add('closing'); wrap.classList.remove('in', 'drag');
      c.style.transform = ''; wrap.style.removeProperty('--dim');
      if (reduceMotion()) remove();
      else { c.addEventListener('transitionend', e => { if (e.target === c) remove(); }); setTimeout(remove, 420); }
      if (onClose) { try { onClose(); } catch (e) { console.error(e); } }
      if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
    };
    const onKey = e => { if (e.key === 'Escape' && [...document.querySelectorAll('#app > .modal:not(.closing)')].pop() === wrap) close(); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-x]')) close(); });
    wrap.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { const a = actions[+b.dataset.a]; if (a.onClick) a.onClick(close, wrap); else close(); });
    // 뒤 화면이 같이 밀리지 않게 (어두운 바탕을 끌 때만)
    wrap.addEventListener('touchmove', e => { if (e.target === wrap) e.preventDefault(); }, { passive: false });

    // ── 끌어서 닫기 ──
    const setY = y => { c.style.transform = `translateY(${y}px)`; wrap.style.setProperty('--dim', String(Math.max(0, 1 - Math.max(0, y) / drag.h))); };
    const begin = y0 => { if (closed) return false; drag = { y0, y: 0, pts: [[performance.now(), 0]], h: c.getBoundingClientRect().height || 1 }; wrap.classList.add('drag'); return true; };
    const move = yy => {
      let dy = yy - drag.y0;
      if (dy < 0) dy = -Math.min(18, Math.sqrt(-dy) * 2);    // 위로는 살짝만 늘어나요
      drag.y = dy; drag.pts.push([performance.now(), dy]); if (drag.pts.length > 5) drag.pts.shift();
      setY(dy);
    };
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null; wrap.classList.remove('drag');
      const [t0, y0] = d.pts[0], [t1, y1] = d.pts[d.pts.length - 1];
      const v = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0;        // px/ms, 아래로 +
      if (d.y > Math.min(150, d.h * 0.3) || (v > 0.6 && d.y > 16)) close();
      else { c.style.transform = ''; wrap.style.removeProperty('--dim'); }
    };
    top.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('button,a,input,select,textarea')) return;
      if (!begin(e.clientY)) return;
      drag.pid = e.pointerId;
      try { top.setPointerCapture(e.pointerId); } catch (_) {}
    });
    top.addEventListener('pointermove', e => { if (drag && drag.pid === e.pointerId) move(e.clientY); });
    top.addEventListener('pointerup', e => { if (drag && drag.pid === e.pointerId) end(); });
    top.addEventListener('pointercancel', e => { if (drag && drag.pid === e.pointerId) end(); });
    // 내용에서 당기기: 시트 본문이 맨 위이고, 손가락이 안쪽 스크롤 목록·입력칸·편집 캔버스 위가 아닐 때만
    const NO_PULL = 'input,textarea,select,.spk-list,.pick-list,.tl-body,.crop-cv,[data-nopull]';
    const nestedScroller = el => { for (let n = el; n && n !== body; n = n.parentElement) { if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return true; } return false; };
    let t = null;
    body.addEventListener('touchstart', e => {
      t = null;
      if (e.touches.length !== 1 || c.classList.contains('tl-sheet') || body.scrollTop > 0) return;
      if (e.target.closest(NO_PULL) || nestedScroller(e.target)) return;
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, lock: '' };
    }, { passive: true });
    body.addEventListener('touchmove', e => {
      if (!t) return;
      const p = e.touches[0], dx = p.clientX - t.x, dy = p.clientY - t.y;
      if (!t.lock) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        t.lock = dy > 0 && Math.abs(dy) > Math.abs(dx) && body.scrollTop <= 0 && begin(p.clientY) ? 'sheet' : 'no';
      }
      if (t.lock === 'sheet' && drag) { e.preventDefault(); move(p.clientY); }
    }, { passive: false });
    const tEnd = () => { if (t && t.lock === 'sheet') end(); t = null; };
    body.addEventListener('touchend', tEnd); body.addEventListener('touchcancel', tEnd);

    document.addEventListener('keydown', onKey);
    document.getElementById('app').appendChild(wrap);
    void c.offsetHeight;                                      // 아래에 둔 채로 한 번 그린 뒤 올려요
    wrap.classList.add('in');
    c.focus({ preventScroll: true });
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
  // 로그인 전: 탭도 화면도 없이 입구만 (직원 전용). 주소의 탭(#swaps 등)은 그대로 두고, 로그인하면 그 탭이 열려요.
  function renderGate() {
    document.body.classList.add('gated');
    document.body.dataset.theme = 'all';
    document.getElementById('top').innerHTML = `<span class="brand">모에 스케줄<em>직원</em></span>`;
    document.getElementById('tabbar').innerHTML = '';
    const host = document.getElementById('screen');
    const root = document.createElement('div');
    root.className = 'screen-root gate';
    root.innerHTML = `${emptyBox('lock', '직원만 볼 수 있어요', '이름과 PIN으로 로그인해 주세요')}
      <div class="gate-a"><button class="btn lg primary" id="gateLogin">로그인</button><a class="gate-guest" href="/v2/main.html">손님용 출근표 보기</a></div>`;
    root.querySelector('#gateLogin').onclick = () => A.auth.openLogin();
    host.replaceChildren(root);
    host.removeAttribute('aria-busy');
  }
  async function render({ keep = false } = {}) {
    const my = ++seq;
    if (!A.session) { pendingRoot = null; renderGate(); return true; }
    document.body.classList.remove('gated');
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
      if (refreshing || e.touches.length !== 1 || document.querySelector('#app > .modal:not(.closing)')) { mode = -1; return; }
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
    if (!A.session && A.auth) A.auth.openLogin();
  }

  Object.assign(A, {
    $, esc, pad, ymd, parse, DAYS, fmt, fmtShort, ymOf, firstSyl, today, sundayOf, ymShift, igUrl,
    FLOORS, THEMES, floorOf, themeKey, logo, storeName, josa, ICON, emptyBox, avatar, storeTag, pageHead, isAdmin,
    cho, nameHit, staffPick, bindStaffPick,
    sheet, confirm: confirmBox, prompt: promptBox, toast,
    state, TABS, go, goDay, render, renderShell, screens, views,
    screen: (k, def) => { screens[ALIAS[k] || k] = def; },
    view: (k, def) => { views[k] = def; },
  });
  queueMicrotask(boot);
}
