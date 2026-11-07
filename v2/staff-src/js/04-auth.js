// 로그인·세션 (운영 staff.html 905-1120 과 같은 저장 모양): shift_session, 예전 PIN 세션 바꾸기,
// 로그인 시트, 임시 PIN, 로그아웃, 죽은 토큰 처리, 푸시 알림 띠(push_ask_dismiss), 설치 띠(install_dismiss)
{
  const A = window.App;
  const KEY = 'shift_session';   // {id, name, is_admin, avatar, pin, pin_temp} · pin 칸에는 PIN 대신 세션 토큰(tk_…)
  const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.id != null ? s : null; } catch (e) { return null; } };
  let session = load();
  Object.defineProperty(A, 'session', { configurable: true, enumerable: true, get: () => session });
  const save = () => { if (session) localStorage.setItem(KEY, JSON.stringify(session)); else localStorage.removeItem(KEY); };

  // 예전 로그인(PIN 을 저장해 둔 기기)은 다시 로그인할 필요 없이 세션 토큰으로 조용히 교체 (운영 969-978)
  async function upgradeSession() {
    if (!session || String(session.pin || '').startsWith('tk_')) return;
    try {
      const { data, error } = await A.supa.rpc('staff_signin', { p_name: session.name, p_pin: session.pin });
      if (error) return;                                   // 네트워크 오류 등 → 다음 실행 때 다시
      const me = data && data[0];
      if (me && me.token) { session.pin = me.token; save(); }
      else { session = null; save(); }                     // PIN 이 바뀌었거나 잠김 → 로그아웃 상태
    } catch (e) { /* 다음에 다시 */ }
  }

  const signedIn = me => { session = { id: me.id, name: me.name, is_admin: me.is_admin, avatar: me.avatar_url || null, pin: me.token, pin_temp: !!me.pin_temp }; save(); };

  // ── 메이트유로 로그인: mateyou.me 에서 로그인 → 이 페이지로 #mateyou=<티켓> 으로 돌아와요 (supabase-v2-mateyou.sql) ──
  // 홈 화면 앱(iOS)은 메이트유를 따로 뜨는 브라우저에서 열어요(저장소가 달라요). 그 브라우저가 숫자 4자리를 보여주고,
  // 앱에서 그 숫자를 넣어 로그인을 넘겨받아요. 남이 보낸 링크로 들어온 사람의 로그인을 링크 보낸 사람이 가져가지 못하게 막아요.
  const MY_URL = 'https://www.mateyou.me/connect/moetable', MY_STATE = 'mateyou_state';
  let pendingLink = null, pendingCode = null, codeSheet = null;
  const myState = () => {
    try { const w = JSON.parse(localStorage.getItem(MY_STATE) || 'null'); return w && Date.now() - w.t < 15 * 60e3 ? w : null; } catch (e) { return null; }
  };
  function startMateyou() {
    const s = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(MY_STATE, JSON.stringify({ s, t: Date.now() }));
    if (isStandalone() && isIOS()) openCodeEntry();
    location.href = `${MY_URL}?state=${s}&return=${encodeURIComponent(location.origin + location.pathname)}`;
  }
  const claimsOf = t => {
    try { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); } catch (e) { return null; }
  };
  async function mateyouReturn() {
    const m = /^#mateyou=([\w-]+\.[\w-]+\.[\w-]+)$/.exec(location.hash);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const want = myState(), c = claimsOf(m[1]);
    // 이 브라우저에서 시작한 로그인이면 바로, 아이폰 홈 화면 앱이 따로 연 브라우저면 결과를 맡기고 숫자를 받아요
    const here = !!(want && c && c.state === want.s);
    if (!here && !(isIOS() && !isStandalone())) { A.toast('메이트유 로그인을 다시 해 주세요', true); return; }
    if (here) localStorage.removeItem(MY_STATE);
    let res; try { res = await A.supa.rpc('mateyou_signin', { p_ticket: m[1], p_here: here }); } catch (e) { res = { error: e }; }
    const me = res.data && res.data[0];
    if (res.error || !me) { A.toast(A.api.errText(res.error, '메이트유 로그인 실패'), true); return; }
    if (me.err) { A.toast(me.err, true); return; }
    if (me.code) { pendingCode = me.code; return; }
    mateyouDone(me, false);
  }
  // 로그인 결과 처리: token → 로그인, link → 연결 시트 (첫 그리기 전이면 afterBoot 에서 열어요)
  function mateyouDone(me, drawn) {
    if (me.token) {
      signedIn(me);
      if (drawn) { if (loginSheet) loginSheet.close(); afterLogin(me); } else A.toast(`${me.name}님 환영해요!`);
    } else if (me.link) {
      if (drawn) { if (loginSheet) loginSheet.close(); openLink(me.link); } else pendingLink = me.link;
    }
  }
  // 따로 뜬 브라우저: 앱에 넣을 숫자
  function showCode(code) {
    loginSheet = A.sheet({
      title: '메이트유 로그인',
      html: `<div class="my-code"><span class="fld-l">앱에 넣을 숫자</span><b>${A.esc(code)}</b></div>`,
      actions: [{ label: '닫기' }],
      onClose: () => { loginSheet = null; },
    });
  }
  // 홈 화면 앱: 메이트유를 연 동안 열어 두는 숫자 넣기
  function openCodeEntry() {
    if (codeSheet) return codeSheet;
    if (loginSheet) loginSheet.close();
    let busy = false, ok = false;
    const html = `<div class="login-f">
      <label class="fld-l">메이트유 화면의 숫자<input class="fld my-code-in" data-l="code" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="4자리"></label>
      <p class="sheet-err" hidden></p></div>`;
    const submit = async (close, el) => {
      if (busy) return;
      const inp = el.querySelector('[data-l="code"]'), err = el.querySelector('.sheet-err'), btn = el.querySelector('.sheet-a .primary');
      const show = msg => { err.hidden = false; err.textContent = msg; inp.focus(); };
      const want = myState(), code = inp.value.trim();
      if (!want) { close(); A.toast('메이트유 로그인을 다시 해 주세요', true); return; }
      if (!/^\d{4}$/.test(code)) return show('숫자 4자리를 넣어 주세요');
      busy = true; btn.setAttribute('aria-busy', 'true'); err.hidden = true;
      let res; try { res = await A.supa.rpc('mateyou_claim', { p_state: want.s, p_code: code }); } catch (e) { res = { error: e }; }
      busy = false; btn.removeAttribute('aria-busy');
      if (res.error) return show(A.api.errText(res.error, '로그인 실패'));
      const me = res.data && res.data[0];
      if (!me) return show('메이트유 로그인을 먼저 마쳐 주세요');
      if (me.err) {
        inp.value = '';
        if (me.err.startsWith('숫자가 맞지')) return show(me.err);
        close(); A.toast(me.err, true); return;
      }
      ok = true;
      mateyouDone(me, true);   // 로그인 · 연결 시트로 넘기면서 이 시트를 닫아요
    };
    codeSheet = loginSheet = A.sheet({
      title: '메이트유 로그인', html,
      actions: [{ label: '취소' }, { label: '확인', kind: 'primary', onClick: submit }],
      onClose: () => { codeSheet = loginSheet = null; localStorage.removeItem(MY_STATE); if (!session && !ok) settle(false); },
      onOpen: (el, close) => {
        el.querySelector('[data-l="code"]').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(close, el); } });
      },
    });
    return codeSheet;
  }
  // 같은 저장소를 쓰는 다른 창(안드로이드 앱이 연 탭)에서 로그인됐으면 돌아올 때 이어받아요
  function watchReturn() {
    const back = () => {
      if (document.visibilityState !== 'visible' || session) return;
      const s = load();
      if (!s) return;
      session = s;
      if (codeSheet) codeSheet.close();
      A.store.invalidateAll(); A.render({ keep: true });
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
  }

  // 메이트유는 됐는데 아직 연결이 없을 때: PIN 이 있으면 이름 · PIN 으로 연결, 없으면 한글 닉네임으로 새로 가입
  function openLink(link) {
    let busy = false, mode = 'pin';
    const html = `<div class="login-f">
      <div class="seg" role="tablist"><button type="button" class="on" data-m="pin" role="tab" aria-selected="true">PIN으로 연결</button><button type="button" data-m="new" role="tab" aria-selected="false">새로 가입</button></div>
      <div class="login-f" data-p="pin">
        <label class="fld-l">이름<input class="fld" data-l="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="30"></label>
        <label class="fld-l">PIN<input class="fld" data-l="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" placeholder="숫자 6자리"></label>
      </div>
      <div class="login-f" data-p="new" hidden>
        <label class="fld-l">닉네임<input class="fld" data-l="nick" maxlength="8" autocomplete="off" spellcheck="false" placeholder="한글만"></label>
      </div>
      <p class="sheet-err" hidden></p></div>`;
    const submit = async (close, el) => {
      if (busy) return;
      const err = el.querySelector('.sheet-err'), btn = el.querySelector('.sheet-a .primary');
      const show = (msg, f) => { err.hidden = false; err.textContent = msg; if (f) f.focus(); };
      let fn, args, focusEl;
      if (mode === 'pin') {
        const nameEl = el.querySelector('[data-l="name"]'), pinEl = el.querySelector('[data-l="pin"]');
        const name = nameEl.value.trim(), pin = pinEl.value.trim();
        if (!name) return show('이름을 적어 주세요', nameEl);
        if (!pin) return show('PIN을 입력하세요', pinEl);
        fn = 'mateyou_link'; args = { p_link: link, p_name: name, p_pin: pin }; focusEl = pinEl;
      } else {
        const nickEl = el.querySelector('[data-l="nick"]'), nick = nickEl.value.trim();
        if (!/^[가-힣]{1,8}$/.test(nick)) return show('닉네임은 한글로만 8자까지 써 주세요', nickEl);
        fn = 'mateyou_join'; args = { p_link: link, p_name: nick }; focusEl = nickEl;
      }
      busy = true; btn.setAttribute('aria-busy', 'true'); err.hidden = true;
      let res; try { res = await A.supa.rpc(fn, args); } catch (e) { res = { error: e }; }
      busy = false; btn.removeAttribute('aria-busy');
      const { data, error } = res;
      if (error) return show(A.api.errText(error, '연결 실패'));
      if (!data || data.length === 0) { if (mode === 'pin') focusEl.value = ''; return show('이름 또는 PIN이 올바르지 않아요', focusEl); }
      const me = data[0];
      if (me.err) { if (mode === 'pin') focusEl.value = ''; return show(me.err, focusEl); }
      signedIn(me);
      close();
      afterLogin(me);
    };
    loginSheet = A.sheet({
      title: '메이트유 연결', html,
      actions: [{ label: '취소' }, { label: '연결', kind: 'primary', onClick: submit }],
      onClose: () => { loginSheet = null; if (!session) settle(false); },
      onOpen: (el, close) => {
        const btn = el.querySelector('.sheet-a .primary'), err = el.querySelector('.sheet-err');
        const setMode = m => {
          mode = m; err.hidden = true;
          el.querySelectorAll('[data-m]').forEach(b => { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
          el.querySelectorAll('[data-p]').forEach(p => { p.hidden = p.dataset.p !== m; });
          btn.textContent = m === 'pin' ? '연결' : '가입';
          el.querySelector(m === 'pin' ? '[data-l="name"]' : '[data-l="nick"]').focus();
        };
        el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
        const enter = (sel, next) => el.querySelector(sel).addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); next(); } });
        enter('[data-l="name"]', () => el.querySelector('[data-l="pin"]').focus());
        enter('[data-l="pin"]', () => submit(close, el));
        enter('[data-l="nick"]', () => submit(close, el));
        el.querySelector('[data-l="name"]').focus();
      },
    });
    return loginSheet;
  }

  // 세션 일부 바꾸기 (사진·관리자 여부·임시 PIN 표시)
  function update(patch = {}) {
    if (!session) return;
    const adminChanged = 'is_admin' in patch && !!patch.is_admin !== !!session.is_admin;
    for (const k of ['name', 'is_admin', 'avatar', 'pin_temp']) if (k in patch) session[k] = patch[k];
    save();
    if (adminChanged) { A.store.invalidateAll(); A.render({ keep: true }); } else A.renderShell();
  }

  // ── 로그인 시트 ──
  let loginSheet = null;
  const waiters = [];
  const settle = v => { while (waiters.length) waiters.shift()(v); };
  function openLogin() {
    if (loginSheet) return loginSheet;
    let busy = false;
    const html = `<div class="login-f">
      <label class="fld-l">이름<input class="fld" data-l="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="30"></label>
      <label class="fld-l">PIN<input class="fld" data-l="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" placeholder="숫자 6자리"></label>
      <p class="sheet-err" hidden></p>
      ${A.MATEYOU_ON ? '<button type="button" class="btn lg my-login" data-l="mateyou"><img src="assets/mateyou.png" alt="" width="22" height="22">메이트유로 로그인</button>' : ''}</div>`;
    const submit = async (close, el) => {
      if (busy) return;
      const nameEl = el.querySelector('[data-l="name"]'), pinEl = el.querySelector('[data-l="pin"]'), err = el.querySelector('.sheet-err');
      const btn = el.querySelector('.sheet-a .primary');
      const name = nameEl.value.trim(), pin = pinEl.value.trim();
      const show = m => { err.hidden = false; err.textContent = m; };
      if (!name) { show('이름을 적어 주세요'); nameEl.focus(); return; }
      if (!pin) { show('PIN을 입력하세요'); pinEl.focus(); return; }
      busy = true; btn.setAttribute('aria-busy', 'true'); err.hidden = true;
      let res;
      try { res = await A.supa.rpc('staff_signin', { p_name: name, p_pin: pin }); } catch (e) { res = { error: e }; }
      busy = false; btn.removeAttribute('aria-busy');
      const { data, error } = res;
      if (error) { show(A.api.errText(error, '로그인 실패')); return; }
      if (!data || data.length === 0) { show('이름 또는 PIN이 올바르지 않아요'); pinEl.value = ''; pinEl.focus(); return; }
      const me = data[0];
      if (me.err) { show(me.err); pinEl.value = ''; pinEl.focus(); return; }   // 틀린 PIN 남은 횟수 · 잠김 문구 그대로
      signedIn(me);
      pinEl.value = '';
      close();
      afterLogin(me);
    };
    loginSheet = A.sheet({
      title: '로그인', html,
      actions: [{ label: '취소' }, { label: '로그인', kind: 'primary', onClick: submit }],
      onClose: () => { loginSheet = null; if (!session) settle(false); },
      onOpen: (el, close) => {
        const nameEl = el.querySelector('[data-l="name"]'), pinEl = el.querySelector('[data-l="pin"]');
        nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pinEl.focus(); } });
        pinEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(close, el); } });
        const myBtn = el.querySelector('[data-l="mateyou"]');
        if (myBtn) myBtn.addEventListener('click', startMateyou);
        nameEl.focus();
      },
    });
    return loginSheet;
  }
  function afterLogin(me) {
    A.toast(`${me.name}님 환영해요!`);
    A.store.invalidateAll();
    A.render({ keep: true });
    settle(true);
    if (me.pin_temp) {
      // 내 정보 화면(23-account.js)이 App.onTempPin 을 정해 두면 그 PIN 바꾸기를 열어요.
      if (typeof A.onTempPin === 'function') {
        A.toast('임시 PIN으로 로그인했어요. 새 PIN으로 바꿔 주세요');
        setTimeout(() => { try { A.onTempPin(); } catch (e) { console.error(e); } }, 700);
      } else {
        setTimeout(() => A.toast('임시 PIN으로 로그인했어요. 내 정보에서 PIN을 바꿔 주세요'), 700);
      }
    } else {
      setTimeout(maybeAskPush, 800);
    }
  }
  // 로그인이 필요한 동작 앞에서: 이미 로그인했으면 true, 아니면 시트를 열고 로그인하면 true / 닫으면 false
  function requireLogin() {
    if (session) return Promise.resolve(true);
    return new Promise(res => { waiters.push(res); openLogin(); });
  }
  // 토큰이 죽었을 때 (다른 기기에서 PIN 변경, 관리자가 PIN 재설정 등)
  function expire() {
    if (!session) return;
    session = null; save();
    A.store.invalidateAll();
    A.toast('로그인이 풀렸어요. 다시 로그인해 주세요', true);
    A.render({ keep: true });
    openLogin();
  }
  function logout() {
    if (session) { const s = session; Promise.resolve(A.supa.rpc('staff_signout', { p_staff_id: s.id, p_pin: s.pin })).then(() => {}, () => {}); }
    session = null; save();
    A.store.invalidateAll();
    A.go('schedule');
    A.toast('로그아웃 했어요');
  }

  // ── 푸시 알림 (운영 980-1009) ──
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const bar = id => document.getElementById(id);
  function urlB64ToUint8(base64) {
    const padStr = '='.repeat((4 - base64.length % 4) % 4);
    const b = (base64 + padStr).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b); const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  // 켜기만 있어요 (끄기 RPC 는 막혀 있음). 성공하면 true
  async function enablePush() {
    if (!session) { openLogin(); return false; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { A.toast('이 기기는 푸시 알림을 지원하지 않아요', true); return false; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { A.toast('알림 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요', true); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(A.VAPID_PUBLIC) });
      const j = sub.toJSON();
      const ok = await A.api.rpc('save_push_subscription', { p_staff_id: session.id, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth }, { ok: '알림을 켰어요' });
      if (ok === false) return false;
      bar('pushBar').hidden = true;
      return true;
    } catch (e) { A.toast('알림 켜기 실패: ' + ((e && e.message) || e), true); return false; }
  }
  // 이 기기에서 알림이 켜져 있는지 (내 정보 버튼 표시용)
  async function pushOn() {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      return !!sub && Notification.permission === 'granted';
    } catch (e) { return false; }
  }
  function maybeAskPush() {
    if (!session) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;            // 이미 허용/거부면 안 물어봄
    if (localStorage.getItem('push_ask_dismiss')) return;        // 이전에 닫았으면 안 물어봄
    if (isIOS() && !isStandalone()) return;                      // 아이폰은 앱 설치 후에만 가능
    bar('pushBar').hidden = false;
  }

  // ── 앱 설치 띠 (운영 2638-2652) ──
  let deferredPrompt = null;
  function showInstallBar() { if (isStandalone() || localStorage.getItem('install_dismiss')) return; bar('installBar').hidden = false; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; showInstallBar(); });
  function wireBars() {
    bar('installX').innerHTML = A.ICON.x;
    bar('pushAskX').innerHTML = A.ICON.x;
    bar('installX').onclick = () => { bar('installBar').hidden = true; localStorage.setItem('install_dismiss', '1'); };
    bar('installBtn').onclick = async () => {
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; bar('installBar').hidden = true; }
      else if (isIOS()) A.sheet({ title: '아이폰에 설치하기', html: '<p class="sheet-p">1. 사파리 아래 가운데 공유 버튼을 눌러요.<br>2. "홈 화면에 추가"를 골라요.<br>3. 추가를 누르면 홈 화면에 앱이 생겨요.</p>', actions: [{ label: '알겠어요', kind: 'primary' }] });
      else A.sheet({ title: '앱으로 설치하기', html: '<p class="sheet-p">브라우저 메뉴에서 "앱 설치" 또는 "홈 화면에 추가"를 눌러 주세요.</p>', actions: [{ label: '알겠어요', kind: 'primary' }] });
    };
    bar('pushAskBtn').onclick = enablePush;
    bar('pushAskX').onclick = () => { bar('pushBar').hidden = true; localStorage.setItem('push_ask_dismiss', '1'); };
  }

  // core 의 boot 가 불러요: 첫 그리기 전 / 뒤
  async function boot() { wireBars(); await mateyouReturn(); await upgradeSession(); }
  function afterBoot() {
    if (pendingLink && !session) { openLink(pendingLink); pendingLink = null; }
    if (pendingCode) { showCode(pendingCode); pendingCode = null; }
    watchReturn();
    if (!session && !loginSheet && isStandalone() && isIOS() && myState()) openCodeEntry();   // 앱을 다시 켰을 때 이어서
    if (session) setTimeout(maybeAskPush, 1200);
    if (isIOS() && !isStandalone() && !localStorage.getItem('install_dismiss')) showInstallBar();
  }

  A.auth = {
    openLogin, require: requireLogin, logout, expire, update, upgradeSession,
    enablePush, pushOn, maybeAskPush, isIOS, isStandalone, boot, afterBoot,
  };
}
