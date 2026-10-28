// 시프트 제출 (운영 staff.html 1355-1401): 달 고르기, 날짜마다 한 번 눌러 고르기 + 야간 가능/불가, 낸 뒤 요약과 고치기
// 날은 그 달 모든 날. 안 고른 날은 보내지 않아요 (빈칸으로 남음). 야간은 비워 둬도 돼요.
{
  const A = window.App;
  const esc = A.esc;
  const STORES = A.FLOORS.map(f => f[0]);          // 데빌 → 메이드 → 마츠리
  const ANY = '상관없음', NO = '출근불가능';
  const N_OK = '가능', N_NO = '불가능';              // DB 값 (화면 글자는 가능 / 불가)
  let subYM = null;                                  // 고른 달 (처음엔 가장 이른 제출 달, 없으면 다음 달)
  const picks = {};                                  // '직원id|ym' → {qkey: choice} (다시 그려도 고른 값 유지)
  const editing = {};                                // '직원id|ym' → 고치기를 눌렀음
  let busy = false;

  const nextYM = () => A.ymShift(A.ymOf(A.today()), 1);
  const ymLabel = ym => { const [y, m] = ym.split('-').map(Number); return `${y}년 ${m}월`; };
  const monOf = ym => +ym.slice(5);
  const hrs = h => String(h || '').replace('-', '~');
  const cls = ds => { const d = A.parse(ds).getDay(); return d === 0 ? ' sun' : d === 6 ? ' sat' : ''; };
  const monthDates = ym => {
    const [y, m] = ym.split('-').map(Number), out = [];
    for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) out.push(A.ymd(d));
    return out;
  };
  const dateLbl = ds => `<span class="sb-date${cls(ds)}" aria-hidden="true"><b>${+ds.slice(8)}</b><small>${A.DAYS[A.parse(ds).getDay()]}</small></span>`;

  function monthBar(ym) {
    return `<div class="datebar sb-mbar"><button class="nav" data-m="-1" aria-label="이전 달">${A.ICON.prev}</button><div class="dlabel">${ymLabel(ym)}</div><button class="nav" data-m="1" aria-label="다음 달">${A.ICON.next}</button></div>`;
  }
  function bindMonthBar(el) {
    el.querySelectorAll('.sb-mbar [data-m]').forEach(b => b.onclick = () => { subYM = A.ymShift(subYM, +b.dataset.m); A.render(); });
  }

  function choiceBtn(ds, v, cur) {
    const on = cur === v, label = A.fmt(ds);
    if (STORES.includes(v)) {
      const t = A.THEMES[v];
      return `<button class="sb-c" data-d="${ds}" data-c="${v}" aria-pressed="${on}" aria-label="${label} ${A.storeName(v)}" style="--c:${t.c};--cs:${t.cs};--ci:${t.ci}"><img src="${A.logo(v)}" alt=""><span>${v}</span></button>`;
    }
    const any = v === ANY;
    return `<button class="sb-c ${any ? 'any' : 'no'}" data-d="${ds}" data-c="${v}" aria-pressed="${on}" aria-label="${label} ${any ? ANY : '출근 불가'}"><span>${any ? ANY : '불가'}</span></button>`;
  }
  function nightRow(n, cur) {
    const ans = v => `<button class="sb-c ${v === N_OK ? 'any' : 'no'}" data-n="${n.id}" data-a="${v}" aria-pressed="${cur === v}" aria-label="${n.date ? A.fmt(n.date) : esc(n.label)} 야간 ${v === N_OK ? '가능' : '불가'}"><span>${v === N_OK ? '가능' : '불가'}</span></button>`;
    const head = n.date && n.wp
      ? `${dateLbl(n.date)}<div class="sb-nm"><img src="${A.logo(n.wp)}" alt=""><span><b>${esc(n.wp)} 야간</b><small>${esc(hrs(n.hours))}</small></span></div>`
      : `<div class="sb-nm"><span><b>${esc(n.label || '야간')}</b></span></div>`;
    return `<div class="sb-row sb-n" role="group" aria-label="${n.date ? A.fmt(n.date) : esc(n.label)} 야간">${head}<div class="sb-ans">${ans(N_OK)}${ans(N_NO)}</div></div>`;
  }

  function renderForm(el, ym, dates, nights, map, key) {
    const m = monOf(ym);
    const rows = dates.map(ds => `<div class="sb-row sb-d" role="group" aria-label="${A.fmt(ds)}">${dateLbl(ds)}<div class="sb-cs">${[...STORES, ANY, NO].map(v => choiceBtn(ds, v, map['d:' + ds])).join('')}</div></div>`).join('');
    el.innerHTML = `${A.pageHead(`${m}월 시프트 제출`, '날짜마다 하나씩 골라 주세요. 마감 전까지 고칠 수 있어요')}${monthBar(ym)}
      <div class="sb-stat"><span class="tag green">제출 받는 중</span><b data-s="cnt"></b></div>
      <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${dates.length}" aria-label="고른 날"><i></i></div>
      <section class="sec sb-sec"><div class="sec-h"><h2>날짜별 근무지</h2></div>${rows}</section>
      ${nights.length ? `<section class="sec sb-sec"><div class="sec-h"><h2>야간 근무</h2><span class="aside" data-s="night"></span></div>
        <p class="sb-quiet">야간은 안 골라도 돼요</p>${nights.map(n => nightRow(n, map['n:' + n.id])).join('')}</section>` : ''}
      <div class="cta"><button class="btn lg primary" id="sbGo">제출하기</button><p class="note" data-s="left" hidden></p></div>`;

    const stats = () => {
      const done = dates.filter(d => map['d:' + d]).length, left = dates.length - done;
      el.querySelector('[data-s="cnt"]').textContent = `${done}/${dates.length}일 골랐어요`;
      const bar = el.querySelector('.prog');
      bar.setAttribute('aria-valuenow', String(done));
      bar.querySelector('i').style.width = `${Math.round(done / dates.length * 100)}%`;
      const note = el.querySelector('[data-s="left"]');
      note.hidden = !left; note.textContent = left ? `고를 날이 ${left}일 남았어요` : '';
      const na = el.querySelector('[data-s="night"]');
      if (na) na.textContent = `${nights.filter(n => map['n:' + n.id]).length}/${nights.length}건`;
    };
    stats();
    // 누르면 그 줄만 바꿔요 (다시 누르면 지워져요)
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
      const q = 'd:' + b.dataset.d, v = b.dataset.c;
      if (map[q] === v) delete map[q]; else map[q] = v;
      b.closest('.sb-cs').querySelectorAll('[data-c]').forEach(x => x.setAttribute('aria-pressed', String(map[q] === x.dataset.c)));
      stats();
    });
    el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      const q = 'n:' + b.dataset.n, v = b.dataset.a;
      if (map[q] === v) delete map[q]; else map[q] = v;
      b.closest('.sb-ans').querySelectorAll('[data-a]').forEach(x => x.setAttribute('aria-pressed', String(map[q] === x.dataset.a)));
      stats();
    });
    el.querySelector('#sbGo').onclick = e => submit(e.currentTarget, ym, dates, nights, map, key);
    bindMonthBar(el);
  }

  async function submit(btn, ym, dates, nights, map, key) {
    if (busy) return;
    const s = A.session;
    if (!s) { A.auth.openLogin(); return; }
    const un = dates.filter(d => !map['d:' + d]).length;
    if (un && !await A.confirm({ title: `안 고른 ${un}일은 비워 두고 낼까요?`, text: '고르지 않은 날은 빈칸으로 남아요. 낸 뒤에도 마감 전까지는 고칠 수 있어요.', ok: '이대로 내기', cancel: '더 고르기' })) return;
    // 고른 것만 보내요 (이 달 날짜와 지금 있는 야간 문항만)
    const keys = [...dates.map(d => 'd:' + d), ...nights.map(n => 'n:' + n.id)];
    const answers = keys.filter(q => map[q]).map(q => ({ qkey: q, choice: map[q] }));
    busy = true; btn.setAttribute('aria-busy', 'true');
    const r = await A.api.rpc('submit_shift', { p_staff_id: s.id, p_ym: ym, p_answers: answers });
    busy = false; btn.removeAttribute('aria-busy');
    if (r === false) return;
    delete editing[key]; delete picks[key];
    await A.render({ keep: true });
    A.toast(`${monOf(ym)}월 시프트를 냈어요`);
  }

  function renderDone(el, ym, dates, nights, saved, key) {
    const m = monOf(ym);
    const cnt = v => dates.filter(d => saved['d:' + d] === v).length;
    const done = dates.filter(d => saved['d:' + d]).length, blank = dates.length - done;
    const row = (inner, n, unit = '일') => `<div class="lrow sb-sum"><span class="lm"><span class="lt">${inner}</span></span><span class="la"><b>${n}${unit}</b></span></div>`;
    const sums = STORES.map(wp => row(`<img class="sb-lg" src="${A.logo(wp)}" alt="">${esc(A.storeName(wp))}`, cnt(wp))).join('')
      + row(ANY, cnt(ANY)) + row('출근 불가', cnt(NO)) + (blank ? row('비워 둔 날', blank) : '');
    const nOk = nights.filter(n => saved['n:' + n.id] === N_OK).length, nNo = nights.filter(n => saved['n:' + n.id] === N_NO).length, nNone = nights.length - nOk - nNo;
    el.innerHTML = `${A.pageHead(`${m}월 시프트를 냈어요`, '마감 전까지는 언제든 고칠 수 있어요')}${monthBar(ym)}
      <div class="sb-stat"><span class="tag green">제출 받는 중</span><b>${done}/${dates.length}일을 냈어요</b></div>
      <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${dates.length}" aria-valuenow="${done}" aria-label="낸 날"><i style="width:${Math.round(done / dates.length * 100)}%"></i></div>
      <section class="sec sb-sec"><div class="sec-h"><h2>낸 내용</h2></div>${sums}</section>
      ${nights.length ? `<section class="sec sb-sec"><div class="sec-h"><h2>야간 근무</h2></div>
        ${row('가능', nOk, '건')}${row('불가', nNo, '건')}${nNone ? row('안 정함', nNone, '건') : ''}</section>` : ''}
      <div class="cta"><button class="btn lg" id="sbEdit">고치기</button></div>`;
    el.querySelector('#sbEdit').onclick = () => {
      editing[key] = true; picks[key] = { ...saved };
      A.render({ keep: true });
      A.toast('다시 고를 수 있어요. 다 고치면 제출하기를 눌러 주세요');
    };
    bindMonthBar(el);
  }

  A.screen('submit', {
    async render(el) {
      el.dataset.theme = 'all';
      const s = A.session;
      if (!s) {
        el.innerHTML = `${A.pageHead('시프트 제출')}${A.emptyBox('submit', '로그인하면 시프트를 낼 수 있어요', '이름과 PIN으로 로그인해 주세요')}
          <button class="btn lg primary" id="sbLogin">로그인하기</button>`;
        el.querySelector('#sbLogin').onclick = () => A.auth.openLogin();
        return;
      }
      await A.store.loadStatus();
      const open = A.store.openMonths();
      if (!subYM) subYM = open[0] || nextYM();
      const ym = subYM;
      if (!open.includes(ym)) {
        const hint = open.length ? `제출 받는 달: ${open.map(ymLabel).join(', ')}` : '아직 관리자가 제출을 열지 않았어요';
        el.innerHTML = `${A.pageHead(`${monOf(ym)}월 시프트 제출`)}${monthBar(ym)}${A.emptyBox('lock', '이 달은 제출 기간이 아니에요', hint)}
          ${open.length ? `<div class="sb-jump">${open.map(x => `<button class="btn" data-ym="${x}">${ymLabel(x)} 내러 가기</button>`).join('')}</div>` : ''}`;
        el.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { subYM = b.dataset.ym; A.render(); });
        bindMonthBar(el);
        return;
      }
      const [nights, saved] = await Promise.all([A.store.nightQuestions(ym), A.store.submission(ym)]);
      const dates = monthDates(ym), key = `${s.id}|${ym}`;
      if (Object.keys(saved).length && !editing[key]) { renderDone(el, ym, dates, nights, saved, key); return; }
      const map = picks[key] || (picks[key] = { ...saved });
      renderForm(el, ym, dates, nights, map, key);
    },
  });
}
