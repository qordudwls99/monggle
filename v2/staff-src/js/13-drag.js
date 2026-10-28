// 컴퓨터(넓이 980 이상)에서 관리자가 '전체'를 볼 때: 근무를 다른 층으로 끌어 옮기기, 휴지통으로 끌어 지우기
// 운영 staff.html 2148-2169 (bindMoveDrag), 2761-2771 (dragTrash). 일별·주간 모두 data 속성만 봐요:
//   끌 것: [data-shift-id][data-date][data-wp] (data-name 이 있으면 확인 문구에 씀)
//   놓을 곳: [data-drop-wp] (없으면 근무 줄이 아닌 [data-wp]). 놓을 곳에 data-date 가 있고 날짜가 다르면 무시
{
  const A = window.App;
  const wide = () => window.matchMedia('(min-width:980px)').matches;
  const active = () => A.isAdmin() && wide() && A.state.wp === '전체';
  const bound = new WeakSet();
  let cur = null;          // 지금 끄는 근무 {id, wp, date, name, el}
  let trash = null;

  const nameOf = el => el.dataset.name || (el.querySelector('.nm, .n') || el).textContent.trim();
  const zoneOf = t => (t && t.closest) ? (t.closest('[data-drop-wp]') || t.closest('[data-wp]:not([data-shift-id]):not([data-night-id])')) : null;
  const zoneWp = z => z.dataset.dropWp || z.dataset.wp;
  const after = async (ds, msg) => { A.store.invalidate(ds, ds); await A.render({ keep: true }); A.toast(msg); };

  async function move(d, target) {
    if (!d || !target || d.wp === target) return;
    if (!await A.confirm({ title: `${d.name}님을 ${A.storeName(target)}로 옮길까요?`, text: `${A.fmt(d.date)} ${d.wp} → ${target}`, ok: '옮기기' })) return;
    if (await A.api.rpc('admin_move_shift', { p_admin_id: A.session.id, p_shift_id: Number(d.id), p_workplace: target }) === false) return;
    await after(d.date, `${d.name}님을 ${A.storeName(target)}로 옮겼어요`);
  }
  async function remove(d) {
    if (!d) return;
    if (!await A.confirm({ title: `${d.name}님 근무를 지울까요?`, text: `${A.fmt(d.date)} ${d.wp} 근무가 지워져요.`, ok: '지우기', danger: true })) return;
    if (await A.api.rpc('admin_delete_shift', { p_admin_id: A.session.id, p_shift_id: Number(d.id) }) === false) return;
    await after(d.date, `${d.name}님 근무를 지웠어요`);
  }

  function trashEl() {
    if (trash && document.contains(trash)) return trash;
    trash = document.createElement('div');
    trash.className = 'drag-trash';
    trash.setAttribute('aria-hidden', 'true');
    trash.innerHTML = `${A.ICON.x}<span>여기로 끌어 지우기</span>`;
    trash.addEventListener('dragover', e => { if (!cur) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; trash.classList.add('over'); });
    trash.addEventListener('dragleave', () => trash.classList.remove('over'));
    trash.addEventListener('drop', e => { e.preventDefault(); const d = cur; hide(); remove(d); });
    (document.getElementById('app') || document.body).appendChild(trash);
    return trash;
  }
  function hide() {
    if (trash) trash.classList.remove('show', 'over');
    document.querySelectorAll('.dragover').forEach(z => z.classList.remove('dragover'));
    if (cur && cur.el) cur.el.classList.remove('dragging');
  }

  function bind(root) {
    if (!root || bound.has(root) || !active()) return;
    bound.add(root);
    // 운영처럼 사람이 있는 근무만 (빈 자리 줄 .slot 은 빼요)
    root.querySelectorAll('[data-shift-id]:not(.slot)').forEach(el => { el.setAttribute('draggable', 'true'); el.classList.add('can-drag'); });
    root.addEventListener('dragstart', e => {
      const el = e.target.closest && e.target.closest('[data-shift-id][draggable="true"]');
      if (!el || !root.contains(el)) return;
      cur = { id: el.dataset.shiftId, wp: el.dataset.wp, date: el.dataset.date, name: nameOf(el), el };
      if (e.dataTransfer) { e.dataTransfer.setData('text/plain', String(cur.id)); e.dataTransfer.effectAllowed = 'move'; }
      el.classList.add('dragging');
      trashEl().classList.add('show');
    });
    root.addEventListener('dragend', () => { hide(); cur = null; });
    const okZone = z => z && cur && zoneWp(z) && zoneWp(z) !== cur.wp && (!z.dataset.date || z.dataset.date === cur.date);
    root.addEventListener('dragover', e => {
      const z = zoneOf(e.target);
      if (!okZone(z)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      root.querySelectorAll('.dragover').forEach(x => { if (x !== z) x.classList.remove('dragover'); });
      z.classList.add('dragover');
    });
    root.addEventListener('dragleave', e => { const z = zoneOf(e.target); if (z && e.target === z) z.classList.remove('dragover'); });
    root.addEventListener('drop', e => {
      const z = zoneOf(e.target);
      if (!okZone(z)) return;
      e.preventDefault();
      const d = cur, target = zoneWp(z);
      hide();
      move(d, target);
    });
  }

  A.drag = { bind };
}
