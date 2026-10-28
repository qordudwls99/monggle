// 관리 도구 (운영 staff.html 1464-1666, 2772-2780): 표로 시프트 짜기 · 제출 표 · 매장별 희망 달력 · 근무일수 ·
// 야간 목록 · 한 사람 제출 내용, 그리고 희망자 넣기 시트. 넓은 표는 시트 안에서 가로로 넘기고 이름 칸과 날짜 줄은 고정.
// 쓰기: admin_set_assignment, admin_assign_from_submission, admin_add_shift (파라미터는 운영과 같음)
{
  const A = window.App;
  const coll = new Intl.Collator('ko');
  const WPS = () => A.FLOORS.map(f => f[0]);                      // 데빌 → 메이드 → 마츠리
  const floorIdx = wp => { const i = WPS().indexOf(wp); return i < 0 ? 9 : i; };
  // 제출 값 → 칸 색 이름 (노랑 없음: 상관없음은 연한 초록, 출근불가능은 연한 빨강)
  const PK = { '데빌': 'devil', '메이드': 'maid', '마츠리': 'matsuri', '상관없음': 'any', '출근불가능': 'off' };
  const SHORT = { '데빌': '데', '메이드': '메', '마츠리': '마', '상관없음': '상' };
  const monthDays = ym => { const [y, m] = ym.split('-').map(Number); const n = new Date(y, m, 0).getDate(); return Array.from({ length: n }, (_, i) => `${ym}-${A.pad(i + 1)}`); };
  const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${y}년 ${m}월`; };
  const dowCls = ds => { const w = A.parse(ds).getDay(); return w === 0 ? 'sun' : w === 6 ? 'sat' : ''; };
  const LOADING = '<div class="tl-load"><span class="spin"></span></div>';
  const none = t => `<p class="tl-none">${A.esc(t)}</p>`;
  const adminId = () => A.session ? A.session.id : null;
  const avUrl = st => (st && (st.avatar_url || st.avatar)) || null;

  // 화면 높이 시트: 위 고정줄(.tl-top) + 넘기는 몸통(.tl-body)
  function toolSheet({ title, sub }) {
    let open = true;
    const s = A.sheet({
      title,
      html: `${sub ? `<p class="tl-sub">${A.esc(sub)}</p>` : ''}<div class="tl-top"></div><div class="tl-body">${LOADING}</div>`,
      onClose: () => { open = false; },
      onOpen: el => el.querySelector('.modal-c').classList.add('tl-sheet'),
    });
    return { ...s, top: s.el.querySelector('.tl-top'), body: s.el.querySelector('.tl-body'), alive: () => open && document.contains(s.el) };
  }
  // 표 머리: 이름 칸 + 날짜 (요일 색)
  const headRow = days => `<thead><tr><th class="tl-nc" scope="col">이름</th>${days.map(ds => { const d = A.parse(ds);
    return `<th class="${dowCls(ds)}" scope="col">${d.getDate()}<small>${A.DAYS[d.getDay()]}</small></th>`; }).join('')}</tr></thead>`;
  const legend = items => `<div class="tl-legend">${items.map(([k, t, sw = '']) => `<span><i class="pf-${k}">${A.esc(sw)}</i>${A.esc(t)}</span>`).join('')}</div>`;
  const PREF_LEGEND = [['devil', '데빌'], ['maid', '메이드'], ['matsuri', '마츠리'], ['any', '상관없음'], ['off', '출근불가능']];
  // 날짜별 희망 (d:YYYY-MM-DD) → {staffId: {ds: choice}}
  const dayPrefs = ans => { const p = {}; ans.forEach(a => { if (a.qkey && a.qkey.startsWith('d:')) (p[a.staffId] = p[a.staffId] || {})[a.qkey.slice(2)] = a.choice; }); return p; };

  // ── 표로 시프트 짜기: 한 사람 × 하루마다 매장 고르기, 고르면 바로 저장 (운영 1504-1530, 2772-2780) ──
  async function builder(ym) {
    const t = toolSheet({ title: '표로 시프트 짜기', sub: `${ymLabel(ym)} · 칸에서 매장을 고르면 바로 저장돼요` });
    const days = monthDays(ym);
    const [ok, ans] = await Promise.all([A.store.ensure(days[0], days[days.length - 1]), A.store.answers(ym)]);
    if (!t.alive()) return;
    if (!ok) { t.body.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '시트를 닫고 다시 열어 주세요'); return; }
    const staff = A.store.staff();
    if (!staff.length) { t.body.innerHTML = none('직원이 없어요'); return; }
    const asn = {};
    days.forEach(ds => WPS().forEach(wp => A.store.day(ds, wp).shifts.forEach(s => { if (s.staffId != null) (asn[s.staffId] = asn[s.staffId] || {})[ds] = wp; })));
    const pref = dayPrefs(ans);
    const opts = cur => `<option value="">-</option>${WPS().map(w => `<option value="${w}"${w === cur ? ' selected' : ''}>${w}</option>`).join('')}`;
    const rows = staff.map(s => `<tr><th class="tl-nc" scope="row">${A.esc(s.name)}</th>${days.map(ds => {
      const cur = (asn[s.id] || {})[ds] || '', p = (pref[s.id] || {})[ds] || '';
      return `<td class="bx-c${p ? ' pf-' + PK[p] : ''}"><select class="bx-sel${cur ? ' as-' + A.themeKey(cur) : ''}" data-sid="${s.id}" data-d="${ds}" data-cur="${cur}" aria-label="${A.esc(s.name)} ${A.fmtShort(ds)}">${opts(cur)}</select></td>`;
    }).join('')}</tr>`).join('');
    t.top.innerHTML = legend(PREF_LEGEND.map(([k, l]) => [k, l, k === 'off' ? '-' : ''])) + '<p class="tl-note">칸 바탕은 희망, 진한 칸은 넣은 매장이에요</p>';
    t.body.innerHTML = `<table class="tl-mx bx">${headRow(days)}<tbody>${rows}</tbody></table>`;
    t.body.addEventListener('change', async e => {
      const sel = e.target.closest && e.target.closest('select.bx-sel');
      if (!sel) return;
      const sid = Number(sel.dataset.sid), ds = sel.dataset.d, wp = sel.value, prev = sel.dataset.cur || '';
      sel.disabled = true;
      const r = await A.api.rpc('admin_set_assignment', { p_admin_id: adminId(), p_date: ds, p_staff_id: sid, p_workplace: wp || null });
      sel.disabled = false;
      if (r === false) { sel.value = prev; return; }
      // 이 칸만 바꿔요 (표 전체를 다시 읽으면 스크롤·선택이 풀리고, 빠르게 두 번 고르면 순서가 엉켜요)
      sel.dataset.cur = wp;
      sel.className = 'bx-sel' + (wp ? ' as-' + A.themeKey(wp) : '');
      A.store.invalidate(ds);
      A.render({ keep: true });
    });
  }

  // ── 제출 표 (읽기만, 운영 1531-1553): 출근불가능·안 고른 날은 빈칸 ──
  async function matrix(ym) {
    const t = toolSheet({ title: '제출 표', sub: `${ymLabel(ym)} · 이름 × 날짜, 옆으로 넘겨 보세요` });
    const days = monthDays(ym);
    const [ans] = await Promise.all([A.store.answers(ym), A.store.directory()]);
    if (!t.alive()) return;
    const pref = dayPrefs(ans);
    const answered = new Set(ans.map(a => a.staffId));
    const rows = A.store.staff().filter(s => answered.has(s.id));
    if (!rows.length) { t.body.innerHTML = none('제출한 사람이 없어요'); return; }
    t.top.innerHTML = legend(PREF_LEGEND.slice(0, 4).map(([k, l]) => [k, l, SHORT[l]]));
    t.body.innerHTML = `<table class="tl-mx mx">${headRow(days)}<tbody>${rows.map(s => `<tr><th class="tl-nc" scope="row">${A.esc(s.name)}</th>${days.map(ds => {
      const c = (pref[s.id] || {})[ds] || '', show = c && c !== '출근불가능';
      return `<td class="mx-c${show ? ' pf-' + PK[c] : ''}"${show ? ` title="${A.esc(c)}"` : ''}>${show ? A.esc(SHORT[c] || c) : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  // ── 매장별 희망 달력 (운영 1554-1587): 진한 이름 = 이 매장, 흐린 이름 = 상관없음 ──
  async function hopecal(ym) {
    const t = toolSheet({ title: '희망 달력', sub: ymLabel(ym) });
    let wp = WPS().includes(A.state.wp) ? A.state.wp : WPS()[0];
    const ans = await A.store.answers(ym);
    if (!t.alive()) return;
    const [y, m] = ym.split('-').map(Number);
    const days = monthDays(ym), first = new Date(y, m - 1, 1).getDay();
    const draw = () => {
      t.top.innerHTML = `<div class="chips tl-chips" role="group" aria-label="매장">${A.FLOORS.map(([w, fl]) => { const th = A.THEMES[w];
        return `<button class="chip${w === wp ? ' on' : ''}" data-w="${w}" aria-pressed="${w === wp}" style="--c:${th.c};--cs:${th.cs};--ci:${th.ci}"><img src="${A.logo(w)}" alt=""><span class="ct"><b>${w}</b><small>${fl}</small></span></button>`; }).join('')}</div>
        <div class="tl-legend"><span><b>진한 이름</b> ${A.esc(wp)} 희망</span><span><span class="hc-any">흐린 이름</span> 상관없음</span></div>`;
      t.top.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { wp = b.dataset.w; draw(); });
      const by = {};
      ans.forEach(a => {
        if (!a.qkey || !a.qkey.startsWith('d:')) return;
        const r = by[a.qkey.slice(2)] = by[a.qkey.slice(2)] || { p: [], any: [] };
        if (a.choice === wp) r.p.push(a.staffName); else if (a.choice === '상관없음') r.any.push(a.staffName);
      });
      const sortK = l => l.slice().sort(coll.compare);
      let cells = '<div class="hc-c blank"></div>'.repeat(first);
      days.forEach(ds => {
        const r = by[ds] || { p: [], any: [] };
        cells += `<div class="hc-c ${dowCls(ds)}"><span class="hc-dn">${A.parse(ds).getDate()}</span>${sortK(r.p).map(n => `<span class="hc-nm">${A.esc(n)}</span>`).join('')}${sortK(r.any).map(n => `<span class="hc-nm hc-any">${A.esc(n)}</span>`).join('')}</div>`;
      });
      t.body.innerHTML = `<div class="hc" data-theme="${A.themeKey(wp)}"><div class="mdow">${A.DAYS.map((d, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span>`).join('')}</div><div class="hc-grid">${cells}</div></div>`;
    };
    draw();
  }

  // ── 근무일수 (야간 포함, 운영 1483-1503) ──
  async function counts(ym) {
    const t = toolSheet({ title: '근무일수', sub: `${ymLabel(ym)} · 한 달 근무한 날 (야간 포함)` });
    const days = monthDays(ym);
    const ok = await A.store.ensure(days[0], days[days.length - 1]);
    if (!t.alive()) return;
    if (!ok) { t.body.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '시트를 닫고 다시 열어 주세요'); return; }
    const per = {};
    const add = (id, name, ds, k) => { if (id == null) return; const p = per[id] = per[id] || { name, dates: new Set(), by: {} }; p.dates.add(ds); (p.by[k] = p.by[k] || new Set()).add(ds); };
    days.forEach(ds => WPS().forEach(wp => {
      const d = A.store.day(ds, wp);
      d.shifts.forEach(s => add(s.staffId, s.name, ds, wp));
      if (d.night) d.night.members.forEach(n => { if (!n.guest && !n.short) add(n.staffId, n.name, ds, '야간'); });
    }));
    const rows = Object.values(per).sort((a, b) => (b.dates.size - a.dates.size) || coll.compare(a.name || '', b.name || ''));
    if (!rows.length) { t.body.innerHTML = none('배정된 근무가 없어요'); return; }
    t.body.innerHTML = `<div class="tl-list">${rows.map(r => {
      const bd = [...WPS(), '야간'].filter(k => r.by[k]).map(k => `${k} ${r.by[k].size}`).join(' · ');
      return `<div class="lrow">${A.avatar(r.name)}<span class="lm"><span class="lt">${A.esc(r.name)}</span>${bd ? `<span class="ls">${A.esc(bd)}</span>` : ''}</span><span class="la"><b class="tl-n">${r.dates.size}일</b></span></div>`;
    }).join('')}</div>`;
  }

  // ── 야간 목록 (운영 1464-1482): 날짜 → 층 순서 ──
  async function nights(ym) {
    const t = toolSheet({ title: '야간 목록', sub: `${ymLabel(ym)} · 야간 영업일과 멤버` });
    const days = monthDays(ym);
    const ok = await A.store.ensure(days[0], days[days.length - 1]);
    if (!t.alive()) return;
    if (!ok) { t.body.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '시트를 닫고 다시 열어 주세요'); return; }
    const list = [];
    days.forEach(ds => WPS().forEach(wp => { const d = A.store.day(ds, wp); if (d.night) list.push({ ds, wp, ...d.night }); }));
    list.sort((a, b) => a.ds.localeCompare(b.ds) || (floorIdx(a.wp) - floorIdx(b.wp)));
    if (!list.length) { t.body.innerHTML = none('이 달 야간 영업이 없어요'); return; }
    t.body.innerHTML = `<div class="tl-list">${list.map(n => {
      const mem = n.members.length ? n.members.map(x => x.short ? '<span class="tag red">부족</span>'
        : `<span class="ng-nm">${A.esc(x.name)}${x.guest ? '<small>게스트</small>' : ''}</span>`).join('') : '<span class="ng-no">멤버 미정</span>';
      return `<div class="ng"><div class="ng-h">${A.storeTag(n.wp)}<b class="${dowCls(n.ds)}">${A.esc(A.fmtShort(n.ds))}</b></div>${n.hours ? `<p class="ng-hrs">${A.esc(n.hours)}</p>` : ''}<div class="ng-names">${mem}</div></div>`;
    }).join('')}</div>`;
  }

  // ── 한 사람 제출 내용 (운영 1588-1612) ──
  async function person(id, ym) {
    const nameOf = () => { const st = A.store.staff().find(s => String(s.id) === String(id)); return st ? st.name : ''; };
    const title = n => n ? `${n}님 제출 내용` : '제출 내용';
    const t = toolSheet({ title: title(nameOf()), sub: ymLabel(ym) });
    const [ans, nq] = await Promise.all([A.store.answers(ym), A.store.nightQuestions(ym), A.store.directory()]);
    if (!t.alive()) return;
    t.el.querySelector('.sheet-h b').textContent = title(nameOf());
    const mine = {};
    ans.forEach(a => { if (String(a.staffId) === String(id)) mine[a.qkey] = a.choice; });
    const pick = c => !c ? '<span class="pc-none">-</span>'
      : WPS().includes(c) ? A.storeTag(c)
      : c === '상관없음' ? '<span class="tag soft">상관없음</span>'
      : c === '출근불가능' || c === '불가능' ? `<span class="tag red">${A.esc(c)}</span>`
      : c === '가능' ? '<span class="tag green">가능</span>' : `<span class="tag soft">${A.esc(c)}</span>`;
    const dayRows = monthDays(ym).map(ds => `<div class="pc-r"><span class="pc-d ${dowCls(ds)}">${A.esc(A.fmtShort(ds))}</span>${pick(mine['d:' + ds])}</div>`).join('');
    const nightRows = nq.map(n => `<div class="pc-r"><span class="pc-d pc-l">${A.esc(n.label)}</span>${pick(mine['n:' + n.id])}</div>`).join('');
    t.body.innerHTML = `<h3 class="tl-h">날짜별 희망</h3><div class="pc">${dayRows}</div>${nq.length ? `<h3 class="tl-h">야간</h3><div class="pc">${nightRows}</div>` : ''}`;
  }

  function open(kind, ym) {
    ym = ym || A.ymShift(A.ymOf(A.today()), 1);   // 운영 admYM 기본값 = 다음 달
    kind = String(kind || '');
    if (kind.startsWith('person:')) return person(kind.slice(7), ym);
    const fn = { builder, matrix, hopecal, counts, nights }[kind];
    if (!fn) { A.toast('준비 중인 도구예요', true); return Promise.resolve(); }
    return fn(ym);
  }

  // ── 희망자 넣기 (운영 1614-1666): 이 매장을 고른 사람(상관없음은 그날 아직 아무 데도 없을 때만) + 이름 검색 ──
  function openHopes(ds, wp) {
    const ym = A.ymOf(ds);
    let open = true, placed = {}, busy = false;
    const sheetEl = () => s.el;
    const reload = async () => {
      A.store.invalidate(ds);
      await A.render({ keep: true });
      if (open) await draw();
    };
    const assign = async ids => A.api.rpc('admin_assign_from_submission', { p_admin_id: adminId(), p_date: ds, p_workplace: wp, p_staff_ids: ids });
    const drawSearch = () => {
      const el = sheetEl();
      const q = el.querySelector('[data-hq]').value.trim().toLowerCase(), box = el.querySelector('.hp-res');
      if (!q) { box.innerHTML = ''; return; }
      const hits = A.store.staff().filter(x => String(x.name || '').toLowerCase().includes(q) && !(placed[x.id] && placed[x.id].has(wp))).slice(0, 10);
      box.innerHTML = hits.length ? hits.map(x => `<div class="lrow">${A.avatar(x.name, 'av', avUrl(x))}<span class="lm"><span class="lt">${A.esc(x.name)}</span></span><span class="la"><button class="btn sm" data-add="${x.id}">넣기</button></span></div>`).join('')
        : '<p class="tl-none">찾는 이름이 없어요</p>';
      box.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
        if (busy) return;
        const x = A.store.staff().find(v => String(v.id) === b.dataset.add);
        busy = true; b.setAttribute('aria-busy', 'true');
        const r = await assign([Number(b.dataset.add)]);
        busy = false; b.removeAttribute('aria-busy');
        if (r === false) return;
        await reload();
        A.toast(`${x ? x.name : ''}님을 넣었어요`);
      });
    };
    const draw = async () => {
      const [ok, ans] = await Promise.all([A.store.ensure(ds, ds), A.store.answers(ym)]);
      if (!open || !document.contains(sheetEl())) return;
      const el = sheetEl(), list = el.querySelector('.hp-list');
      if (!ok) { list.innerHTML = '<p class="tl-none">불러오지 못했어요</p>'; return; }
      placed = {};
      WPS().forEach(w => A.store.day(ds, w).shifts.forEach(x => { if (x.staffId != null) (placed[x.staffId] = placed[x.staffId] || new Set()).add(w); }));
      const was = new Set([...list.querySelectorAll('input:checked')].map(i => i.value));
      const cands = [];
      ans.filter(a => a.qkey === 'd:' + ds).forEach(a => {
        if (a.choice === wp) { if (!(placed[a.staffId] && placed[a.staffId].has(wp))) cands.push({ id: a.staffId, name: a.staffName, any: false }); }
        else if (a.choice === '상관없음') { if (!placed[a.staffId]) cands.push({ id: a.staffId, name: a.staffName, any: true }); }
      });
      cands.sort((x, y) => ((x.any ? 1 : 0) - (y.any ? 1 : 0)) || coll.compare(x.name || '', y.name || ''));
      const av = id => avUrl(A.store.staff().find(v => String(v.id) === String(id)));
      list.innerHTML = cands.length ? `<div class="pick-list">${cands.map(c => `<label class="lrow hp-row"><input type="checkbox" value="${c.id}"${was.has(String(c.id)) ? ' checked' : ''}>${A.avatar(c.name, 'av', av(c.id))}<span class="lm"><span class="lt">${A.esc(c.name)}</span></span>${c.any ? '<span class="tag soft">상관없음</span>' : ''}</label>`).join('')}</div>`
        : `<p class="tl-none">${A.esc(wp)}${A.josa(wp, '을', '를')} 고른 사람이 없어요</p>`;
      drawSearch();
    };
    const save = async close => {
      if (busy) return;
      const ids = [...s.el.querySelectorAll('.hp-list input:checked')].map(i => Number(i.value));
      if (!ids.length) { A.toast('넣을 사람을 골라 주세요', true); return; }
      busy = true;
      const r = await assign(ids);
      busy = false;
      if (r === false) return;
      close();
      A.store.invalidate(ds);
      await A.render({ keep: true });
      A.toast(`${typeof r === 'number' ? r : ids.length}명을 넣었어요`);
    };
    const addSlot = async () => {
      if (busy) return;
      busy = true;
      const r = await A.api.rpc('admin_add_shift', { p_admin_id: adminId(), p_work_date: ds, p_workplace: wp, p_start: '', p_end: '', p_assignee: null, p_memo: null, p_guest: null });
      busy = false;
      if (r === false) return;
      await reload();
      A.toast('빈 자리를 추가했어요');
    };
    const html = `<p class="sheet-p">${A.esc(A.fmt(ds))} · ${A.esc(wp)}에 들어가고 싶다고 제출한 사람이에요.</p>
      <div class="hp-list">${LOADING}</div>
      <label class="fld-l">다른 사람 넣기<input class="fld" data-hq type="search" autocomplete="off" placeholder="이름으로 찾기" aria-label="이름으로 찾기"></label>
      <div class="hp-res"></div>`;
    const s = A.sheet({
      title: '희망자', html,
      actions: [{ label: '빈 자리 추가', onClick: addSlot }, { label: '고른 사람 넣기', kind: 'primary', onClick: save }],
      onClose: () => { open = false; },
      onOpen: el => { el.querySelector('[data-hq]').addEventListener('input', drawSearch); },
    });
    draw();
    return s;
  }

  A.adminTools = { open, openHopes };
}
