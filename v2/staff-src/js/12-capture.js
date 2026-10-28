// 출근표 이미지 (운영 staff.html 1776-1852): 매장별 한 달 출근표를 그려 html2canvas 로 PNG 를 만들고,
// 휴대폰은 공유 시트(navigator.share), 안 되면 '<매장>_<MM>월_스케줄.png' 로 내려받아요. 로그인 없이도 써요.
{
  const A = window.App;
  const WPS = () => A.FLOORS.map(f => f[0]);
  const monthDays = ym => { const [y, m] = ym.split('-').map(Number); const n = new Date(y, m, 0).getDate(); return Array.from({ length: n }, (_, i) => `${ym}-${A.pad(i + 1)}`); };

  function open(ym, wp) {
    ym = ym || A.ymOf(A.today());
    const [y, m] = ym.split('-').map(Number);
    const days = monthDays(ym);
    let cur = WPS().includes(wp) ? wp : WPS().includes(A.state.wp) ? A.state.wp : WPS()[0];
    let open = true, busy = false, ready = false;

    const chips = () => `<div class="chips cp-chips" role="group" aria-label="매장">${A.FLOORS.map(([w, fl]) => { const th = A.THEMES[w];
      return `<button class="chip${w === cur ? ' on' : ''}" data-w="${w}" aria-pressed="${w === cur}" style="--c:${th.c};--cs:${th.cs};--ci:${th.ci}"><img src="${A.logo(w)}" alt=""><span class="ct"><b>${w}</b><small>${fl}</small></span></button>`; }).join('')}</div>`;

    // 한 칸: 날짜 · 이벤트 · 휴무 또는 (게스트 → 직원 → 부족) · 야간 멤버
    const cell = ds => {
      const d = A.store.day(ds, cur), dow = A.parse(ds).getDay();
      const cls = dow === 0 ? ' sun' : dow === 6 ? ' sat' : '';
      let body = '';
      if (d.closed) body = '<span class="cp-off">휴무</span>';
      else {
        const g = d.shifts.filter(s => s.guest), st = d.shifts.filter(s => !s.guest);
        if (g.length) body += `<span class="cp-gl">게스트</span>${g.map(s => `<span class="cp-nm g">${A.esc(s.name)}</span>`).join('')}${st.length ? '<i class="cp-sep"></i>' : ''}`;
        body += st.map(s => `<span class="cp-nm">${A.esc(s.name)}</span>`).join('');
        body += d.slots.map(() => '<span class="cp-short">부족</span>').join('');
        const nm = d.night ? d.night.members.filter(x => !x.short) : [];
        if (nm.length) body += `<span class="cp-nt"><b>야간</b>${nm.map(x => `<span>${A.esc(x.name)}</span>`).join('')}</span>`;
      }
      return `<div class="cp-c${cls}"><span class="cp-dn">${A.parse(ds).getDate()}</span>${d.event ? `<span class="cp-ev">${A.esc(d.event)}</span>` : ''}${body}</div>`;
    };
    const image = () => {
      const first = new Date(y, m - 1, 1).getDay();
      return `<div class="cp-sheet" data-theme="${A.themeKey(cur)}">
        <div class="cp-head"><img src="${A.logo(cur)}" alt=""><span><b>${A.esc(cur)}</b><small>${y}년 ${m}월 출근표</small></span></div>
        <div class="cp-dow">${A.DAYS.map((d, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span>`).join('')}</div>
        <div class="cp-grid">${'<div class="cp-c blank"></div>'.repeat(first)}${days.map(cell).join('')}</div></div>`;
    };

    const draw = async () => {
      const el = s.el, wrap = el.querySelector('.cp-wrap'), btn = el.querySelector('.sheet-a .primary');
      el.querySelector('.cp-top').innerHTML = chips();
      el.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { if (busy) return; cur = b.dataset.w; draw(); });
      ready = false; btn.disabled = true;
      const ok = await A.store.ensure(days[0], days[days.length - 1]);
      if (!open || !document.contains(el)) return;
      if (!ok) { wrap.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '시트를 닫고 다시 열어 주세요'); return; }
      if (A.store.day(days[0], cur).draft && !A.isAdmin()) { wrap.innerHTML = A.emptyBox('lock', '아직 공개되지 않은 달이에요'); return; }
      wrap.innerHTML = image();
      ready = true; btn.disabled = false;
    };

    const save = async (close, el) => {
      if (busy || !ready) return;
      const node = el.querySelector('.cp-sheet'), btn = el.querySelector('.sheet-a .primary');
      if (!node) return;
      busy = true; btn.setAttribute('aria-busy', 'true');
      const label = btn.textContent; btn.textContent = '만드는 중…';
      const box = el.querySelector('.sheet-b'), top = box.scrollTop;
      try {
        await Promise.all([...node.querySelectorAll('img')].map(i => i.complete ? null : new Promise(r => { i.onload = i.onerror = r; })));
        const mod = await import('https://esm.sh/html2canvas@1.4.1');
        const html2canvas = mod.default || mod;
        box.scrollTop = 0;
        const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
        box.scrollTop = top;
        const name = `${cur}_${ym.split('-')[1]}월_스케줄.png`;
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        if (!blob) throw new Error('이미지를 만들지 못했어요');
        const file = new File([blob], name, { type: 'image/png' });
        // 휴대폰: 공유 시트 → '이미지 저장' 또는 단톡방
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: name }); return; }
          catch (e) { if (e && e.name === 'AbortError') return; }
        }
        // 컴퓨터: 바로 내려받기
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        A.toast('이미지를 저장했어요');
      } catch (e) {
        A.toast('이미지를 저장하지 못했어요: ' + ((e && e.message) || e), true);
      } finally {
        box.scrollTop = top;
        busy = false; btn.removeAttribute('aria-busy'); btn.textContent = label;
      }
    };

    const s = A.sheet({
      title: '출근표 이미지',
      html: `<div class="cp-top"></div><div class="cp-wrap"><div class="tl-load"><span class="spin"></span></div></div><p class="sheet-note">휴대폰에서는 공유 창이 열려요. 거기서 이미지 저장이나 단톡방을 골라 주세요.</p>`,
      actions: [{ label: '이미지 저장하기', kind: 'primary', onClick: save }],
      onClose: () => { open = false; },
    });
    draw();
    return s;
  }

  A.capture = { open };
}
