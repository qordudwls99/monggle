// 종(알림) 시트 (운영 staff.html 1667-1722 의 관리자 알림 탭 + v2 개인 알림)
// - A.features.v2db: 로그인 뒤 my_notifications 를 한 번 조용히 불러 보고, 함수가 없으면 false 그대로
// - 관리자: 빈 자리 신청(수락/거절) · 대타 구하는 중 · 최근 정해진 대타 10건. 안 읽음 = noti_seen_ids ('ap:<id>' / 'sw:<id>', 최근 500개)
// - 모두: v2db 가 켜져 있으면 내 알림 (누르면 그 화면으로, mark_my_notifications_read)
{
  const A = window.App;
  const esc = A.esc;
  const features = A.features = A.features || { v2db: false };   // 같은 객체를 계속 써요 (v2db 만 바꿈)
  let pendingReady = null;
  A.featuresReady = A.session ? new Promise(r => { pendingReady = r; }) : Promise.resolve(false);
  const settleReady = v => { if (pendingReady) { const res = pendingReady; pendingReady = null; res(v); } };
  // 예전 세션이 풀리거나 바꾸기가 실패하면 probe 가 안 돌아요. 기다리는 화면이 멈추지 않게 false 로 끝내요
  if (pendingReady) setTimeout(() => settleReady(false), 6000);

  const SEEN_KEY = 'noti_seen_ids';
  const seen = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch (e) { return new Set(); } };
  const saveSeen = set => localStorage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-500)));

  const MISSING_RE = /Could not find the function|does not exist/i;
  const isMissing = err => !!err && (err.code === 'PGRST202' || err.code === '42883' || MISSING_RE.test(String(err.message || '')));

  let sid = null;          // 지금 상태가 누구 것인지
  let probeP = null;
  let personal = [];       // my_notifications 줄
  let adminKeys = [];      // 안 읽음 셀 대상: 열린 신청 + 열린 대타
  let lastFetch = 0, refreshing = null, btnRef = null;

  function reset(id) { sid = id; probeP = null; personal = []; adminKeys = []; lastFetch = 0; }
  const fetchMine = s => A.api.direct('my_notifications', { p_staff_id: s.id, p_pin: s.pin, p_limit: 30 });

  // 로그인 뒤 한 번. 예전 PIN 세션(tk_ 아님)은 upgradeSession 이 바꾼 뒤에만 (안 그러면 토큰 오류로 로그아웃돼요)
  function probe() {
    const s = A.session;
    if (!s || !String(s.pin || '').startsWith('tk_')) { settleReady(false); return null; }
    if (sid !== s.id) reset(s.id);
    if (probeP) return probeP;
    const p = probeP = (async () => {
      const r = await fetchMine(s);
      if (!A.session || A.session.id !== s.id) return features.v2db;
      if (r.error) {
        if (isMissing(r.error)) features.v2db = false;
        else if (probeP === p) probeP = null;   // 네트워크 등: 다음 mount 때 다시. 죽은 토큰은 api 가 처리
        return features.v2db;
      }
      const was = features.v2db;
      features.v2db = true;
      personal = Array.isArray(r.data) ? r.data : [];
      // DB 기능이 처음 보이면 한 번만 다시 그려서 숨겨 둔 v2 기능을 보여 줘요
      if (!was) A.render({ keep: true });
      return true;
    })();
    if (pendingReady) { const res = pendingReady; pendingReady = null; p.then(res, () => res(false)); }
    else A.featuresReady = p;
    return p;
  }

  const unread = () => {
    const sn = seen();
    const a = A.isAdmin() ? adminKeys.filter(k => !sn.has(k)).length : 0;
    const p = features.v2db ? personal.filter(n => !n.read_at).length : 0;
    return a + p;
  };
  function paint() {
    const btn = btnRef;
    if (!btn || !document.contains(btn)) return;
    btn.hidden = !A.isAdmin() && !features.v2db;   // 직원은 개인 알림이 생긴 뒤에만 종을 보여요
    const n = unread();
    let b = btn.querySelector('.nbadge');
    if (n > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'nbadge'; btn.appendChild(b); }
      b.textContent = n > 99 ? '99+' : String(n);
    } else if (b) b.remove();
    btn.setAttribute('aria-label', n > 0 ? `알림 ${n}개` : '알림');
  }

  // 배지용 가벼운 읽기 (운영 updateNotiBadge). force 가 아니면 30초에 한 번
  function refresh(force = false) {
    const s = A.session;
    if (!s) return Promise.resolve();
    if (!force && Date.now() - lastFetch < 30000) return refreshing || Promise.resolve();
    if (refreshing) return refreshing;
    lastFetch = Date.now();
    const id = s.id;
    refreshing = (async () => {
      const [ap, sw, mine] = await Promise.all([
        A.isAdmin() ? A.supa.from('application_view').select('id') : null,
        A.isAdmin() ? A.supa.from('swap_view').select('id,work_date').eq('status', 'open').gte('work_date', A.today()) : null,
        features.v2db ? fetchMine(s) : null,
      ]);
      if (!A.session || A.session.id !== id) return;
      if (ap && sw && !ap.error && !sw.error) adminKeys = [...(ap.data || []).map(a => 'ap:' + a.id), ...(sw.data || []).filter(x => new Date(x.work_date + 'T16:00:00') > Date.now()).map(x => 'sw:' + x.id)];   // 마감 지난 글 빼기
      if (mine && !mine.error) personal = Array.isArray(mine.data) ? mine.data : [];
    })().catch(() => {}).finally(() => { refreshing = null; paint(); });
    return refreshing;
  }

  // ── 시트 ──
  const ago = iso => {
    const t = Date.parse(iso || ''); if (!t) return '';
    const m = Math.floor((Date.now() - t) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return `${m}분 전`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24); if (d < 7) return `${d}일 전`;
    return A.fmtShort(A.ymd(new Date(t)));
  };
  const when = (ds, wp) => `${A.fmtShort(ds)} ${A.storeName(wp)}`;

  let data = { apps: [], open: [], done: [], ok: false };
  async function load() {
    const s = A.session, admin = A.isAdmin();
    let [apR, open, done, mine] = await Promise.all([
      admin ? A.supa.from('application_view').select('*').order('work_date') : null,
      admin ? A.store.swaps({ status: 'open' }) : [],
      admin ? A.store.swaps({ status: 'completed', limit: 10 }) : [],
      features.v2db ? fetchMine(s) : null,
    ]);
    if (apR && apR.error) A.toast('불러오지 못했어요. 당겨서 새로고침해 주세요', true);
    const apps = (apR && apR.data || []).map(a => ({ id: a.id, shiftId: a.shift_id, staffId: a.applicant_id, name: a.applicant_name || '', date: a.work_date, wp: a.workplace }));
    open = open.filter(x => new Date(x.date + 'T16:00:00') > Date.now());   // 마감(근무일 16:00) 지난 글은 게시판처럼 빼요
    data = { apps, open, done, ok: true };
    if (admin && apR && !apR.error) adminKeys = [...apps.map(a => 'ap:' + a.id), ...open.map(x => 'sw:' + x.id)];
    if (mine && !mine.error) personal = Array.isArray(mine.data) ? mine.data : [];
    lastFetch = Date.now();
  }
  function bodyHtml() {
    const sn = seen(), admin = A.isAdmin();
    const head = (t, n) => `<div class="bl-h">${t}${n ? ` <b>${n}</b>` : ''}</div>`;
    let html = '';
    if (features.v2db && personal.length) {
      html += head('내 알림') + `<div class="noti-list">${personal.map(n => `<button class="noti${n.read_at ? '' : ' unread'}" data-p="${esc(n.id)}"><span class="noti-t">${esc(n.title || '')}</span>${n.body ? `<span class="noti-b">${esc(n.body)}</span>` : ''}<span class="noti-s">${esc(ago(n.created_at))}</span></button>`).join('')}</div>`;
    }
    if (admin) {
      const { apps, open, done } = data;
      if (apps.length) html += head('빈 자리 신청', apps.length) + `<div class="noti-list">${apps.map(a => `<div class="noti bl-ap${sn.has('ap:' + a.id) ? '' : ' unread'}">
          <span class="noti-t">${esc(a.name)}님이 ${esc(when(a.date, a.wp))} 빈 자리에 신청했어요</span>
          <span class="bl-acts"><button class="btn sm ghost" data-rej="${a.id}">거절</button><button class="btn sm" data-ok="${a.id}">수락</button></span></div>`).join('')}</div>`;
      if (open.length) html += head('대타 구하는 중', open.length) + `<div class="noti-list">${open.map(x => `<button class="noti${sn.has('sw:' + x.id) ? '' : ' unread'}" data-sw="${x.id}"><span class="noti-t">${esc(x.requesterName)}님이 ${esc(when(x.date, x.wp))} 대타를 구해요</span>${x.reason ? `<span class="noti-b">${esc(x.reason)}</span>` : ''}<span class="noti-s">${esc(ago(x.createdAt))}</span></button>`).join('')}</div>`;
      if (done.length) html += head('최근 정해진 대타') + `<div class="noti-list">${done.map(x => `<button class="noti" data-done="${x.id}"><span class="noti-t">${esc(x.takerName || '?')}님이 ${esc(x.requesterName)}님 대타를 맡았어요</span><span class="noti-s">${esc(when(x.date, x.wp))}</span></button>`).join('')}</div>`;
    }
    return html || A.emptyBox('bell', '새 알림이 없어요', admin ? '빈 자리 신청이나 대타 글이 오면 여기에 보여요' : '');
  }

  // 알림 링크로 가기: {tab, date?, workplace?, ym?}
  function follow(l) {
    if (!l || !l.tab) return;
    const o = {};
    if (l.date) o.date = l.date;
    if (l.workplace) o.wp = l.workplace;
    if (l.tab === 'schedule') {
      if (l.date) o.view = 'day';
      else if (l.ym) { o.date = l.ym + '-01'; o.view = 'month'; }
    }
    A.go(l.tab, o);
  }
  function markPersonal(ids) {
    const s = A.session; if (!s || !features.v2db) return;
    const now = new Date().toISOString();
    personal.forEach(n => { if (!n.read_at && (!ids || ids.includes(n.id))) n.read_at = now; });
    return A.api.rpc('mark_my_notifications_read', { p_staff_id: s.id, p_ids: ids }, { quiet: true });
  }
  const markSeen = keys => { const sn = seen(); keys.forEach(k => sn.add(k)); saveSeen(sn); };

  function draw(el, close) {
    const box = el.querySelector('[data-bl]');
    if (!box || !document.contains(box)) return;
    box.innerHTML = bodyHtml();
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      const n = personal.find(x => String(x.id) === b.dataset.p); if (!n) return;
      if (!n.read_at) markPersonal([n.id]);
      close(); paint(); follow(n.link);
    });
    box.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => { markSeen(['sw:' + b.dataset.sw]); close(); paint(); A.go('swaps'); });
    box.querySelectorAll('[data-done]').forEach(b => b.onclick = () => { close(); A.go('swaps'); });
    box.querySelectorAll('[data-ok]').forEach(b => b.onclick = () => decide(+b.dataset.ok, true, el, close));
    box.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => decide(+b.dataset.rej, false, el, close));
  }
  // 수락/거절 (운영 1719-1721). 하나 처리하는 동안 다른 수락·거절은 막아요 (같은 자리 두 명 수락 방지)
  let deciding = false;
  async function decide(id, ok, el, close) {
    const a = data.apps.find(x => x.id === id), s = A.session;
    if (!a || !s || deciding) return;
    deciding = true;
    const btns = [...el.querySelectorAll('[data-ok],[data-rej]')];
    btns.forEach(b => { b.disabled = true; });
    try {
      if (!ok && !await A.confirm({ title: `${a.name}님 신청을 거절할까요?`, text: features.v2db ? `${a.name}님에게 거절 알림이 가요.` : `${when(a.date, a.wp)} 빈 자리 신청이에요.`, ok: '거절하기', danger: true })) return;
      const r = await A.api.rpc(ok ? 'admin_approve_application' : 'admin_reject_application', { p_admin_id: s.id, p_app_id: id });
      if (r === false) return;
      if (features.v2db) A.api.notify({ event: 'application_decided', app_id: id });   // 신청자에게 (v2 DB 가 있을 때만)
      markSeen(['ap:' + id]);
      A.store.invalidate(a.date, a.date);
      await A.render({ keep: true });
      A.toast(ok ? '신청을 수락해 배정했어요' : '신청을 거절했어요');
      await load();
      draw(el, close); paint();
    } finally { deciding = false; btns.forEach(b => { if (document.contains(b)) b.disabled = false; }); }
  }
  async function open() {
    if (!A.session) { A.auth.openLogin(); return; }
    const sh = A.sheet({
      title: '알림',
      html: '<div class="bl-body" data-bl><div class="bl-load"><span class="spin"></span></div></div>',
      actions: [{ label: '모두 읽음으로', onClick: async c => {
        markSeen(adminKeys);
        if (features.v2db && personal.some(n => !n.read_at)) await markPersonal(null);
        c(); paint(); A.toast('알림을 모두 읽었어요');
      } }],
    });
    await probe();
    await load();
    draw(sh.el, sh.close);
    paint();
  }

  // core 의 renderShell 이 그릴 때마다 새 종 버튼을 줘요
  function mount(btn) {
    const s = A.session;
    if (!s) return;
    if (sid !== s.id) reset(s.id);
    btnRef = btn;
    btn.onclick = open;
    paint();
    const p = probe();
    if (p) p.then(() => { paint(); refresh(); });
    else refresh();
  }

  A.bell = { mount, open, refresh: () => refresh(true), unread };
}
