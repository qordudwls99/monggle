// 내 근무 (운영 staff.html 2414-2458): 오늘부터, 공개된 달만, 야간 포함. 오늘 카드(같이 일하는 사람) + 달별 목록,
// 근무 시트에서 출근표 보기 · 대타 구하기(A.swap.request) · 대타 글 내리기(cancel_sub). 로그아웃이면 로그인 안내
{
  const A = window.App;
  const esc = A.esc;
  const me = () => A.session;
  const where = (ds, wp) => `${A.fmt(ds)} ${A.storeName(wp)}`;
  const floorIdx = wp => { const i = A.FLOORS.findIndex(f => f[0] === wp); return i < 0 ? 9 : i; };
  // 대타 마감(근무일 16:00)까지 남은 시간 (20-swap.js 와 같은 계산)
  const remain = ds => {
    const diff = new Date(ds + 'T16:00:00') - Date.now();
    if (diff <= 0) return '';
    const mins = Math.floor(diff / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return d > 0 ? `${d}일 ${h}시간` : h > 0 ? `${h}시간 ${m}분` : `${m}분`;
  };
  const seeking = e => !!(e.shift && e.shift.status === 'seeking_sub');
  const swapTag = e => seeking(e) ? '<span class="tag red">대타 구하는 중</span>' : '';
  const nightTag = e => e.night ? '<span class="tag">야간</span>' : '';

  // 주간 근무(Shift) 한 건 = 한 줄. 같은 날·매장 야간(Night)은 그 줄에 붙이고, 야간만 있으면 따로 한 줄
  function entriesOf(items) {
    const out = [], byKey = new Map();
    items.filter(x => !x.night).forEach(x => {
      const e = { date: x.date, wp: x.wp, shift: x, night: null };
      out.push(e);
      const k = x.date + '|' + x.wp; if (!byKey.has(k)) byKey.set(k, e);
    });
    items.filter(x => x.night).forEach(x => {
      const k = x.date + '|' + x.wp, e = byKey.get(k);
      if (e && !e.night) e.night = x;
      else { const n = { date: x.date, wp: x.wp, shift: null, night: x }; out.push(n); if (!e) byKey.set(k, n); }
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (floorIdx(a.wp) - floorIdx(b.wp)) || ((a.shift ? 0 : 1) - (b.shift ? 0 : 1)));
  }

  // 그날 출근표 (ensure 뒤 바로 읽기). 실패하면 null
  async function dayOf(e) {
    try { await A.store.ensure(e.date, e.date); return A.store.day(e.date, e.wp); } catch (err) { return null; }
  }
  function whatText(e) {
    const t = [];
    if (e.shift) t.push('주간' + (e.shift.start ? ` ${e.shift.start}${e.shift.end ? '~' + e.shift.end : ''}` : ''));
    if (e.night) t.push('야간');
    return t.join(' + ');
  }
  // 야간 시간은 night_view.hours 글자 그대로
  // 내가 직접 넣은 야간 시간(start~end)이 있으면 그걸 먼저 보여줘요
  const ownTime = x => x && (x.start || x.end) ? `${x.start || ''}~${x.end || ''}` : '';
  const hoursHtml = (e, d) => {
    const t = e.night && (ownTime(e.night) || (d && d.night && d.night.hours));
    return t ? `<div class="mn-hours">${esc(t)}</div>` : '';
  };
  function withHtml(e, d) {
    if (!d) return '';
    const myId = me() && me().id;
    const day = d.shifts.filter(x => x.staffId !== myId).map(x => x.name);
    const night = d.night ? d.night.members.filter(x => !x.short && x.staffId !== myId).map(x => x.name) : [];
    const line = (k, l) => l.length ? `<div class="mn-with"><span>${k}</span>${esc(l.join(', '))}</div>` : '';
    return line(e.night ? '주간' : '같이 일해요', day) + (e.night ? line('야간', night) : '')
      || `<div class="mn-with"><span>같이 일해요</span>아직 정해진 사람이 없어요</div>`;
  }
  function todayCard(e, d, i) {
    const act = e.shift
      ? (seeking(e) ? `<button class="btn danger" data-t-cancel="${i}">대타 글 내리기</button>` : remain(e.date) ? `<button class="btn" data-t-seek="${i}">대타 구하기</button>` : '')
      : '';
    return `<div class="box mn-today" data-theme="${A.themeKey(e.wp)}">
        <div class="mn-t-top">${A.storeTag(e.wp)}${nightTag(e)}${swapTag(e)}</div>
        <div class="mn-t-date">${esc(A.fmt(e.date))}</div>
        <div class="mn-t-what">${esc(whatText(e))}</div>
        ${hoursHtml(e, d)}
        ${withHtml(e, d)}
        <div class="mn-t-acts"><button class="btn" data-t-day="${i}">출근표 보기</button>${act}</div>
      </div>`;
  }
  function rowHtml(e, i) {
    const d = A.parse(e.date), dow = d.getDay();
    return `<button class="lrow mn-row" data-i="${i}"><span class="mn-d"><b>${d.getMonth() + 1}/${d.getDate()}</b><small class="${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${A.DAYS[dow]}</small></span>
      <span class="lm"><span class="mn-line">${A.storeTag(e.wp)}${nightTag(e)}${swapTag(e)}</span></span>${A.ICON.chev}</button>`;
  }

  A.screen('mine', {
    async render(el) {
      if (!me()) {
        el.innerHTML = A.pageHead('내 근무', '로그인하면 다가오는 내 근무를 볼 수 있어요')
          + A.emptyBox('mine', '로그인이 필요해요', '이름과 PIN으로 로그인해 주세요')
          + '<button class="btn lg primary mn-login" data-login>로그인하기</button>';
        el.querySelector('[data-login]').onclick = () => A.auth.openLogin();
        return;
      }
      const list = entriesOf(await A.store.myShifts());
      let html = A.pageHead('내 근무', `다가오는 근무 ${list.length}개`);
      if (!list.length) { el.innerHTML = html + A.emptyBox('mine', '다가오는 근무가 없어요', '스케줄이 나오면 여기에 보여요'); return; }
      const td = A.today();
      const today = list.filter(e => e.date === td), rest = list.filter(e => e.date !== td);
      if (today.length) {
        const d = await dayOf(today[0]);
        const days = today.map(e => e.wp === today[0].wp ? d : A.store.day(e.date, e.wp));
        html += `<section class="sec"><div class="sec-h"><h2>오늘</h2></div><div class="mn-todays">${today.map((e, i) => todayCard(e, days[i], i)).join('')}</div></section>`;
      }
      const groups = new Map();
      rest.forEach((e, i) => { const k = A.ymOf(e.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([e, i]); });
      groups.forEach((items, ym) => {
        html += `<section class="sec"><div class="sec-h"><h2>${+ym.slice(5)}월</h2><span class="aside">${items.length}번</span></div>${items.map(([e, i]) => rowHtml(e, i)).join('')}</section>`;
      });
      el.innerHTML = html;
      el.querySelectorAll('[data-t-day]').forEach(b => b.onclick = () => { const e = today[+b.dataset.tDay]; A.goDay(e.date, e.wp); });
      el.querySelectorAll('[data-t-seek]').forEach(b => b.onclick = () => seek(today[+b.dataset.tSeek]));
      el.querySelectorAll('[data-t-cancel]').forEach(b => b.onclick = () => withdraw(today[+b.dataset.tCancel]));
      el.querySelectorAll('[data-i]').forEach(b => b.onclick = () => openShift(rest[+b.dataset.i]));
    },
  });

  const seek = e => {
    if (A.swap && A.swap.request) return A.swap.request(e.shift);
    A.toast('대타 구하기는 준비 중이에요');
  };
  // 이 근무의 열린 대타 요청 (운영 2455: swap_view shift_id + open)
  const openReq = async e => (await A.store.swaps({ shiftId: e.shift.id, status: 'open' }))[0] || null;

  async function openShift(e) {
    const [d, sw] = await Promise.all([dayOf(e), seeking(e) ? openReq(e) : null]);
    let info;
    if (!e.shift) info = '야간 근무는 대타 게시판에 올릴 수 없어요. 빠져야 하면 관리자에게 말해 주세요.';
    else if (seeking(e)) { const left = sw && remain(e.date); info = left ? `대타를 구하는 중이에요. 마감까지 ${left} 남았어요.` : '대타를 구하는 중이에요.'; }
    else info = '빠져야 하면 대타를 올려서 대신 들어갈 사람을 찾을 수 있어요.';
    const actions = [{ label: '출근표에서 보기', onClick: c => { c(); A.goDay(e.date, e.wp); } }];
    if (e.shift && !seeking(e) && remain(e.date)) actions.push({ label: '대타 구하기', kind: 'primary', onClick: c => { c(); seek(e); } });
    else if (seeking(e)) actions.push({ label: '대타 글 내리기', kind: 'danger', onClick: c => { c(); withdraw(e, sw); } });
    if (A.shiftTime && e.wp === '데빌' && bizDay() <= e.date) {
      const kinds = [e.shift && 'day', e.night && 'night'].filter(Boolean);
      kinds.forEach((k, n) => actions.splice(1 + n, 0, { label: kinds.length > 1 ? (k === 'day' ? '주간 시간 바꾸기' : '야간 시간 바꾸기') : '시간 바꾸기', onClick: c => { c(); editTime(e, k, d); } }));
    }
    A.sheet({ title: A.fmt(e.date), actions, html: `<div class="mn-sh-top">${A.storeTag(e.wp)}${nightTag(e)}${swapTag(e)}</div>
      <p class="mn-sh-what">${esc(whatText(e))}</p>${hoursHtml(e, d)}${withHtml(e, d)}<p class="sheet-p">${esc(info)}</p>` });
  }

  // 영업일: 한국 시간 06시 전이면 전날 (DB set_my_shift_time 과 같은 기준)
  const bizDay = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

  // 근무 시간 바꾸기 (데빌 주간 shifts / 야간 night_members). 비우면 기본 시간으로 돌아가요
  function editTime(e, kind, d) {
    const x = kind === 'night' ? e.night : e.shift;
    let st = x.start || '', en = x.end || '';
    const own = !!(st || en);
    if (!own && d && d.night && d.night.hours) {
      // "주간 16:00~23:00 · 야간 23:00~익일 05:00" 에서 이 근무 쪽 시간만
      const h = String(d.night.hours), part = (h.match(new RegExp((kind === 'night' ? '야간' : '주간') + '\\s*([^·]+)')) || [])[1] || (/주간|야간/.test(h) ? '' : h);
      const m = part.match(/\b\d{1,2}:\d{2}\b/g) || [];
      const pad = t => t.padStart(5, '0');
      st = m[0] ? pad(m[0]) : ''; en = m[1] ? pad(m[1]) : '';
    }
    let busy = false;
    const send = async (c, a, b, done) => {
      if (busy) return;
      if (!await A.auth.require()) return;
      busy = true;
      const r = await A.api.rpc('set_my_shift_time', { p_staff_id: me().id, p_kind: kind, p_id: x.id, p_start: a, p_end: b });
      busy = false;
      if (r === false) return;
      c();
      A.store.invalidate(e.date, e.date);
      await A.render({ keep: true });
      A.toast(done);
    };
    const actions = [{ label: '저장', kind: 'primary', onClick: (c, w) => {
      const q = n => w.querySelector(`[data-tm="${n}"]`).value;
      const a = q('s'), b = q('e');
      if (!a || !b) { A.toast('출근과 퇴근을 넣어 주세요', true); return; }
      send(c, a, b, '시간을 바꿨어요');
    } }];
    if (own) actions.push({ label: '기본 시간으로', onClick: c => send(c, '', '', '기본 시간으로 돌렸어요') });
    A.sheet({ title: `${A.fmt(e.date)} 시간`, actions, html: `<div class="fld-row"><label class="fld-l">출근<input class="fld" type="time" data-tm="s" value="${esc(st)}"></label><label class="fld-l">퇴근<input class="fld" type="time" data-tm="e" value="${esc(en)}"></label></div>` });
  }

  // 대타 요청 취소: 열린 요청을 찾아 cancel_sub (운영 2452-2457)
  async function withdraw(e, sw) {
    if (!await A.auth.require()) return;
    if (!await A.confirm({ title: '대타 글을 내릴까요?', text: `${where(e.date, e.wp)} 근무는 그대로 내 근무로 남아요.`, ok: '글 내리기', cancel: '그대로 두기', danger: true })) return;
    const req = sw || await openReq(e);
    if (!req) {
      A.store.invalidate(e.date, e.date);
      await A.render({ keep: true });
      A.toast('열린 대타 요청을 찾지 못했어요', true);
      return;
    }
    const r = await A.api.rpc('cancel_sub', { p_staff_id: me().id, p_request_id: req.id });
    if (r === false) return;
    A.store.invalidate(e.date, e.date);
    await A.render({ keep: true });
    A.toast('대타 요청을 취소했어요');
  }
}
