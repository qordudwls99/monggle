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
  // 앱이 있으면 메이트유 앱(mateyou://)으로. 안드로이드는 intent:// 라 앱이 없으면 크롬이 웹으로 보내요.
  // 아이폰은 앱이 깔렸는지 알 수 없어서 앱으로 열고, 앱이 없는 사람은 '웹에서 로그인'을 눌러요. 컴퓨터는 바로 웹.
  const MY_URL = 'https://www.mateyou.me/connect/moetable', MY_PKG = 'com.mateyou.app', MY_STATE = 'mateyou_state';
  let pendingLink = null, pendingCode = null, codeSheet = null, pendingPhoto = false;
  // 메이트유 로그인 · 연결 뒤 사진 고르기 / 올리기 (23-account.js). 임시 PIN 이면 PIN 바꾸기가 먼저라 이번엔 건너뛰어요
  const photoNext = me => {   // 환영 알림(2.2초)이 사라진 뒤. 처음 안내는 사진 시트가 뜰 때까지 기다려요
    if (me.pin_temp || !A.account || !A.account.afterMateyou) return;
    if (A.guide) A.guide.hold(4500);
    setTimeout(() => A.account.afterMateyou(), 2400);
  };
  const myState = () => {
    try { const w = JSON.parse(localStorage.getItem(MY_STATE) || 'null'); return w && Date.now() - w.t < 15 * 60e3 ? w : null; } catch (e) { return null; }
  };
  const isAndroid = () => /android/i.test(navigator.userAgent);
  // PKCE 처럼: 비밀값 v 는 이 브라우저에만 두고, 메이트유에는 그 SHA-256 앞 32자(state)만 보내요. 결과는 v 가 있어야 써요.
  // 누르는 순간 바로 앱을 열어야 해서(기다렸다 열면 아이폰이 막아요) 로그인 시트를 열 때 미리 만들어 둬요.
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  let myNext = null;
  async function prepMateyou() {
    const v = hex(crypto.getRandomValues(new Uint8Array(32)));
    myNext = { v, s: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))).slice(0, 32) };
  }
  function myLinks(s) {
    const q = `state=${s}&return=${encodeURIComponent(location.origin + (location.pathname === '/staff.html' ? '/v2/staff.html' : location.pathname))}`, web = `${MY_URL}?${q}`;
    return {
      web, app: `mateyou://connect/moetable?${q}`,
      intent: `intent://connect/moetable?${q}#Intent;scheme=mateyou;package=${MY_PKG};S.browser_fallback_url=${encodeURIComponent(web)};end`,
    };
  }
  const myTarget = (L, viaWeb) => viaWeb || !A.MATEYOU_APP ? L.web : isAndroid() ? L.intent : isIOS() ? L.app : L.web;
  function startMateyou(viaWeb) {
    const n = myNext;
    if (!n) return;
    myNext = null; prepMateyou();
    const s = n.s;
    localStorage.setItem(MY_STATE, JSON.stringify({ s, v: n.v, t: Date.now() }));
    // 아이폰 홈 화면 앱: 웹은 앱 위에 따로 뜨니 숫자 넣기를 미리 열어 두고, 메이트유 앱은 다녀와서 열어요(watchReturn).
    // 앱이 없어 안 열리면 로그인 시트가 그대로 남아 '웹에서 로그인'을 누를 수 있어요.
    const L = myLinks(s), url = myTarget(L, viaWeb === true);
    if (isStandalone() && isIOS() && url === L.web) openCodeEntry();
    location.href = url;
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
    const here = !!(want && want.v && c && c.state === want.s);
    if (!here && !(isIOS() && !isStandalone())) { A.toast('메이트유 로그인을 다시 해 주세요', true); return; }
    if (here) localStorage.removeItem(MY_STATE);
    let res; try { res = await A.supa.rpc('mateyou_signin', { p_ticket: m[1], p_verifier: here ? want.v : null }); } catch (e) { res = { error: e }; }
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
      if (drawn) { if (loginSheet) loginSheet.close(); afterLogin(me); photoNext(me); } else { A.toast(`${me.name}님 환영해요!`); pendingPhoto = true; }
    } else if (me.link) {
      if (drawn) { if (loginSheet) loginSheet.close(); openLink(me.link, me.pp); } else pendingLink = { link: me.link, pp: me.pp };
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
      if (!want || !want.v) { close(); A.toast('메이트유 로그인을 다시 해 주세요', true); return; }
      if (!/^\d{4}$/.test(code)) return show('숫자 4자리를 넣어 주세요');
      busy = true; btn.setAttribute('aria-busy', 'true'); err.hidden = true;
      let res; try { res = await A.supa.rpc('mateyou_claim', { p_verifier: want.v, p_code: code }); } catch (e) { res = { error: e }; }
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
  // 돌아왔을 때: 같은 저장소를 쓰는 다른 창(안드로이드, 사파리 새 탭)에서 로그인됐으면 이어받고,
  // 아이폰 홈 화면 앱이 메이트유 앱에 다녀왔으면 숫자 넣기를 열어요
  // 로그인돼 있으면 돌아올 때마다(1분에 한 번까지) 세션이 살아 있는지 확인해요 (파트너+ 해제로 서버에서 끊긴 경우 등)
  function watchReturn() {
    let away = 0, checked = Date.now();
    const back = () => {
      if (document.visibilityState === 'hidden') { away = Date.now(); return; }
      const gone = away && Date.now() - away > 1500;
      away = 0;
      if (session) {
        // 로그인한 채로 메이트유 연결(내 정보)을 하러 메이트유 앱에 다녀온 홈 화면 앱
        if (gone && isStandalone() && isIOS() && myState() && !codeSheet) { openCodeEntry(); return; }
        if (String(session.pin || '').startsWith('tk_') && Date.now() - checked > 60000) { checked = Date.now(); A.api.check(); }
        return;
      }
      const s = load();
      if (s) {
        session = s;
        if (loginSheet) loginSheet.close();
        settle(true);
        A.store.invalidateAll(); A.render({ keep: true });
        return;
      }
      if (gone && isStandalone() && isIOS() && myState() && !codeSheet) openCodeEntry();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
  }

  // 메이트유는 됐는데 아직 연결이 없을 때: PIN 이 있으면 이름 · PIN 으로 연결, 없으면 한글 닉네임으로 새로 가입
  // 파트너+가 아니면(pp=false) 관리자 계정 연결만 돼요: 새로 가입은 빼요
  function openLink(link, pp) {
    let busy = false, mode = 'pin';
    const html = `<div class="login-f">
      <div class="seg" role="tablist"${pp === false ? ' hidden' : ''}><button type="button" class="on" data-m="pin" role="tab" aria-selected="true">PIN으로 연결</button><button type="button" data-m="new" role="tab" aria-selected="false">새로 가입</button></div>
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
      photoNext(me);
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

  // 로그인한 채로 메이트유 연결 (내 정보 '연결 안 됨'). 다녀오면 연결 시트(이름 · PIN)가 떠요.
  // 아이폰에서 앱으로 열 때는 앱이 없을 수 있어서 '웹에서 연결'도 있는 시트를 먼저 보여요
  async function connectMateyou() {
    if (A.MATEYOU_APP && isIOS()) {
      if (loginSheet) return loginSheet;
      prepMateyou();
      loginSheet = A.sheet({
        title: '메이트유 연결',
        html: `<div class="login-f"><button type="button" class="btn lg primary my-login" data-l="mateyou"><img src="/v2/assets/mateyou.png" alt="" width="22" height="22">메이트유로 연결</button>
          <button type="button" class="btn ghost my-web" data-l="mateyou-web">웹에서 연결</button></div>`,
        actions: [{ label: '닫기' }],
        onClose: () => { loginSheet = null; },
        onOpen: el => {
          el.querySelector('[data-l="mateyou"]').addEventListener('click', () => startMateyou(false));
          el.querySelector('[data-l="mateyou-web"]').addEventListener('click', () => startMateyou(true));
        },
      });
      return loginSheet;
    }
    if (!myNext) await prepMateyou();
    startMateyou(false);
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
    // 메이트유가 먼저 (2026-11-09 메이트유로 옮기기 2단계). 이름 · PIN 은 연결률 90% 넘으면 닫아요
    const html = `<div class="login-f">
      ${A.MATEYOU_ON ? '<button type="button" class="btn lg primary my-login" data-l="mateyou"><img src="/v2/assets/mateyou.png" alt="" width="22" height="22">메이트유로 로그인</button>' : ''}
      ${A.MATEYOU_ON && A.MATEYOU_APP && isIOS() ? '<button type="button" class="btn ghost my-web" data-l="mateyou-web">웹에서 로그인</button>' : ''}
      ${A.MATEYOU_ON ? '<div class="login-sep" role="separator"></div>' : ''}
      <label class="fld-l">이름<input class="fld" data-l="name" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="30"></label>
      <label class="fld-l">PIN<input class="fld" data-l="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" placeholder="숫자 6자리"></label>
      <p class="sheet-err" hidden></p></div>`;
    const submit = async (close, el) => {
      if (busy) return;
      const nameEl = el.querySelector('[data-l="name"]'), pinEl = el.querySelector('[data-l="pin"]'), err = el.querySelector('.sheet-err');
      const btn = el.querySelector('.sheet-a [data-a]:last-child');   // 메이트유가 켜져 있으면 회색 '로그인' 하나
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
      // 주 버튼은 하나: 메이트유가 켜져 있으면 위의 메이트유로 로그인, 이름 · PIN '로그인'은 회색 (2026-11-09 사장님 "로그인 시트 버튼 색 수정")
      actions: A.MATEYOU_ON ? [{ label: '로그인', onClick: submit }] : [{ label: '취소' }, { label: '로그인', kind: 'primary', onClick: submit }],
      onClose: () => { loginSheet = null; if (!session) settle(false); },
      onOpen: (el, close) => {
        const nameEl = el.querySelector('[data-l="name"]'), pinEl = el.querySelector('[data-l="pin"]');
        nameEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pinEl.focus(); } });
        pinEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(close, el); } });
        const myBtn = el.querySelector('[data-l="mateyou"]');
        if (myBtn) { prepMateyou(); myBtn.addEventListener('click', () => startMateyou(false)); }
        const myWeb = el.querySelector('[data-l="mateyou-web"]');
        if (myWeb) myWeb.addEventListener('click', () => startMateyou(true));
        if (!myBtn) nameEl.focus();
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
      setTimeout(askNext, 800);
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
    bar('myBar').hidden = true;
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

  // ── 메이트유 연결 띠 (2026-11-09 사장님: 이름 · PIN 로그인은 차츰 없애고 메이트유로, 연결 90% 넘으면 전환) ──
  // 연결 안 된 사람에게 앱을 열 때마다 보여요. 닫으면 3일 쉬어요. 이 띠가 뜨면 알림 띠는 이번엔 안 띄워요
  const MY_ASK_KEY = 'my_link_dismiss', MY_ASK_REST = 3 * 864e5;
  async function maybeAskLink() {
    if (!session || session.pin_temp || !A.MATEYOU_ON) return false;
    let t = 0; try { t = +localStorage.getItem(MY_ASK_KEY) || 0; } catch (e) { /* 저장소를 못 쓰면 매번 */ }
    if (Date.now() - t < MY_ASK_REST) return false;
    const id = session.id, r = await A.api.direct('my_profile', { p_staff_id: id, p_pin: session.pin });
    if (!session || session.id !== id || !r || r.error || !r.data || r.data.mateyou) { bar('myBar').hidden = true; return false; }
    bar('pushBar').hidden = true;
    bar('myBar').hidden = false;
    window.dispatchEvent(new Event('resize'));   // 사용법 안내가 떠 있으면 자리를 다시 잡아요
    return true;
  }
  async function askNext() { if (!await maybeAskLink()) maybeAskPush(); }

  // ── 앱 설치 띠 (운영 2638-2652) ──
  let deferredPrompt = null;
  function showInstallBar() { if (isStandalone() || localStorage.getItem('install_dismiss')) return; bar('installBar').hidden = false; }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; showInstallBar(); });
  function wireBars() {
    bar('myBarX').innerHTML = A.ICON.x;
    bar('myBarBtn').onclick = () => connectMateyou();
    bar('myBarX').onclick = () => { bar('myBar').hidden = true; try { localStorage.setItem(MY_ASK_KEY, String(Date.now())); } catch (e) { /* 이번만 닫혀요 */ } };
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
    if (pendingLink) { openLink(pendingLink.link, pendingLink.pp); pendingLink = null; }   // 로그인한 채로 연결하러 다녀와도 열어요 (내 정보)
    if (pendingCode) { showCode(pendingCode); pendingCode = null; }
    if (pendingPhoto && session) { pendingPhoto = false; photoNext(session); }
    watchReturn();
    if (!loginSheet && isStandalone() && isIOS() && myState()) openCodeEntry();   // 앱을 다시 켰을 때 이어서 (로그인한 채 연결 중이어도)
    if (session) setTimeout(askNext, 1200);
    if (isIOS() && !isStandalone() && !localStorage.getItem('install_dismiss')) showInstallBar();
  }

  A.auth = {
    openLogin, require: requireLogin, logout, expire, update, upgradeSession,
    enablePush, pushOn, maybeAskPush, isIOS, isStandalone, boot, afterBoot, myLinks, myTarget, connectMateyou,
  };
}
