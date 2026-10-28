// 서버 호출: rpc(운영 staff.html 1072-1079 와 같은 규칙) · direct · notify · 사진 올리기 · 오류 문구
// 화면은 쓰기 뒤에 App.store.invalidate…() 하고 App.render({keep:true}) 를 불러요. rpc 는 다시 그리지 않아요.
{
  const A = window.App;
  // 'P0001: 관리자만 가능합니다' → '관리자만 가능합니다'
  const errText = (e, fallback = '') => String((e && e.message) || e || '').replace(/^.*?:\s*/, '') || fallback;
  const STALE_RE = /PIN이 올바르지 않습니다/;   // _verify 실패 (토큰이 지워졌거나 PIN이 바뀜)
  const ADMIN_RE = /관리자만 가능합니다/;       // 관리자 RPC: 토큰이 죽었거나 관리자에서 빠졌을 때 둘 다

  // '관리자만 가능합니다' 가 오면 my_profile 로 토큰이 살아 있는지, 아직 관리자인지 확인해요.
  let checking = null;
  function checkAdmin() {
    const s = A.session;
    if (!s || checking) return checking;
    checking = (async () => {
      try {
        const { data, error } = await A.supa.rpc('my_profile', { p_staff_id: s.id, p_pin: s.pin });
        if (error) { if (STALE_RE.test(String(error.message || ''))) A.auth.expire(); return; }
        if (data && data.is_admin === false && A.session && A.session.is_admin) A.auth.update({ is_admin: false });
      } catch (e) { /* 네트워크 오류: 다음에 다시 */ }
    })().finally(() => { checking = null; });
    return checking;
  }
  // 토큰이 죽은 오류면 로그아웃 처리하고 true
  function onError(error) {
    if (!A.session) return false;
    const raw = String((error && error.message) || '');
    if (STALE_RE.test(raw)) { A.auth.expire(); return true; }
    if (ADMIN_RE.test(raw) && A.session.is_admin) checkAdmin();
    return false;
  }

  // 로그인한 사람의 RPC. 실패하면 정확히 false, 성공하면 data ?? true (0 이 올 수 있으니 === false 로 확인)
  async function rpc(fn, args = {}, { ok, quiet } = {}) {
    let s = A.session;
    if (!s) { A.auth.openLogin(); return false; }
    if (!String(s.pin || '').startsWith('tk_')) {           // 예전 PIN 세션: 먼저 토큰으로 바꿔요 (운영 969-978)
      await A.auth.upgradeSession();
      s = A.session;
      if (!s) { A.auth.openLogin(); return false; }
      if (!String(s.pin || '').startsWith('tk_')) { if (!quiet) A.toast('연결을 확인하고 다시 해 주세요', true); return false; }
    }
    let res;
    try { res = await A.supa.rpc(fn, { ...args, p_pin: s.pin }); }
    catch (e) { res = { error: e }; }
    const { data, error } = res;
    if (error) {
      if (!onError(error) && !quiet) A.toast(errText(error, '오류'), true);
      return false;
    }
    if (ok) A.toast(ok);
    return data ?? true;
  }

  // 그대로 부르는 RPC (p_pin 을 붙이지 않음, 알림 없음). {data, error, text}
  async function direct(fn, args) {
    try {
      const { data, error } = args === undefined ? await A.supa.rpc(fn) : await A.supa.rpc(fn, args);
      if (error) { onError(error); return { data: null, error, text: errText(error, '오류') }; }
      return { data, error: null, text: '' };
    } catch (e) { return { data: null, error: e, text: errText(e, '오류') }; }
  }

  // notify 엣지 함수: 기다리지 않고 보내요 (운영과 같음). 운영에서 쓰는 body 만 보내 주세요.
  function notify(body = {}) {
    const s = A.session;
    if (!s) return;
    try { Promise.resolve(A.supa.functions.invoke('notify', { body: { ...body, staff_id: s.id, token: s.pin } })).catch(() => {}); }
    catch (e) { /* 무시 */ }
  }

  // 프로필 사진: avatars/<id>-<시각>.jpg (JPEG, 1MB 이하) 올리고 set_my_avatar. 성공하면 주소, 실패하면 false
  async function uploadAvatar(blob) {
    const s = A.session;
    if (!s) { A.auth.openLogin(); return false; }
    if (!blob || blob.size > 1024 * 1024) { A.toast('사진이 너무 커요. 1MB 이하로 올려 주세요', true); return false; }
    A.toast('사진 올리는 중…');
    try {
      const path = `${s.id}-${Date.now()}.jpg`;
      const bucket = A.supa.storage.from('avatars');
      const up = await bucket.upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) throw up.error;
      const url = bucket.getPublicUrl(path).data.publicUrl;
      const { error } = await A.supa.rpc('set_my_avatar', { p_staff_id: s.id, p_pin: s.pin, p_url: url });
      if (error) { if (onError(error)) return false; throw error; }
      A.auth.update({ avatar: url });
      A.toast('프로필 사진을 바꿨어요');
      return url;
    } catch (e) {
      A.toast('사진 업로드 실패: ' + errText(e, String(e)), true);
      return false;
    }
  }

  A.api = { rpc, direct, notify, uploadAvatar, errText };
}
