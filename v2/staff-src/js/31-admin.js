// 관리 화면 (관리자만, 운영 staff.html 1403-1665 · 2460-2547): 달 단계(제출 열기·마감·공개), 제출 현황, 야간 문항,
// 편성 도구(32-admin-tools.js), 근무 추가, 직원 목록·추가, PIN 없는 직원 임시 PIN. 엑셀 가져오기는 옮기지 않아요.
{
  const A = window.App;
  const esc = A.esc, I = A.ICON;
  const STORES = A.FLOORS.map(f => f[0]);           // 데빌 → 메이드 → 마츠리
  const NIGHT_DEFAULT = '23:00-05:00';
  let admYM = null;                                   // 고른 달 (처음엔 다음 달)
  let query = '', filt = 'all', expanded = false;     // 직원 목록 상태
  const SHOW = 8;

  const me = () => A.session;
  const nextYM = () => A.ymShift(A.ymOf(A.today()), 1);
  const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${y}년 ${m}월`; };
  const monOf = ym => +ym.slice(5);
  const hrs = h => String(h || '').replace('-', '~');
  const daysOf = ym => { const [y, m] = ym.split('-').map(Number), out = []; for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) out.push(A.ymd(d)); return out; };
  const mrow = (attr, t, d) => `<button class="menu-row mr2" ${attr}><span class="mr-t"><b>${t}</b><small>${d}</small></span>${I.chev}</button>`;
  const tool = (kind, ym) => { if (A.adminTools && A.adminTools.open) A.adminTools.open(kind, ym); else A.toast('준비 중이에요'); };
  // 쓰기 뒤: 캐시 비우기 → 다시 그리기 → 알림
  const after = async (msg, inv = 'all') => {
    if (inv === 'all') A.store.invalidateAll(); else if (inv) A.store.invalidate(inv, inv);
    await A.render({ keep: true });
    if (msg) A.toast(msg);
  };
  // 바쁜 동안 버튼 막기
  const withBusy = async (btn, fn) => {
    if (btn && btn.getAttribute('aria-busy') === 'true') return;
    if (btn) btn.setAttribute('aria-busy', 'true');
    try { return await fn(); } finally { if (btn) btn.removeAttribute('aria-busy'); }
  };
  // v2 DB 기능이 있는지 (22-bell.js 가 알아봐요). 오래 걸리면 기다리지 않아요
  async function v2db() {
    if (A.featuresReady) await Promise.race([Promise.resolve(A.featuresReady).catch(() => {}), new Promise(r => setTimeout(r, 1500))]);
    return !!(A.features && A.features.v2db);
  }

  // 칸 막대: 30명까지는 한 사람 한 칸, 넘으면 10% 한 칸. 색은 40% 미만 빨강, 80% 미만 주황, 그 위 초록 (프로토타입 그대로)
  function segbar(n, total) {
    const r = total ? n / total : 0, few = total <= 30, cells = few ? total : 10, on = few ? n : Math.floor(r * 10);
    const lvl = r >= .8 ? 'hi' : r >= .4 ? 'mid' : 'lo';
    return `<div class="segbar ${lvl}" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-label="제출한 사람 ${n}/${total}명">${Array.from({ length: cells }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  // ── 1. 달 스케줄: 제출 받는 중 → 마감 → 공개됨 ──
  function scheduleSec(ym, st, staff, answers, hasV2) {
    const m = monOf(ym), open = st.submit_open, pub = st.published;
    const done = new Set(answers.map(a => a.staffId));
    const doneList = staff.filter(s => done.has(s.id)), missing = staff.filter(s => !done.has(s.id));
    const tags = [open ? '<span class="tag green">제출 받는 중</span>' : '', pub ? '<span class="tag">공개됨</span>' : !open ? '<span class="tag soft">마감</span>' : ''].join('');
    // 낸 사람은 접어 둬요 (사람이 많아요). 이름을 누르면 그 사람이 낸 내용
    const doneBox = doneList.length ? `<details class="ad-det"><summary class="ad-lbl">낸 사람 ${doneList.length}명 보기</summary><p class="ad-hint">이름을 누르면 낸 내용을 봐요</p>
      <div class="ad-tags">${doneList.map(s => `<button class="tag soft ad-pb" data-person="${s.id}">${esc(s.name)}</button>`).join('')}</div></details>` : '';
    // 공개 뒤 닫힌 달은 안 낸 사람 이름을 감춰요 (프로토타입과 같음)
    const missBox = !open && pub ? '' : missing.length ? `<div class="ad-miss"><span class="ad-lbl">아직 안 낸 사람 ${missing.length}명</span>
      <div class="ad-tags">${missing.map(s => `<span class="tag soft">${esc(s.name)}</span>`).join('')}</div>
      ${open && hasV2 ? '<button class="btn t44" id="adRemind">다시 알림 보내기</button>' : ''}</div>`
      : staff.length ? '<p class="ad-done">모두 냈어요</p>' : '';
    // 주 버튼은 하나: 받는 중 → 마감하기, 마감·비공개 → 공개하기. 나머지는 보조 버튼
    const main = open ? '<button class="btn lg primary" id="adMain" data-do="close">제출 마감하기</button>'
      : !pub ? `<button class="btn lg primary" id="adMain" data-do="publish">${m}월 공개하기</button>`
      : `<p class="ad-done">${m}월 스케줄이 공개됐어요</p>`;
    const sub = [
      !open ? `<button class="btn lg" data-do="open">${pub ? '직원 제출 열기' : '제출 다시 열기'}</button>` : '',
      pub ? '<button class="btn lg" data-do="unpublish">비공개로 돌리기</button>' : '',
    ].join('');
    return `<section class="sec ad-sec"><div class="sec-h"><h2>${m}월 스케줄</h2><span class="ad-tags">${tags}</span></div>
      <div class="ad-cnt"><b>${done.size}/${staff.length}명 냈어요</b></div>
      ${segbar(done.size, staff.length)}
      ${doneBox}${missBox}${main}${sub ? `<div class="ad-sub">${sub}</div>` : ''}</section>`;
  }
  async function setStage(btn, ym, what) {
    const s = me(), m = monOf(ym);
    if (what === 'close') {
      if (!await A.confirm({ title: '제출을 마감할까요?', text: '마감하면 직원들이 더는 고칠 수 없어요.', ok: '마감하기' })) return;
      await withBusy(btn, async () => {
        if (await A.api.rpc('admin_set_submit_open', { p_admin_id: s.id, p_ym: ym, p_open: false }) === false) return;
        await after('제출을 마감했어요');
      });
    } else if (what === 'open') {
      // 줄이 없는 달에 처음 열면 서버가 published=true 로 만들어요 → 먼저 비공개로 두고 열어요
      const { data, error } = await A.supa.from('schedule_status_view').select('ym').eq('ym', ym);
      if (error) { A.toast('불러오지 못했어요. 다시 해 주세요', true); return; }
      const fresh = !(data && data.length);
      if (!await A.confirm({ title: `${m}월 제출을 열까요?`, text: `직원들이 이 달 희망 근무를 낼 수 있어요.${fresh ? ' 스케줄은 공개 전 상태로 둬요.' : ''}`, ok: '열기' })) return;
      await withBusy(btn, async () => {
        if (fresh && await A.api.rpc('admin_set_published', { p_admin_id: s.id, p_ym: ym, p_pub: false }) === false) return;
        if (await A.api.rpc('admin_set_submit_open', { p_admin_id: s.id, p_ym: ym, p_open: true }) === false) { if (fresh) await after(); return; }
        await after('제출을 열었어요');
      });
    } else if (what === 'publish') {
      if (!await A.confirm({ title: `${m}월 스케줄을 공개할까요?`, text: '공개하면 직원과 손님이 이 달 스케줄을 볼 수 있어요.', ok: '공개하기' })) return;
      await withBusy(btn, async () => {
        if (await A.api.rpc('admin_set_published', { p_admin_id: s.id, p_ym: ym, p_pub: true }) === false) return;
        if (A.features && A.features.v2db) A.api.notify({ event: 'published', ym });   // 직원들에게 (v2 DB 가 있을 때만)
        await after(`${m}월 스케줄을 공개했어요`);
      });
    } else if (what === 'unpublish') {
      if (!await A.confirm({ title: `${m}월 스케줄을 비공개로 돌릴까요?`, text: '직원과 손님이 이 달 스케줄을 더는 볼 수 없어요.', ok: '비공개로 돌리기' })) return;
      await withBusy(btn, async () => {
        if (await A.api.rpc('admin_set_published', { p_admin_id: s.id, p_ym: ym, p_pub: false }) === false) return;
        await after('비공개로 돌렸어요');
      });
    }
  }
  function bindSchedule(el, ym, missing) {
    el.querySelectorAll('[data-do]').forEach(b => b.onclick = () => setStage(b, ym, b.dataset.do));
    el.querySelectorAll('[data-person]').forEach(b => b.onclick = () => tool('person:' + b.dataset.person, ym));
    const rm = el.querySelector('#adRemind');
    if (rm) rm.onclick = () => withBusy(rm, async () => {
      const n = await A.api.rpc('admin_remind_submission', { p_admin_id: me().id, p_ym: ym });
      if (n === false) return;
      A.api.notify({ event: 'remind_submission', ym });   // 이 버튼은 v2 DB 가 있을 때만 보여요
      A.toast(`아직 안 낸 ${typeof n === 'number' ? n : missing}명에게 알림을 보냈어요`);
    });
  }

  // ── 2. 야간 문항 ──
  const nightLabel = (wp, ds, h) => { const d = A.parse(ds); return `${d.getMonth() + 1}/${d.getDate()}(${A.DAYS[d.getDay()]}) ${wp} 야간${h ? ' ' + h : ''}`; };   // 운영 1405
  const addNightQ = (ym, wp, ds, h, quiet) => A.api.rpc('admin_add_night_q',
    { p_admin_id: me().id, p_ym: ym, p_workplace: wp, p_work_date: ds, p_hours: h || null, p_label: nightLabel(wp, ds, h) }, { quiet });
  function nightsSec(nights, answers) {
    const byq = {};
    answers.forEach(a => { if (String(a.qkey || '').startsWith('n:')) (byq[a.qkey.slice(2)] = byq[a.qkey.slice(2)] || []).push(a); });
    const rows = nights.map(n => {
      const r = byq[String(n.id)] || [], yes = r.filter(x => x.choice === '가능').map(x => x.staffName), no = r.filter(x => x.choice === '불가능').length;
      const title = n.date ? A.fmt(n.date) : esc(n.label);
      return `<div class="lrow ad-q"><span class="lm"><span class="lt">${title}</span><span class="ls">${esc(n.wp || '')} 야간 ${esc(hrs(n.hours))}</span>
        <span class="ls ad-yes">가능 <b>${yes.length}</b>${yes.length ? ' · ' + yes.map(esc).join(', ') : ''} · 불가능 ${no}</span></span>
        <span class="la"><button class="btn sm ghost hit" data-del="${n.id}" aria-label="${title} 야간 문항 빼기">빼기</button></span></div>`;
    }).join('');
    return `<section class="sec ad-sec"><div class="sec-h"><h2>야간 문항</h2><span class="aside">${nights.length}건</span></div>
      ${rows || '<p class="sb-quiet">이 달 야간 문항이 없어요</p>'}
      <div class="ad-sub"><button class="btn lg" id="adNightAdd">야간 문항 추가</button><button class="btn lg" id="adNightSat">토요일 데빌 한 번에</button></div></section>`;
  }
  function bindNights(el, ym, nights) {
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const n = nights.find(x => String(x.id) === b.dataset.del);
      if (!n) return;
      if (!await A.confirm({ title: `${n.date ? A.fmt(n.date) : n.label} 야간 문항을 뺄까요?`, text: '직원들이 이미 고른 답도 함께 지워져요.', ok: '빼기', danger: true })) return;
      if (await A.api.rpc('admin_del_night_q', { p_admin_id: me().id, p_id: Number(n.id) }) === false) return;
      await after('야간 문항을 뺐어요', null);
    });
    el.querySelector('#adNightAdd').onclick = () => openNightAdd(ym);
    el.querySelector('#adNightSat').onclick = async e => {
      const btn = e.currentTarget;
      const taken = new Set(nights.filter(n => n.wp === '데빌').map(n => n.date));
      const sats = daysOf(ym).filter(ds => A.parse(ds).getDay() === 6 && !taken.has(ds));
      if (!sats.length) { A.toast('이 달 토요일 데빌 야간은 모두 있어요'); return; }
      const h = await A.prompt({ title: '토요일 데빌 야간 한 번에 추가', text: `이 달 토요일 ${sats.length}일에 데빌 야간 문항을 넣어요.`, label: '시간', value: NIGHT_DEFAULT, placeholder: `예: ${NIGHT_DEFAULT}`, ok: '넣기' });
      if (h === null) return;
      await withBusy(btn, async () => {
        let cnt = 0, bad = 0;
        for (const ds of sats) { if (await addNightQ(ym, '데빌', ds, h || NIGHT_DEFAULT, true) === false) { bad++; if (!A.session) return; } else cnt++; }
        await after(null, null);
        A.toast(bad ? `${cnt}개 넣고 ${bad}개는 못 넣었어요` : `토요일 데빌 야간 ${cnt}개를 넣었어요`, !!bad);
      });
    };
  }
  function openNightAdd(ym) {
    const days = daysOf(ym), sat = days.find(ds => A.parse(ds).getDay() === 6) || days[0];
    let busy = false;
    A.sheet({
      title: '야간 문항 추가',
      html: `<div class="fld-row"><label class="fld-l">매장<select class="fld" data-wp>${STORES.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
        <label class="fld-l">날짜<input class="fld" type="date" data-ds value="${sat}" min="${days[0]}" max="${days[days.length - 1]}"></label></div>
        <label class="fld-l">시간<input class="fld" data-h value="${NIGHT_DEFAULT}" placeholder="예: ${NIGHT_DEFAULT}" autocomplete="off"></label><p class="sheet-err" hidden></p>`,
      actions: [{ label: '취소' }, { label: '추가', kind: 'primary', onClick: async (close, el) => {
        if (busy) return;
        const wp = el.querySelector('[data-wp]').value, ds = el.querySelector('[data-ds]').value, h = el.querySelector('[data-h]').value.trim(), err = el.querySelector('.sheet-err');
        const bad = !ds ? '날짜를 골라 주세요' : A.ymOf(ds) !== ym ? '이 달 안의 날짜를 골라 주세요' : '';
        if (bad) { err.hidden = false; err.textContent = bad; return; }
        busy = true;
        const r = await addNightQ(ym, wp, ds, h, false);
        busy = false;
        if (r === false) return;
        close();
        await after('야간 문항을 추가했어요', null);
      } }],
    });
  }

  // ── 3. 편성 도구 (32-admin-tools.js) · 짜기는 스케줄 편집으로 (2026-10-28 합침) ──
  // 짜기(바꾸는 것)와 살펴보기(읽기만)를 나누고, 줄마다 무슨 일을 하는지 한 줄로
  function toolsSec(ym) {
    const m = +ym.slice(5), t = k => `data-tool="${k}"`;
    return `<section class="sec ad-sec"><div class="sec-h"><h2>${m}월 출근표 짜기</h2></div><div class="menu-list">
      ${mrow('id="adEdit"', '스케줄에서 짜기', '날짜마다 희망한 사람이 보여요. 이름을 누르면 바로 들어가요')}
      ${mrow(t('builder'), '표로 한 번에 짜기', '사람 × 날짜 표에서 칸마다 매장을 골라요. 큰 화면에서 쓰기 좋아요')}</div></section>
    <section class="sec ad-sec"><div class="sec-h"><h2>${m}월 살펴보기</h2><span class="aside">보기만 해요</span></div><div class="menu-list">
      ${mrow(t('matrix'), '제출 표', '직원들이 낸 희망을 사람 × 날짜 표로 봐요')}
      ${mrow(t('hopecal'), '매장별 희망 달력', '매장마다 날짜별로 누가 오고 싶어 하는지 봐요')}
      ${mrow(t('counts'), '근무일수', '사람마다 이 달에 몇 번 일하는지 봐요 (야간 포함)')}
      ${mrow(t('nights'), '데빌 야간 목록', '야간이 있는 날과 멤버를 한눈에 봐요')}</div></section>
    <section class="sec ad-sec"><div class="sec-h"><h2>인스타 올리기</h2></div><div class="menu-list">
      ${mrow('id="adExport"', '출근표 이미지', '2주 · 1주 · 1일')}</div></section>`;
  }
  function bindTools(el, ym, staff) {
    el.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => tool(b.dataset.tool, ym));
    el.querySelector('#adExport').onclick = () => { if (A.exportImg && A.exportImg.open) A.exportImg.open(); else A.toast('준비 중이에요'); };
    el.querySelector('#adEdit').onclick = () => {
      const t = A.today();
      A.state.edit = true;
      A.go('schedule', { view: 'day', date: A.ymOf(t) === ym ? t : ym + '-01' });
    };
  }

  // ── 4. 직원: 확인할 사람 먼저, 처음엔 8명만, 초성으로도 찾기 ──
  const cho = A.cho;
  // 확인 필요 = 잠김, PIN 없음 (admin_staff_directory 의 locked / has_pin). 임시 PIN 은 대부분이라 빼요 (사용자 2026-10-28)
  const need = s => !!(s.locked || s.has_pin === false);
  const FILTERS = [['all', '전체', () => true], ['need', '확인 필요', need], ['admin', '관리자', s => !!s.is_admin]];
  const stTags = s => [s.is_admin ? '<span class="tag">관리자</span>' : '', s.locked ? '<span class="tag red">잠김</span>' : '',
    s.has_pin === false ? '<span class="tag soft">PIN 없음</span>' : ''].join('');

  function staffSec(staff) {
    return `<section class="sec ad-sec" id="adStaffSec"><div class="sec-h"><h2>직원 ${staff.length}명</h2><button class="btn sm ad-addb" id="adStaffAdd">${I.plus}직원 추가</button></div>
      <input class="fld" id="adQ" type="search" placeholder="이름 찾기 (초성도 돼요)" aria-label="직원 이름 찾기" autocomplete="off" value="${esc(query)}">
      <div class="seg ad-filt" role="group" aria-label="직원 거르기" id="adFilt"></div>
      <p class="ad-found" id="adFound" aria-live="polite"></p>
      <div id="adStaff"></div>
      <div class="menu-list ad-links"><button class="menu-row" id="adBulkPin">PIN 없는 직원에게 임시 PIN 정하기${staff.some(s => s.has_pin === false) ? `<small>${staff.filter(s => s.has_pin === false).length}명</small>` : I.chev}</button></div></section>`;
  }
  function staffFilters(el, staff) {
    const cnt = k => staff.filter(FILTERS.find(f => f[0] === k)[2]).length;
    if (filt !== 'all' && !cnt(filt)) filt = 'all';
    const box = el.querySelector('#adFilt');
    box.innerHTML = FILTERS.filter(([k]) => k === 'all' || cnt(k)).map(([k, l]) => `<button type="button" data-f="${k}" class="${filt === k ? 'on' : ''}" aria-pressed="${filt === k}">${l} <b>${cnt(k)}</b></button>`).join('');
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filt = b.dataset.f; expanded = false; staffFilters(el, staff); staffRows(el, staff); });
  }
  function staffRows(el, staff) {
    const box = el.querySelector('#adStaff');
    const q = query.trim(), qc = cho(q), f = FILTERS.find(x => x[0] === filt)[2];
    const list = staff.filter(s => f(s) && (!q || String(s.name).includes(q) || cho(s.name).includes(qc)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));   // 이름순만 (사용자 2026-10-28)
    const cut = !q && filt === 'all' && list.length > SHOW + 2, shown = cut && !expanded ? list.slice(0, SHOW) : list;
    el.querySelector('#adFound').textContent = q ? `${list.length}명 찾았어요` : '';
    box.innerHTML = shown.map(s => `<div class="lrow ad-st"><button class="ad-main" data-st="${s.id}" aria-label="${esc(s.name)}님 관리">${A.avatar(s)}<span class="lt">${esc(s.name)}</span>${stTags(s)}</button>${s.locked ? `<button class="btn sm hit" data-unlock="${s.id}" aria-label="${esc(s.name)}님 잠금 풀기">잠금 풀기</button>` : ''}${I.chev}</div>`).join('')
      + (cut ? `<button class="btn ad-more" id="adMore" aria-expanded="${expanded}">${expanded ? '접기' : `나머지 ${list.length - SHOW}명 보기`}</button>` : '')
      || '<div class="none">찾는 이름이 없어요</div>';
    const more = box.querySelector('#adMore');
    if (more) more.onclick = () => { expanded = !expanded; staffRows(el, staff); if (!expanded) el.querySelector('#adQ').scrollIntoView({ block: 'center' }); };
    box.querySelectorAll('[data-st]').forEach(b => b.onclick = () => openStaff(staff.find(x => String(x.id) === b.dataset.st), staff));
    box.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => unlock(staff.find(x => String(x.id) === b.dataset.unlock)));
  }
  function bindStaff(el, staff) {
    staffFilters(el, staff); staffRows(el, staff);
    el.querySelector('#adQ').oninput = e => { query = e.target.value; staffRows(el, staff); };
    el.querySelector('#adStaffAdd').onclick = () => openStaffAdd(staff);
    el.querySelector('#adBulkPin').onclick = bulkPin;
  }

  const pinCheck = v => /^\d{6}$/.test(v) ? '' : 'PIN은 숫자 6자리예요';
  async function unlock(s) {
    if (!s) return;
    if (!await A.confirm({ title: `${s.name}님의 잠금을 풀까요?`, text: 'PIN을 여러 번 틀려서 잠겼어요. 풀면 바로 다시 로그인할 수 있어요.', ok: '잠금 풀기' })) return;
    if (await A.api.rpc('admin_unlock_staff', { p_admin_id: me().id, p_target_id: Number(s.id) }) === false) return;
    await after(`${s.name}님의 잠금을 풀었어요`, null);
  }
  function openStaff(s, staff) {
    if (!s) return;
    const self = me() && s.id === me().id, admin = !!s.is_admin, v2 = !!(A.features && A.features.v2db);
    const head = `<div class="me-card">${A.avatar(s, 'me-av lg')}<div><b>${esc(s.name)}</b><span class="ad-tags">${stTags(s) || '<span class="tag soft">직원</span>'}</span></div></div>`;
    const row = (k, t, d) => mrow(`data-act="${k}"`, t, d), noPin = s.has_pin === false;
    // PIN 은 한 줄만: v2 DB 가 있으면 임시 PIN(본인이 다음 로그인 때 바꿈), 없으면 관리자가 직접 정하기
    const pinRow = v2 ? row('temp', noPin ? 'PIN 만들기' : 'PIN 초기화', noPin ? '임시 PIN을 만들어 알려 주면 로그인할 수 있어요' : 'PIN을 잊었을 때 임시 PIN을 만들어 알려 줘요. 다음 로그인 때 본인이 새로 정해요')
      : row('pin', noPin ? 'PIN 만들기' : 'PIN 다시 정하기', 'PIN을 잊었을 때 새 PIN을 정해 알려 줘요');
    const body = `<div class="menu-list">${row('person', `${admYM ? +admYM.slice(5) + '월 ' : ''}제출 내용`, '날짜마다 고른 매장을 봐요')}
      ${s.locked ? row('unlock', '잠금 풀기', 'PIN을 여러 번 틀려 잠겼어요. 풀면 다시 로그인할 수 있어요') : ''}
      ${self ? '' : pinRow}
      ${row('rename', '이름 바꾸기', '출근표와 목록에 보이는 이름이에요')}${row('ig', '인스타그램', '출근표 이름 옆 링크로 보여요')}
      ${self ? '' : row('role', admin ? '직원으로 바꾸기' : '관리자로 바꾸기', admin ? '관리 탭과 출근표 편집을 더는 못 써요' : '관리 탭과 출근표 편집을 쓸 수 있게 돼요')}</div>
      ${self ? '<p class="sheet-p">내 권한과 PIN은 여기서 바꾸지 않아요. 위쪽 내 정보에서 PIN을 바꿀 수 있어요.</p>' : s.has_pin === false ? '<p class="sheet-p">아직 PIN이 없어서 로그인할 수 없어요. PIN을 정해 주세요.</p>' : ''}`;
    const sh = A.sheet({
      title: `${s.name}님`, html: head + body,
      actions: self ? [] : [{ label: '직원 삭제', kind: 'danger', onClick: c => { c(); del(s); } }],
      onOpen: (el, close) => el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => { close(); act(b.dataset.act, s, staff); }),
    });
    return sh;
  }
  async function act(k, s, staff) {
    const sid = Number(s.id), aid = me().id;
    if (k === 'person') { tool('person:' + s.id, admYM); return; }
    if (k === 'unlock') { unlock(s); return; }
    if (k === 'rename') {
      const nm = await A.prompt({ title: '이름 바꾸기', label: '새 이름', value: s.name, maxlength: 30,
        validate: v => !v ? '이름을 적어 주세요' : v !== s.name && staff.some(x => x.name === v) ? '이미 있는 이름이에요' : '' });
      if (nm === null || nm === s.name) return;
      if (await A.api.rpc('admin_rename_staff', { p_admin_id: aid, p_target_id: sid, p_name: nm }) === false) return;
      if (s.id === aid) A.auth.update({ name: nm });
      await after('이름을 바꿨어요');
    } else if (k === 'ig') {
      const ig = await A.prompt({ title: `${s.name}님 인스타그램`, label: '아이디 또는 링크 (지우려면 비워 둬요)', maxlength: 100, placeholder: '예: hana_moe' });
      if (ig === null) return;
      if (await A.api.rpc('admin_set_instagram', { p_admin_id: aid, p_target_id: sid, p_insta: ig }) === false) return;
      await after(ig ? '인스타그램을 저장했어요' : '인스타그램을 지웠어요');
    } else if (k === 'role') {
      const to = s.is_admin ? '직원으로' : '관리자로';
      if (!await A.confirm({ title: `${s.name}님을 ${to} 바꿀까요?`, text: s.is_admin ? '관리 화면과 출근표 편집을 더는 쓸 수 없어요.' : '관리 화면과 출근표 편집을 쓸 수 있어요.', ok: '바꾸기' })) return;
      if (await A.api.rpc('admin_set_role', { p_admin_id: aid, p_target_id: sid, p_is_admin: !s.is_admin }) === false) return;
      await after(`${s.name}님을 ${to} 바꿨어요`, null);
    } else if (k === 'pin') {
      const np = await A.prompt({ title: `${s.name}님 PIN 정하기`, text: '새 PIN을 정하면 그 사람의 기기에서 모두 로그아웃돼요.', label: '새 PIN (숫자 6자리)', inputmode: 'numeric', maxlength: 6, validate: pinCheck, ok: '정하기' });
      if (np === null) return;
      if (await A.api.rpc('admin_set_pin', { p_admin_id: aid, p_target_id: sid, p_new_pin: np }) === false) return;
      await after('PIN을 정했어요', null);
    } else if (k === 'temp') {
      if (!await A.confirm({ title: `${s.name}님의 임시 PIN을 만들까요?`, text: '지금 PIN은 못 쓰게 돼요. 다음 로그인 때 새 PIN으로 바꾸게 해요.', ok: '만들기' })) return;
      const pin = await A.api.rpc('admin_reset_pin', { p_admin_id: aid, p_target_id: sid });
      if (pin === false) return;
      await after(null, null);
      // 한 번만 보여 줘요. 어디에도 남기지 않아요
      A.sheet({ title: '임시 PIN', html: `<p class="sheet-p">${esc(s.name)}님에게 알려 주세요. 이 창을 닫으면 다시 볼 수 없어요.</p><div class="ad-pin">${esc(String(pin))}</div>`,
        actions: [{ label: '확인했어요', kind: 'primary' }] });
    }
  }
  async function del(s) {
    if (!await A.confirm({ title: `${s.name}님을 삭제할까요?`, text: '배정된 근무는 빈 자리가 돼요. 되돌릴 수 없어요.', ok: '삭제', danger: true })) return;
    if (await A.api.rpc('admin_delete_staff', { p_admin_id: me().id, p_target_id: Number(s.id) }) === false) return;
    await after(`${s.name}님을 삭제했어요`);
  }
  function openStaffAdd(staff) {
    let admin = false, busy = false;
    A.sheet({
      title: '직원 추가',
      html: `<label class="fld-l">이름<input class="fld" data-nm maxlength="30" autocomplete="off" placeholder="예: 하나"></label>
        <label class="fld-l">PIN (숫자 6자리, 없으면 비워 둬요)<input class="fld" data-pin inputmode="numeric" maxlength="6" autocomplete="off" placeholder="숫자 6자리"></label>
        <div class="seg" role="group" aria-label="권한"><button type="button" class="on" data-r="0" aria-pressed="true">직원</button><button type="button" data-r="1" aria-pressed="false">관리자</button></div>
        <p class="sheet-note">PIN 없이 추가하면 로그인할 수 없어요. 나중에 PIN을 정해 주세요.</p><p class="sheet-err" hidden></p>`,
      onOpen: el => {
        el.querySelector('[data-nm]').focus();
        el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
          admin = b.dataset.r === '1';
          el.querySelectorAll('[data-r]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        });
      },
      actions: [{ label: '취소' }, { label: '추가', kind: 'primary', onClick: async (close, el) => {
        if (busy) return;
        const name = el.querySelector('[data-nm]').value.trim(), pin = el.querySelector('[data-pin]').value.trim(), err = el.querySelector('.sheet-err');
        const bad = !name ? '이름을 적어 주세요' : staff.some(x => x.name === name) ? '이미 있는 이름이에요' : pin && pinCheck(pin) ? pinCheck(pin) : '';
        if (bad) { err.hidden = false; err.textContent = bad; return; }
        busy = true;
        const r = await A.api.rpc('admin_add_staff', { p_admin_id: me().id, p_name: name, p_new_pin: pin, p_is_admin: admin });
        busy = false;
        if (r === false) return;
        query = ''; close();
        await after(`${name}님을 추가했어요`, null);
      } }],
    });
  }
  async function bulkPin() {
    const np = await A.prompt({ title: '임시 PIN 한 번에 정하기', text: 'PIN이 없는 직원에게 같은 임시 PIN을 정해요. 다음 로그인 때 자기 PIN으로 바꾸게 해요.', label: '임시 PIN (숫자 6자리)', inputmode: 'numeric', maxlength: 6, validate: pinCheck, ok: '정하기' });
    if (np === null) return;
    const n = await A.api.rpc('admin_set_default_pin', { p_admin_id: me().id, p_new_pin: np });
    if (n === false) return;
    await after(`임시 PIN을 ${typeof n === 'number' ? n : 0}명에게 정했어요`, null);
  }

  A.screen('admin', {
    async render(el) {
      el.dataset.theme = 'all';
      if (!A.isAdmin()) { el.innerHTML = A.emptyBox('lock', '관리자만 볼 수 있어요'); return; }
      if (!admYM) admYM = nextYM();
      const ym = admYM;
      const [, staff, nights, answers, hasV2] = await Promise.all([
        A.store.loadStatus(), A.store.directory({ fresh: true }), A.store.nightQuestions(ym), A.store.answers(ym), v2db(),
      ]);
      const st = A.store.status(ym);
      const done = new Set(answers.map(a => a.staffId));
      el.innerHTML = `${A.pageHead('관리', '제출, 야간 문항, 직원을 한곳에서 관리해요')}
        <div class="datebar sb-mbar"><button class="nav" data-m="-1" aria-label="이전 달">${I.prev}</button><div class="dlabel">${ymLabel(ym)}</div><button class="nav" data-m="1" aria-label="다음 달">${I.next}</button></div>
        ${scheduleSec(ym, st, staff, answers, hasV2)}${nightsSec(nights, answers)}${toolsSec(ym)}${staffSec(staff)}`;
      el.querySelectorAll('.sb-mbar [data-m]').forEach(b => b.onclick = () => { admYM = A.ymShift(admYM, +b.dataset.m); A.render(); });
      bindSchedule(el, ym, staff.filter(s => !done.has(s.id)).length);
      bindNights(el, ym, nights);
      bindTools(el, ym, staff);
      bindStaff(el, staff);
    },
  });
}
