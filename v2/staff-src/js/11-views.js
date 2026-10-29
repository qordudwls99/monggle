// 스케줄의 주간 · 월간 · 야간 보기 + 야간 멤버 넣기/빼기 (A.night).
// 틀(보기 전환·매장 칩·날짜 바)은 10-day.js 가 그리고, 여기 render(listEl, {ds, wp, admin, edit}) 를 불러요.
// 운영 staff.html: 야간 시트 1232-1301, 야간 1853-1912, 월간 1913-1998, 주간 2000-2049. 생김새·문구는 시안 proto/js/views.js
{
  const A = window.App;
  const esc = s => A.esc(s);
  const I = A.ICON;
  const NIGHT_WP = '데빌';
  const DEFAULT_HOURS = '주간 16:00~23:00 · 야간 23:00~익일 05:00';   // 운영 기본값 (ensureNightOn, 2131)
  const floorsOf = wp => wp === '전체' ? A.FLOORS.map(f => f[0]) : [wp];
  const dowCls = d => d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '';
  const stepMonth = (d, dir) => new Date(d.getFullYear(), d.getMonth() + dir, 1);   // setMonth 는 31일에 달을 건너뛰어요
  const sameYM = (d, ds) => A.ymd(d).slice(0, 7) === String(ds).slice(0, 7);
  const sundayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  const isMe = p => !!(A.session && p && p.staffId != null && Number(p.staffId) === Number(A.session.id));
  const meMark = '<span class="sr">(나)</span>';
  const locked = () => (A.lockedMonth && A.lockedMonth()) || A.emptyBox('lock', '아직 공개되지 않은 달이에요', '스케줄이 확정되면 볼 수 있어요');
  const failBox = () => A.emptyBox('cal', '불러오지 못했어요', '당겨서 새로고침해 주세요');
  const draftBar = ds => (A.draftBar && A.draftBar(ds)) || '';
  const sid = () => (A.session ? A.session.id : null);
  const vw = () => Math.min(window.innerWidth || 390, 480);

  // 이름을 한 줄에: 칸 너비(px)에 맞춰 긴 이름만 글자를 줄임 (한글 1em, 영문·기호 약 0.55em)
  const fitName = (name, base, avail) => {
    let u = 0; for (const ch of String(name)) u += /[ㄱ-힣]/.test(ch) ? 1 : 0.55;
    const fs = Math.max(7, Math.min(base, Math.floor(avail / Math.max(u, 1) * 10) / 10));
    return fs < base ? ` style="font-size:${fs}px"` : '';
  };
  // div 칸(안에 버튼·링크가 있어서 button 으로 못 씀): 누르기 + Enter/Space
  function bindTap(root, sel, fn) {
    root.querySelectorAll(sel).forEach(c => {
      c.addEventListener('click', e => { if (e.target.closest('[data-act], a')) return; fn(c); });
      c.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); fn(c); } });
    });
  }
  const act = (root, name, fn) => root.querySelectorAll(`[data-act="${name}"]`).forEach(b => b.addEventListener('click', e => { e.stopPropagation(); fn(b); }));
  // 쓰기 뒤: 읽기 버림 → 다시 그림 → 알림
  async function after(ds, msg) {
    if (ds) A.store.invalidate(ds, ds); else A.store.invalidateAll();
    await A.render({ keep: true });
    if (msg) A.toast(msg);
  }
  // 공개 전 달 띠 (관리자): 보이는 날짜 중 공개 전인 달마다 하나
  function draftBars(dss) {
    const seen = new Set(), out = [];
    dss.forEach(ds => { const ym = A.ymOf(ds); if (!seen.has(ym) && A.store.isDraft(ds)) { seen.add(ym); out.push(draftBar(ds)); } });
    return out.join('');
  }

  // ───────────────────────── 주간 ─────────────────────────
  function person(p, o) {
    const me = isMe(p);
    const attrs = o.night ? ` data-night-id="${p.id}"` : ` data-shift-id="${p.id}" data-date="${esc(p.date)}" data-wp="${esc(p.wp)}"`;
    return `<span class="n vw-p${p.guest ? ' g' : ''}${me ? ' me' : ''}"${attrs}>${A.avatar({ name: p.name, avatar: p.guest ? null : p.avatar }, 'wav')}<span class="vw-nm"${fitName(p.name, 11.5, o.avail)}>${esc(p.name)}</span>${me ? meMark : ''}</span>`;
  }
  // 칸 안 이름: 게스트를 위에 모아 작은 '게스트' 글자로 묶고, 선 아래에 직원
  function weekNames(list, o) {
    const gs = list.filter(p => p.guest), st = list.filter(p => !p.guest);
    return (gs.length ? `<span class="gl">게스트</span>${gs.map(p => person(p, o)).join('')}${st.length ? '<span class="gsep"></span>' : ''}` : '') + st.map(p => person(p, o)).join('');
  }
  function weekCell(info, avail) {
    const open = info.slots.length ? `<span class="vw-op">모집중 ${info.slots.length}</span>` : '';
    const day = weekNames(info.shifts, { avail }) + open;
    let html = (info.event ? `<span class="ev"${fitName(info.event, 10, avail + 14)}>${esc(info.event)}</span>` : '') + (day || '<span class="no">없음</span>');
    if (info.night) {
      const ms = info.night.members.filter(m => !m.short), sh = info.night.members.length - ms.length;
      const nm = weekNames(ms, { avail, night: true }) + (sh ? `<span class="vw-op">부족 ${sh}</span>` : '');
      html += `<span class="nsep"></span><span class="ntl">${I.moon}야간</span>${nm || '<span class="no">미정</span>'}`;
    }
    return html;
  }
  function weekTitle(d) {
    const a = sundayOf(d), b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 6);
    return `${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() !== a.getMonth() ? `${b.getMonth() + 1}월 ` : ''}${b.getDate()}일`;
  }
  async function renderWeek(listEl, { ds, wp, admin }) {
    const sun = sundayOf(A.parse(ds));
    const dates = [...Array(7)].map((_, i) => new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + i));
    const dss = dates.map(A.ymd);
    if (!await A.store.ensure(dss[0], dss[6])) { listEl.innerHTML = failBox(); return; }
    const groups = floorsOf(wp), today = A.today();
    const avail = (vw() - 20) / 7 - 20;   // 칸 너비 - 사진(14) - 틈
    const days = dates.map((day, i) => {
      const d = dss[i], draft = A.store.isDraft(d), hide = draft && !admin, per = {};
      if (!hide) groups.forEach(g => { per[g] = A.store.day(d, g); });
      return { day, ds: d, draft, hide, per, off: !hide && groups.every(g => per[g].closed) };
    });
    if (days.every(x => x.hide)) { listEl.innerHTML = locked(); return; }
    const head = days.map(x => `<button class="wt-h${dowCls(x.day)}${x.ds === today ? ' today' : ''}" data-goday="${x.ds}" aria-label="${A.fmt(x.ds)} 일별로 보기"><span class="dow">${A.DAYS[x.day.getDay()]}</span><span class="dn">${x.day.getDate()}</span>${x.draft ? '<span class="st">미공개</span>' : x.off ? '<span class="st">휴무</span>' : ''}</button>`).join('');
    const bands = groups.map(g => {
      const cells = days.map(x => {
        const info = x.per[g];
        let inner, label;
        if (x.hide) { inner = '<span class="no">비공개</span>'; label = '비공개'; }
        else if (info.closed) { inner = '<span class="no">휴무</span>'; label = '휴무'; }
        else {
          inner = weekCell(info, avail);
          const nightN = info.night ? info.night.members.filter(m => !m.short).length : 0;
          const mine = info.shifts.some(isMe) || (info.night && info.night.members.some(isMe));
          label = `${info.shifts.length}명${info.slots.length ? ` · 모집중 ${info.slots.length}` : ''}${info.night ? ` · 야간 ${nightN}명` : ''}${info.event ? ` · ${info.event}` : ''}${mine ? ' · 내 근무' : ''}`;
        }
        return `<div class="wt-c" role="button" tabindex="0" data-goday="${x.ds}" data-drop-wp="${esc(g)}" data-date="${x.ds}" aria-label="${esc(`${A.fmt(x.ds)} ${A.storeName(g)} ${label}`)}">${inner}</div>`;
      }).join('');
      return `<div class="wt-band" data-theme="${A.themeKey(g)}"><div class="wt-label"><i></i>${A.floorOf(g)} ${esc(g)}</div><div class="wt-row">${cells}</div></div>`;
    }).join('');
    const bar = admin ? draftBars(dss) : '';
    listEl.innerHTML = `${bar}<div class="wt vw"><div class="wt-row wt-head">${head}</div>${bands}</div><p class="wk-hint">칸을 누르면 그날 출근표로 가요</p>`;
    listEl.querySelectorAll('.wt-h[data-goday]').forEach(b => b.onclick = () => A.goDay(b.dataset.goday, wp));
    bindTap(listEl, '.wt-c[data-goday]', c => A.goDay(c.dataset.goday, wp));
    if (bar && A.bindDraft) A.bindDraft(listEl);
    if (A.drag && A.drag.bind) A.drag.bind(listEl);
  }
  A.view('week', {
    title: weekTitle,
    isNow: d => A.ymd(sundayOf(d)) === A.ymd(sundayOf(A.parse(A.today()))),
    now: ['이번 주', '이번 주로'],
    step: (d, dir) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + dir * 7),
    render: renderWeek,
  });

  // ───────────────────────── 월간 (층마다 달력) ─────────────────────────
  function monthNames(list, o) {
    const nm = p => {
      const me = isMe(p);
      const attrs = o.night ? ` data-night-id="${p.id}"` : ` data-shift-id="${p.id}" data-date="${esc(p.date)}" data-wp="${esc(p.wp)}"`;
      return `<span class="mnm${p.guest ? ' g' : ''}${me ? ' me' : ''}"${attrs}${fitName(p.name, 10, o.avail)}>${esc(p.name)}${me ? meMark : ''}</span>`;
    };
    const gs = list.filter(p => p.guest), st = list.filter(p => !p.guest);
    return (gs.length ? `<span class="vm-gl">게스트</span>${gs.map(nm).join('')}${st.length ? '<span class="vm-gsep"></span>' : ''}` : '') + st.map(nm).join('');
  }
  const shortTag = (admin, act, id, ds, wp) => admin
    ? `<button class="vm-short" data-act="${act}" data-id="${id}" data-ds="${ds}" data-wp="${esc(wp)}" aria-label="부족 자리 빼기">부족</button>`
    : '<span class="vm-short">부족</span>';
  function monthCell(info, day, o) {
    const ds = info.ds, wp = info.wp;
    const night = !info.closed && info.night;
    const num = `<span class="mn">${day.getDate()}${night ? `<span class="vm-moon" aria-hidden="true">${I.moon}</span>` : ''}</span>`;
    let body, label;
    if (info.closed) { body = '<span class="moff">휴무</span>'; label = '휴무'; }
    else {
      const ev = info.event
        ? (o.admin ? `<button class="mev vm-ev" data-act="event" data-ds="${ds}" data-wp="${esc(wp)}" aria-label="이벤트 ${esc(info.event)} 바꾸기">${esc(info.event)}</button>` : `<span class="mev">${esc(info.event)}</span>`)
        : (o.admin ? `<button class="vm-ev add" data-act="event" data-ds="${ds}" data-wp="${esc(wp)}" aria-label="이벤트 넣기">＋데이</button>` : '');
      let ns = '';
      if (night) {
        const ms = info.night.members.filter(m => !m.short), sh = info.night.members.filter(m => m.short);
        ns = `<span class="vm-nsep"></span><span class="vm-ntl">${I.moon}야간</span>${monthNames(ms, { avail: o.avail, night: true })}${sh.map(m => shortTag(o.admin, 'nshort', m.id, ds, wp)).join('')}`;
      }
      const hope = o.admin ? `<button class="vm-tb" data-act="hope" data-ds="${ds}" data-wp="${esc(wp)}" aria-label="희망자 넣기">＋희망</button>` : '';
      body = ev + monthNames(info.shifts, { avail: o.avail }) + info.slots.map(s => shortTag(o.admin, 'short', s.id, ds, wp)).join('') + ns + hope;
      const mine = info.shifts.some(isMe) || (night && info.night.members.some(isMe));
      label = `${info.shifts.length}명${info.slots.length ? ` 부족 ${info.slots.length}` : ''}${night ? ` 야간 ${info.night.members.filter(m => !m.short).length}명` : ''}${info.event ? `, ${info.event}` : ''}${mine ? ', 내 근무' : ''}`;
    }
    return `<div class="mc vm-c${dowCls(day)}${ds === o.today ? ' today' : ''}" role="button" tabindex="0" data-goday="${ds}" data-drop-wp="${esc(wp)}" data-date="${ds}" aria-label="${esc(`${A.fmt(ds)} ${A.storeName(wp)} ${label}`)}">${num}${body}</div>`;
  }
  async function renderMonth(listEl, { ds, wp, admin }) {
    const d0 = A.parse(ds), y = d0.getFullYear(), m = d0.getMonth(), N = new Date(y, m + 1, 0).getDate();
    const ym = A.ymOf(ds), first = `${ym}-01`, last = `${ym}-${A.pad(N)}`;
    if (!await A.store.ensure(first, last)) { listEl.innerHTML = failBox(); return; }
    const draft = A.store.isDraft(first);
    if (draft && !admin) { listEl.innerHTML = locked(); return; }
    const groups = floorsOf(wp), today = A.today(), lead = new Date(y, m, 1).getDay();
    const avail = (vw() - 50) / 7 - 6;
    const dow = `<div class="mdow" aria-hidden="true">${A.DAYS.map((x, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${x}</span>`).join('')}</div>`;
    const grids = groups.map(g => {
      let cells = '<span class="mc blank" aria-hidden="true"></span>'.repeat(lead);
      for (let d = 1; d <= N; d++) {
        const day = new Date(y, m, d);
        cells += monthCell(A.store.day(A.ymd(day), g), day, { admin, avail, today });
      }
      return `<section class="vm-floor" data-theme="${A.themeKey(g)}"><div class="vm-h">${A.storeTag(g)}</div>${dow}<div class="mgrid">${cells}</div></section>`;
    }).join('');
    const bar = admin && draft ? draftBar(first) : '';
    const tip = admin ? '날짜를 누르면 그날로 가요. 부족을 누르면 뺄 수 있어요' : '날짜를 누르면 그날 출근표로 가요';
    listEl.innerHTML = `${bar}<button class="btn vm-capture" data-act="capture">스케줄 이미지</button>${grids}<p class="wk-hint">${tip}</p>`;
    bindTap(listEl, '.vm-c[data-goday]', c => A.goDay(c.dataset.goday, wp));
    act(listEl, 'capture', () => (A.capture && A.capture.open) ? A.capture.open(ym, wp) : A.toast('스케줄 이미지는 준비 중이에요'));
    if (admin) {
      act(listEl, 'event', b => editEvent(b.dataset.ds, b.dataset.wp));
      act(listEl, 'hope', b => (A.adminTools && A.adminTools.openHopes) ? A.adminTools.openHopes(b.dataset.ds, b.dataset.wp) : A.toast('희망자 넣기는 준비 중이에요'));
      act(listEl, 'short', b => deleteShort(Number(b.dataset.id), b.dataset.ds, b.dataset.wp));
      act(listEl, 'nshort', b => {
        const ds2 = b.dataset.ds, info = A.store.day(ds2, NIGHT_WP);
        const mem = info.night && info.night.members.find(x => x.id === Number(b.dataset.id));
        remove(mem || { id: Number(b.dataset.id), date: ds2, wp: NIGHT_WP, name: '부족', short: true });
      });
    }
    if (bar && A.bindDraft) A.bindDraft(listEl);
    if (A.drag && A.drag.bind) A.drag.bind(listEl);
  }
  async function editEvent(ds, wp) {
    const cur = A.store.day(ds, wp).event || '';
    const v = await A.prompt({ title: cur ? '이벤트 바꾸기' : '이벤트 넣기', text: `${A.fmt(ds)} ${wp}`, label: '이벤트 이름', value: cur, placeholder: '비우면 이벤트가 지워져요', ok: '저장' });
    if (v === null || v === cur) return;
    const r = await A.api.rpc('admin_set_day_event', { p_admin_id: sid(), p_date: ds, p_workplace: wp, p_event: v });
    if (r === false) return;
    await after(ds, v ? '이벤트를 저장했어요' : '이벤트를 지웠어요');
  }
  async function deleteShort(id, ds, wp) {
    if (!await A.confirm({ title: '이 부족 자리를 뺄까요?', text: `${A.fmt(ds)} ${wp} 빈 자리가 없어져요.`, ok: '빼기', danger: true })) return;
    const r = await A.api.rpc('admin_delete_shift', { p_admin_id: sid(), p_shift_id: Number(id) });
    if (r === false) return;
    await after(ds, '부족 자리를 뺐어요');
  }
  A.view('month', {
    title: d => `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    isNow: d => sameYM(d, A.today()),
    now: ['이번 달', '이번 달로'],
    step: stepMonth,
    render: renderMonth,
  });

  // ───────────────────────── 야간 (데빌) ─────────────────────────
  function pill(m, admin) {
    if (m.short) {
      return admin
        ? `<button class="nt-p short" data-act="rm" data-id="${m.id}" data-night-id="${m.id}" aria-label="부족 자리 빼기">부족</button>`
        : `<span class="nt-p short" data-night-id="${m.id}">부족</span>`;
    }
    const me = isMe(m);
    const inner = `${A.avatar({ name: m.name, avatar: m.guest ? null : m.avatar }, 'nt-av')}<span class="nt-nm">${esc(m.name)}</span>${m.guest ? '<span class="nt-g">게스트</span>' : ''}${me ? '<span class="nt-me">나</span>' : ''}`;
    const main = admin
      ? `<button class="nt-pb" data-act="rm" data-id="${m.id}" aria-label="${esc(m.name)}님을 야간에서 빼기">${inner}</button>`
      : `<span class="nt-pb">${inner}</span>`;
    const url = A.igUrl(m.insta);
    const ig = url ? `<a class="ig-mini nt-ig" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(m.name)} 인스타그램">${I.ig}</a>` : '';
    return `<span class="nt-p${url ? ' has-ig' : ''}" data-night-id="${m.id}">${main}${ig}</span>`;
  }
  async function renderNight(listEl, { ds, admin }) {
    listEl.dataset.theme = 'devil';
    const d0 = A.parse(ds), y = d0.getFullYear(), m = d0.getMonth(), N = new Date(y, m + 1, 0).getDate();
    const ym = A.ymOf(ds), first = `${ym}-01`;
    if (!await A.store.ensure(first, `${ym}-${A.pad(N)}`)) { listEl.innerHTML = failBox(); return; }
    const draft = A.store.isDraft(first);
    if (draft && !admin) { listEl.innerHTML = locked(); return; }
    const today = A.today();
    // 야간은 토요일에만 → 토요일 + (혹시 야간 잡힌 날)만 목록으로
    const items = [];
    for (let d = 1; d <= N; d++) {
      const day = new Date(y, m, d), info = A.store.day(A.ymd(day), NIGHT_WP);
      if (day.getDay() === 6 || info.night) items.push(info);
    }
    const rows = items.map(info => {
      const x = info.ds, isToday = x === today, members = info.night ? info.night.members : [];
      const hours = info.night ? info.night.hours : '';
      const acts = admin && !info.closed
        ? `<span class="nt-acts">${info.night ? `<button class="btn sm" data-act="hours" data-ds="${x}" aria-label="${A.fmt(x)} 야간 시간 바꾸기">시간</button>` : ''}<button class="btn sm" data-act="add" data-ds="${x}" aria-label="${A.fmt(x)} 야간에 멤버 넣기">＋ 멤버</button></span>` : '';
      const body = members.length
        ? `<div class="nt-m">${members.map(p => pill(p, admin)).join('')}</div>`
        : `<div class="nt-none${info.night ? ' wait' : ''}">${info.closed ? '휴무일이에요' : info.night ? '멤버 미정' : '야간 없음'}</div>`;
      return `<li class="nt-i${isToday ? ' today' : ''}" data-ds="${x}"><div class="nt-h"><span class="nt-d">${A.fmtShort(x)}</span>${isToday ? '<span class="tag">오늘</span>' : ''}${acts}</div>${hours ? `<div class="nt-hrs">${I.moon}<span>${esc(hours)}</span></div>` : ''}${body}</li>`;
    }).join('');
    const bar = admin && draft ? draftBar(first) : '';
    listEl.innerHTML = `${bar}<div class="nt-cap">${A.storeTag(NIGHT_WP)}<span>야간 멤버</span></div>${admin ? '<p class="nt-tip">멤버 이름을 누르면 뺄 수 있어요</p>' : ''}<ol class="nt-list">${rows}</ol>`;
    if (admin) {
      act(listEl, 'add', b => openAdd(b.dataset.ds, NIGHT_WP));
      act(listEl, 'hours', b => editHours(b.dataset.ds, NIGHT_WP));
      act(listEl, 'rm', b => {
        const x = b.closest('[data-ds]').dataset.ds, info = A.store.day(x, NIGHT_WP);
        const mem = info.night && info.night.members.find(p => p.id === Number(b.dataset.id));
        if (mem) remove(mem);
      });
    }
    if (bar && A.bindDraft) A.bindDraft(listEl);
  }
  // 야간 시간은 글 그대로 (ARCH "Night hours are free text"). 비우면 운영 기본값
  async function editHours(ds, wp) {
    const info = A.store.day(ds, wp), cur = info.night ? info.night.hours : '';
    const v = await A.prompt({ title: '야간 시간', text: `${A.fmt(ds)} ${wp} · 손님 페이지에도 이대로 보여요`, label: '영업시간 (시작한 날 기준)', value: cur || DEFAULT_HOURS, ok: '저장' });
    if (v === null) return;
    const hrs = v || DEFAULT_HOURS;
    if (hrs === cur) return;
    const r = await A.api.rpc('admin_set_night', { p_admin_id: sid(), p_date: ds, p_workplace: wp, p_on: true, p_hours: hrs });
    if (r === false) return;
    await after(ds, '야간 시간을 바꿨어요');
  }
  A.view('night', {
    title: d => `${d.getFullYear()}년 ${d.getMonth() + 1}월`,
    isNow: d => sameYM(d, A.today()),
    now: ['이번 달', '이번 달로'],
    step: stepMonth,
    chips: false,
    render: renderNight,
  });

  // ───────────────────────── 야간 멤버 넣기 · 빼기 (A.night) ─────────────────────────
  // 야간 문항 라벨의 날짜(예: "8/1-8/2 ...")가 대상 날짜를 포함하는지 (운영 nightCovers)
  function nightCovers(label, year, target) {
    const mt = String(label).match(/(\d{1,2})\/(\d{1,2})(?:\s*[-~]\s*(\d{1,2})\/(\d{1,2}))?/);
    if (!mt) return false;
    const ymd2 = (mo, d) => `${year}-${A.pad(mo)}-${A.pad(d)}`;
    const start = ymd2(+mt[1], +mt[2]), end = mt[3] ? ymd2(+mt[3], +mt[4]) : start;
    return target >= start && target <= end;
  }
  let addBusy = false;
  // 넣기 전에 그날 야간이 꺼져 있으면 켜요. 켜기에 실패하면 멈춰요 (운영 ensureNightOn 은 결과를 안 봐서 고침)
  // quiet: 명단에 없는 이름이지만 손님 페이지에 '게스트'로 표시하지 않기 (supabase-v2-guest-label.sql 적용 뒤에만)
  async function addMember(ds, wp, { staffId = null, name = null, quiet = false }, who, close) {
    if (addBusy) return false;
    if (!A.session) { if (A.auth && A.auth.openLogin) A.auth.openLogin(); return false; }
    addBusy = true;
    try {
      await A.store.ensure(ds, ds);
      let opened = false;
      if (!A.store.day(ds, wp).night) {
        const on = await A.api.rpc('admin_set_night', { p_admin_id: sid(), p_date: ds, p_workplace: wp, p_on: true, p_hours: DEFAULT_HOURS });
        if (on === false) return false;
        opened = true;
      }
      const r = await A.api.rpc('admin_add_night_member', { p_admin_id: sid(), p_date: ds, p_workplace: wp, p_staff_id: staffId == null ? null : Number(staffId), p_name: name });
      const lr = r !== false && quiet ? await A.api.rpc('admin_set_guest_label', { p_admin_id: sid(), p_date: ds, p_workplace: wp, p_name: name, p_show: false }) : null;
      if (r !== false && close) close();
      A.store.invalidate(ds, ds);
      await A.render({ keep: true });
      if (r === false) return false;
      A.toast((who ? (opened ? `야간을 열고 ${who}님을 넣었어요` : `${who}님을 야간에 넣었어요`) : (opened ? '야간을 열고 부족 자리를 넣었어요' : '부족 자리를 넣었어요')) + (quiet && lr !== false ? ' · 게스트 표시 없이' : ''));
      return true;
    } finally { addBusy = false; }
  }
  const staffAvatar = s => s.avatar_url || s.avatar || null;
  async function openAdd(ds, wp = NIGHT_WP) {
    if (!A.session) { if (A.auth && A.auth.openLogin) A.auth.openLogin(); return; }
    await A.store.ensure(ds, ds);
    const info = A.store.day(ds, wp);
    const members = info.night ? info.night.members : [];
    const taken = new Set(members.filter(x => x.staffId != null).map(x => Number(x.staffId)));
    const takenGuests = new Set(members.filter(x => x.staffId == null && !x.short).map(x => x.name));
    const staff = (A.store.staff() || []).filter(s => !taken.has(Number(s.id)));
    const listHtml = qv => {
      const q = qv.toLowerCase();
      const rows = staff.filter(s => !q || String(s.name || '').toLowerCase().includes(q)).map(s =>
        `<button class="lrow" data-staff="${s.id}" data-name="${esc(s.name)}">${A.avatar({ name: s.name, avatar: staffAvatar(s) })}<span class="lm"><span class="lt">${esc(s.name)}</span></span>${I.plus}</button>`).join('');
      const exact = (A.store.staff() || []).some(s => s.name === qv);
      const fresh = qv && !exact && !takenGuests.has(qv)
        ? `<button class="lrow" data-guest="${esc(qv)}">${A.avatar(qv)}<span class="lm"><span class="lt">'${esc(qv)}' 게스트로 넣기</span><span class="ls">명단에 없는 이름이에요</span></span>${I.plus}</button>`
          + (A.guestLabel ? `<button class="lrow" data-guest="${esc(qv)}" data-quiet>${A.avatar(qv)}<span class="lm"><span class="lt">'${esc(qv)}' 게스트 표시 없이 넣기</span><span class="ls">직원인데 명단에 아직 없을 때</span></span>${I.plus}</button>` : '') : '';
      return (rows + fresh) || '<div class="none">넣을 수 있는 사람이 없어요</div>';
    };
    const note = info.night ? '' : `<br>아직 야간이 없는 날이에요. 멤버를 넣으면 야간이 열려요 (${esc(DEFAULT_HOURS)}).`;
    A.sheet({
      title: '야간에 멤버 넣기',
      html: `<p class="sheet-p">${esc(A.fmt(ds))} ${esc(wp)}${note}</p>
        <div class="nm-cands" data-cands><span class="spin"></span></div>
        <input class="fld" data-q maxlength="20" placeholder="이름 찾기 · 새 게스트 이름" autocomplete="off" aria-label="이름 찾기">
        <div class="pick-list" data-pl>${listHtml('')}</div>`,
      actions: [{ label: '부족 자리 넣기', onClick: close => addMember(ds, wp, { staffId: null, name: '부족' }, null, close) }],
      onOpen: (el, close) => {
        const q = el.querySelector('[data-q]'), pl = el.querySelector('[data-pl]');
        const bind = () => pl.querySelectorAll('[data-staff],[data-guest]').forEach(b => b.onclick = () => {
          if (b.dataset.staff) addMember(ds, wp, { staffId: Number(b.dataset.staff), name: null }, b.dataset.name, close);
          else addMember(ds, wp, { staffId: null, name: b.dataset.guest, quiet: 'quiet' in b.dataset }, b.dataset.guest, close);
        });
        q.oninput = () => { pl.innerHTML = listHtml(q.value.trim()); bind(); };
        bind();
        loadCands(el.querySelector('[data-cands]'), ds, wp, taken, close);
      },
    });
  }
  // '가능'이라고 낸 사람 (그날을 덮는 야간 문항 기준, 운영 loadNmCands)
  async function loadCands(box, ds, wp, taken, close) {
    const ym = A.ymOf(ds);
    const [qs, ans] = await Promise.all([A.store.nightQuestions(ym), A.store.answers(ym)]);
    if (!box.isConnected) return;
    if (!qs.length) { box.innerHTML = '<p class="nm-note">이 달 야간 문항이 없어요</p>'; return; }
    const byq = {};
    ans.forEach(a => { if (a.qkey && a.qkey.indexOf('n:') === 0) (byq[a.qkey.slice(2)] = byq[a.qkey.slice(2)] || []).push(a); });
    const yr = Number(ym.split('-')[0]);
    const covering = qs.find(n => n.date === ds && (!n.wp || n.wp === wp)) || qs.find(n => nightCovers(n.label, yr, ds));
    const defId = String((covering || qs[0]).id);
    const sel = qs.length > 1
      ? `<select class="fld" data-qsel aria-label="야간 문항">${qs.map(n => `<option value="${n.id}"${String(n.id) === defId ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</select>`
      : `<p class="nm-note">${esc(qs[0].label)}</p>`;
    box.innerHTML = `<div class="nm-t">가능하다고 낸 사람 · 누르면 넣어요</div>${sel}<div data-chips></div>`;
    const chipsEl = box.querySelector('[data-chips]'), qsel = box.querySelector('[data-qsel]');
    const draw = () => {
      const qid = qsel ? qsel.value : defId, seen = new Set(), list = [];
      (byq[qid] || []).forEach(r => {
        const id = Number(r.staffId);
        if (r.choice === '가능' && r.staffId != null && !taken.has(id) && !seen.has(id)) { seen.add(id); list.push({ id, name: r.staffName }); }
      });
      list.sort((x, y) => String(x.name).localeCompare(String(y.name), 'ko'));
      chipsEl.innerHTML = list.length
        ? `<div class="nm-chips">${list.map(c => `<button class="nm-chip" data-pick="${c.id}" data-name="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>`
        : '<p class="nm-note">이 날짜에 가능하다고 낸 사람이 없어요</p>';
      chipsEl.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => addMember(ds, wp, { staffId: Number(b.dataset.pick), name: null }, b.dataset.name, close));
    };
    if (qsel) qsel.onchange = draw;
    draw();
  }
  // member: store 의 Night ({id, date, wp, name, short})
  async function remove(member) {
    if (!member || member.id == null) return false;
    const short = !!member.short, name = member.name || '';
    const where = member.date ? `${A.fmt(member.date)} ${member.wp || NIGHT_WP} 야간에서 빠져요.` : '';
    if (!await A.confirm({ title: short ? '이 부족 자리를 뺄까요?' : `${name}님을 야간에서 뺄까요?`, text: where, ok: '빼기', danger: true })) return false;
    const r = await A.api.rpc('admin_remove_night_member', { p_admin_id: sid(), p_id: Number(member.id) });
    if (r === false) return false;
    await after(member.date || null, short ? '부족 자리를 뺐어요' : `${name}님을 야간에서 뺐어요`);
    return true;
  }
  A.night = { openAdd, remove };
}
