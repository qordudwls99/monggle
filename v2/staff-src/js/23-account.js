// 내 정보 (운영 staff.html 1120-1229): 사진 바꾸기(280 정사각 자르기 → 256×256 JPEG q0.85), 인스타(my_profile / set_my_instagram),
// PIN 바꾸기(6자리, 지금 PIN 칸 없음: set_my_pin), 푸시 켜기, 로그아웃. 임시 PIN 로그인이면 A.onTempPin 이 PIN 바꾸기를 열어요
{
  const A = window.App;
  const esc = A.esc;
  const D = 280, OUT = 256;   // 화면 자르기 칸 / 올릴 크기 (운영 CROP_D, S)

  // ── 사진 고르기 → 자르기 ──
  function pickPhoto(onDone) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const file = inp.files && inp.files[0]; if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => openCrop(img, onDone);
        img.onerror = () => A.toast('이미지를 읽지 못했어요', true);
        img.src = rd.result;
      };
      rd.onerror = () => A.toast('파일 읽기 실패', true);
      rd.readAsDataURL(file);
    };
    inp.click();
  }
  function openCrop(img, onDone) {
    const st = { img, base: Math.max(D / img.width, D / img.height), zoom: 1, x: 0, y: 0 };
    const sc = () => st.base * st.zoom;
    const center = () => { st.x = (D - img.width * sc()) / 2; st.y = (D - img.height * sc()) / 2; };
    const clamp = () => {
      const w = img.width * sc(), h = img.height * sc();
      st.x = Math.min(0, Math.max(D - w, st.x)); st.y = Math.min(0, Math.max(D - h, st.y));
    };
    let cv, ctx;
    const draw = () => { ctx.clearRect(0, 0, D, D); ctx.drawImage(img, st.x, st.y, img.width * sc(), img.height * sc()); };
    let busy = false;
    A.sheet({
      title: '사진 자르기',
      html: `<div class="crop-wrap"><canvas class="crop-cv" width="${D}" height="${D}" aria-label="끌어서 자리 맞추기"></canvas><div class="crop-ring"></div></div>
        <label class="fld-l">크기<input type="range" class="crop-zoom" min="1" max="3" step="0.01" value="1" aria-label="사진 크기"></label>
        <p class="sheet-note">끌어서 자리를 맞추고, 막대로 크기를 정해요.</p>`,
      actions: [{ label: '취소' }, { label: '이 사진으로', kind: 'primary', onClick: (close, el) => {
        if (busy) return; busy = true;
        const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
        const g = c.getContext('2d'), r = OUT / D;
        g.fillStyle = '#fff'; g.fillRect(0, 0, OUT, OUT);   // 투명한 PNG 가 검게 나오지 않게
        g.drawImage(img, st.x * r, st.y * r, img.width * sc() * r, img.height * sc() * r);
        c.toBlob(async blob => {
          close();
          if (!blob) { A.toast('사진을 만들지 못했어요', true); return; }
          // uploadAvatar 가 올리기 + set_my_avatar + auth.update({avatar}) + 알림까지 해요
          const url = await A.api.uploadAvatar(blob);
          if (url === false) return;
          A.store.invalidateAll();
          await A.render({ keep: true });
          if (onDone) onDone(url);
        }, 'image/jpeg', 0.85);
      } }],
      onOpen: el => {
        cv = el.querySelector('.crop-cv'); ctx = cv.getContext('2d');
        center(); draw();
        const zoom = el.querySelector('.crop-zoom');
        zoom.oninput = () => {
          const prev = sc(); st.zoom = Number(zoom.value); const now = sc();
          st.x = D / 2 - (D / 2 - st.x) * (now / prev); st.y = D / 2 - (D / 2 - st.y) * (now / prev);
          clamp(); draw();
        };
        // 끌기: 포인터를 붙잡아서 바깥에서 놓아도 시트가 닫히지 않게
        let drag = null;
        cv.addEventListener('pointerdown', e => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} e.preventDefault(); });
        cv.addEventListener('pointermove', e => {
          if (!drag || e.pointerId !== drag.id) return;
          const k = D / cv.getBoundingClientRect().width;   // 좁은 화면에서는 캔버스가 작게 보여요
          st.x += (e.clientX - drag.x) * k; st.y += (e.clientY - drag.y) * k;
          drag.x = e.clientX; drag.y = e.clientY;
          clamp(); draw();
        });
        const end = e => { if (drag && e.pointerId === drag.id) { drag = null; try { cv.releasePointerCapture(e.pointerId); } catch (_) {} } };
        cv.addEventListener('pointerup', end);
        cv.addEventListener('pointercancel', end);
        cv.addEventListener('click', e => e.stopPropagation());
      },
    });
  }

  // ── PIN 바꾸기 (운영 1134-1141) ──
  function openPin({ note } = {}) {
    let busy = false;
    const submit = async (close, el) => {
      if (busy) return;
      const inp = el.querySelector('[data-pin]'), err = el.querySelector('.sheet-err'), v = inp.value.trim();
      if (!/^\d{6}$/.test(v)) { err.hidden = false; err.textContent = 'PIN은 숫자 6자리로 적어 주세요'; inp.focus(); return; }
      const s = A.session; if (!s) { close(); A.auth.openLogin(); return; }
      busy = true; err.hidden = true;
      const r = await A.api.rpc('set_my_pin', { p_staff_id: s.id, p_new_pin: v });
      busy = false;
      if (r === false) return;
      inp.value = '';
      A.auth.update({ pin_temp: false });
      close();
      A.toast('PIN을 바꿨어요');
    };
    A.sheet({
      title: 'PIN 바꾸기',
      html: `${note ? `<p class="sheet-p">${esc(note)}</p>` : ''}
        <label class="fld-l">새 PIN<input class="fld ac-pin" data-pin inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" placeholder="숫자 6자리"></label>
        <p class="sheet-note">바꾸면 다른 기기에서는 새 PIN으로 다시 로그인해야 해요.</p><p class="sheet-err" hidden></p>`,
      actions: [{ label: '취소' }, { label: 'PIN 바꾸기', kind: 'primary', onClick: submit }],
      onOpen: (el, close) => {
        const inp = el.querySelector('[data-pin]');
        inp.focus();
        inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(close, el); } });
      },
    });
  }

  // ── 내 정보 시트 ──
  function open({ focus, note } = {}) {
    const s = A.session;
    if (!s) { A.auth.openLogin(); return; }
    let ig = '', igLoaded = false;
    const html = `<div class="me-card"><span data-av>${A.avatar({ name: s.name, avatar: s.avatar }, 'me-av lg')}</span><div><b>${esc(s.name)}</b><span class="tag soft">${s.is_admin ? '관리자' : '직원'}</span></div></div>
      <div class="menu-list">
        <button class="menu-row" data-m="photo"><span>프로필 사진 바꾸기</span>${A.ICON.chev}</button>
        <button class="menu-row" data-m="ig"><span class="ac-l">인스타그램<small data-ig>불러오는 중…</small></span>${A.ICON.chev}</button>
        <button class="menu-row" data-m="pin"><span class="ac-l">PIN 바꾸기${s.pin_temp ? '<small class="ac-warn">임시 PIN이에요</small>' : ''}</span>${A.ICON.chev}</button>
        <button class="menu-row" data-m="push"><span class="ac-l">푸시 알림<small data-push>확인 중…</small></span>${A.ICON.chev}</button>
      </div>`;
    const sh = A.sheet({
      title: '내 정보', html,
      actions: [{ label: '로그아웃', kind: 'danger', onClick: async c => {
        if (!await A.confirm({ title: '로그아웃할까요?', text: '다시 들어올 때 이름과 PIN이 필요해요.', ok: '로그아웃', danger: true })) return;
        c(); A.auth.logout();
      } }],
      onOpen: el => {
        const igEl = el.querySelector('[data-ig]'), pushEl = el.querySelector('[data-push]');
        const showIg = () => { igEl.textContent = igLoaded ? (ig ? ig : '아직 없어요') : '불러오지 못했어요'; };
        const loadIg = async () => {
          const cur = A.session; if (!cur) return;
          const r = await A.api.direct('my_profile', { p_staff_id: cur.id, p_pin: cur.pin });
          if (!r.error && r.data) { ig = r.data.instagram || ''; igLoaded = true; }
          if (document.contains(igEl)) showIg();
        };
        const loadPush = async () => { const on = await A.auth.pushOn(); if (document.contains(pushEl)) pushEl.textContent = on ? '이 기기에서 켜져 있어요' : '꺼져 있어요'; return on; };
        loadIg(); loadPush();
        el.querySelector('[data-m="photo"]').onclick = () => pickPhoto(url => {
          const box = el.querySelector('[data-av]');
          if (box && document.contains(box)) box.innerHTML = A.avatar({ name: s.name, avatar: url }, 'me-av lg');
        });
        el.querySelector('[data-m="ig"]').onclick = async () => {
          if (!igLoaded) await loadIg();
          if (!igLoaded) { A.toast('인스타 정보를 불러오지 못했어요. 잠시 뒤에 다시 해 주세요', true); return; }   // 빈 값으로 덮어쓰지 않게
          const v = await A.prompt({ title: '인스타그램', label: '아이디 또는 링크', value: ig, placeholder: '인스타 아이디 또는 링크', ok: '저장' });
          if (v === null || v === ig) return;
          const cur = A.session; if (!cur) return;
          const r = await A.api.rpc('set_my_instagram', { p_staff_id: cur.id, p_insta: v });
          if (r === false) return;
          ig = v; if (document.contains(igEl)) showIg();
          A.store.invalidateAll();
          await A.render({ keep: true });
          A.toast(v ? '저장했어요' : '인스타를 지웠어요');
        };
        el.querySelector('[data-m="pin"]').onclick = () => openPin();
        el.querySelector('[data-m="push"]').onclick = async () => {
          if (await A.auth.pushOn()) { A.toast('이 기기는 알림이 켜져 있어요'); return; }
          await A.auth.enablePush();
          loadPush();
        };
      },
    });
    if (focus === 'pin') openPin({ note });
    return sh;
  }

  A.account = { open };
  // 임시 PIN 으로 로그인했을 때 (04-auth afterLogin)
  A.onTempPin = () => open({ focus: 'pin', note: '임시 PIN으로 로그인했어요. 앞으로 쓸 PIN 6자리를 정해 주세요.' });
}
