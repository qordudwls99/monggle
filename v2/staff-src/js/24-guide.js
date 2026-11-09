// 처음 쓰는 직원 안내 (2026-11-09 사장님, 시안 .ui-design/proposals-staff/tutorial 2차 3안)
//   화면을 어둡게 하고 한 군데씩 밝혀 짚어 줘요. 자동으로 뜨는 건 두 가지, 기기마다 한 번씩:
//   - 처음 로그인: 내 정보 자리 한 단계 (사용법이 거기 있다고)
//   - 제출 탭 처음 열 때(고르는 화면일 때만): 고르는 칸 → 상관없음·불가 → 제출하기
//   내 정보 › 사용법: 스케줄·제출 짚기 다시 보기, 대타·내 근무·앱 설치는 글로.
//   본 것은 localStorage guide:<직원 id> 에 남겨요 (DB 변경 없음). 시트·알림이 떠 있으면 사라질 때까지 기다려요.
{
  const A = window.App;
  const esc = A.esc;
  const KEY = id => `guide:${id}`;
  const seen = () => { try { return JSON.parse(localStorage.getItem(KEY(A.session.id)) || '[]'); } catch (e) { return []; } };
  const mark = k => { try { const s = seen(); if (!s.includes(k)) { s.push(k); localStorage.setItem(KEY(A.session.id), JSON.stringify(s)); } } catch (e) { /* 기억 못 하면 다음에 한 번 더 떠요 */ } };
  const inScreen = sel => document.querySelector('#screen ' + sel);

  // 단계: el() 이 요소 하나 또는 여러 개(합친 테두리)를 돌려줘요. 없으면 그 단계는 건너뛰어요
  const TOURS = {
    pointer: [{ el: () => document.getElementById('whoBtn'), t: '사용법', d: '쓰는 법은 여기서 다시 볼 수 있어요' }],
    schedule: [
      { el: () => inScreen('.sched-h .seg'), t: '보기', d: '일별·주간·월간·야간을 바꿔요' },
      { el: () => inScreen('.chips'), t: '매장', d: '전체나 매장 하나만 골라 봐요' },
      { el: () => inScreen('.sched-date'), t: '날짜', d: '화살표로 다른 날을 봐요' },
    ],
    submit: [
      { el: () => inScreen('.sb-d'), t: '고르기', d: '날짜마다 하나씩 골라요' },
      { el: () => { const r = inScreen('.sb-d'); return r ? [...r.querySelectorAll('.sb-c.any, .sb-c.no')] : null; }, t: '상관없음 · 불가', d: '어디든 되면 상관없음, 안 되면 불가예요' },
      { el: () => document.getElementById('sbGo'), t: '제출하기', d: '마감 전까지는 다시 고칠 수 있어요' },
    ],
  };
  const SUBMIT_LINES = ['날짜마다 하나씩 골라요', '어디든 되면 상관없음을 골라요', '못 나오는 날은 불가를 골라요', '마감 전까지는 고칠 수 있어요'];
  const TOPICS = [
    ['schedule', '스케줄 보기'],
    ['submit', '근무 제출'],
    ['swap', '대타', ['내 근무에서 대타 구하기를 눌러요', '대타 탭에서 남의 대타에 들어가요']],
    ['mine', '내 근무', ['다가오는 내 근무를 봐요', '근무를 누르면 대타를 구할 수 있어요']],
    ['app', '앱 설치 · 알림', ['아이폰은 사파리 공유 버튼을 눌러요', '홈 화면에 추가를 골라요', '안드로이드는 브라우저 메뉴에서 앱 설치를 눌러요', '설치한 뒤 내 정보에서 푸시 알림을 켜요']],
  ];

  const reduce = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const elsOf = step => {
    let e = step.el(); if (!e) return [];
    if (!Array.isArray(e)) e = [e];
    return e.filter(x => x && document.contains(x) && x.getClientRects().length);
  };

  // ── 짚기 ──
  let cur = null;   // { steps, i, box, back }
  function place() {
    if (!cur) return;
    if (!A.session) { end(); return; }
    const els = elsOf(cur.steps[cur.i]);
    if (!els.length) { if (cur.i < cur.steps.length - 1) { cur.i++; place(); } else end(); return; }   // 화면이 바뀌어 자리가 없어졌어요
    els[0].scrollIntoView({ block: 'nearest' });
    const rs = els.map(e => e.getBoundingClientRect()), P = 6;
    const l = Math.min(...rs.map(r => r.left)) - P, t = Math.min(...rs.map(r => r.top)) - P;
    const w = Math.max(...rs.map(r => r.right)) + P - l, h = Math.max(...rs.map(r => r.bottom)) + P - t;
    const { box } = cur, s = cur.steps[cur.i], n = cur.steps.length, last = cur.i === n - 1;
    const hole = box.querySelector('.coach-hole'), tip = box.querySelector('.coach-tip');
    Object.assign(hole.style, { left: l + 'px', top: t + 'px', width: w + 'px', height: h + 'px', borderRadius: Math.abs(w - h) < 2 ? '50%' : '16px' });
    box.querySelector('.coach-n').textContent = n > 1 ? `${cur.i + 1}/${n}` : '';
    box.querySelector('.coach-t').textContent = s.t;
    box.querySelector('.coach-d').textContent = s.d;
    box.querySelector('[data-next]').textContent = n === 1 ? '확인' : last ? '끝' : '다음';
    box.querySelector('[data-skip]').style.visibility = last ? 'hidden' : '';
    const vw = window.innerWidth, vh = window.innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
    let top = t + h / 2 < vh / 2 ? t + h + 12 : t - 12 - th;
    top = Math.max(12, Math.min(top, vh - th - 12));
    tip.style.top = top + 'px';
    tip.style.left = Math.max(12, Math.min(l + w / 2 - tw / 2, vw - tw - 12)) + 'px';
  }
  function run(key, { auto = false } = {}) {
    if (cur || !A.session) return false;
    const steps = TOURS[key].filter(s => elsOf(s).length);
    if (!steps.length) return false;
    if (auto) mark(key);
    const box = document.createElement('div');
    box.className = 'coach';
    box.innerHTML = `<div class="coach-hole"></div>
      <div class="coach-tip" role="dialog" aria-modal="true" aria-labelledby="coachT" aria-describedby="coachD">
        <p class="coach-n"></p><b class="coach-t" id="coachT"></b><p class="coach-d" id="coachD"></p>
        <div class="coach-a"><button class="btn ghost" data-skip>건너뛰기</button><button class="btn primary" data-next>다음</button></div>
      </div>`;
    document.getElementById('app').appendChild(box);
    cur = { steps, i: 0, box, back: document.activeElement };
    box.querySelector('[data-next]').onclick = () => { if (!cur) return; if (cur.i < cur.steps.length - 1) { cur.i++; place(); } else end(); };
    box.querySelector('[data-skip]').onclick = () => end();
    place();
    if (!cur) return true;
    void box.offsetHeight;
    box.classList.add('in');
    box.querySelector('[data-next]').focus({ preventScroll: true });
    return true;
  }
  function end() {
    if (!cur) return;
    const { box, back } = cur; cur = null;
    box.classList.remove('in');
    if (reduce()) box.remove(); else setTimeout(() => box.remove(), 260);
    if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => { if (cur && e.key === 'Escape' && !document.querySelector('#app > .modal:not(.closing)')) end(); });
  window.addEventListener('resize', () => { if (cur) place(); });

  // ── 자동으로 띄우기: core render 가 화면을 붙일 때마다 after() ──
  let holdUntil = 0, timer = null, tries = 0;
  const busy = () => document.hidden || document.body.classList.contains('gated') || Date.now() < holdUntil
    || !!document.querySelector('#app > .modal:not(.closing)') || document.getElementById('toast').classList.contains('show');
  function want() {
    const s = A.session; if (!s || s.pin_temp) return null;   // 임시 PIN 이면 PIN 바꾸기부터
    const done = seen();
    if (A.state.tab === 'submit' && !done.includes('submit') && document.getElementById('sbGo') && inScreen('.sb-d')) return 'submit';
    if (!done.includes('pointer')) return 'pointer';
    return null;
  }
  function tick() {
    timer = null;
    if (cur || !want()) return;
    if (busy()) { if (++tries < 120) timer = setTimeout(tick, 700); return; }   // 시트·알림이 사라질 때까지 (1분 남짓)
    run(want(), { auto: true });
  }
  function after() {
    if (cur) { place(); return; }
    if (!A.session) return;
    tries = 0; clearTimeout(timer); timer = setTimeout(tick, 600);
  }
  // 메이트유 로그인 뒤 사진 시트처럼 조금 뒤에 뜨는 것이 있을 때 그동안 기다려요 (04-auth.js)
  const hold = ms => { holdUntil = Math.max(holdUntil, Date.now() + ms); };

  // ── 내 정보 › 사용법 ──
  const steps = lines => `<ol class="gd-steps">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>`;
  const textSheet = (title, lines) => A.sheet({ title, html: steps(lines) });
  const closeAll = () => document.querySelectorAll('#app > .modal:not(.closing)').forEach(m => { const x = m.querySelector('[data-x]'); if (x) x.click(); });
  async function play(k) {
    closeAll();
    await (k === 'schedule' ? A.go('schedule', { view: 'day' }) : A.go('submit'));
    setTimeout(() => { if (!run(k) && k === 'submit') textSheet('근무 제출', SUBMIT_LINES); }, 460);   // 이미 냈거나 제출 기간이 아니면 글로
  }
  function open() {
    A.sheet({
      title: '사용법',
      html: `<div class="menu-list">${TOPICS.map(([k, l]) => `<button class="menu-row" data-g="${k}"><span>${esc(l)}</span>${A.ICON.chev}</button>`).join('')}</div>`,
      onOpen: el => el.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
        const t = TOPICS.find(x => x[0] === b.dataset.g);
        if (t[2]) textSheet(t[1], t[2]); else play(t[0]);
      }),
    });
  }

  A.guide = { after, hold, run, open };
}
