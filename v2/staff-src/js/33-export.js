// 출근표 이미지 (관리자): 배경 그림 위에 실제 일정을 캔버스로 그려 PNG 로 저장해요.
// 범위는 2주(매장별) · 1주(3개 층) · 1일(3개 층, 쉬는 층은 휴무), 크기는 스토리 1080×1920 · 게시글 1080×1350 비율로 두 배 크게 저장해요.
// 배경은 assets/export-*.jpg, 칸과 패널 자리는 LAYOUT 표 (1080 기준 px) 에 있어요.
{
  const A = window.App;
  const FONT_CSS = ['https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&display=swap', 'https://hangeul.pstatic.net/hangeul_static/css/maru-buri.css'];
  // 글꼴 [이름, 굵기]. 제목은 제목판, 내용은 층 이름 · 날짜 · 이름 · 이벤트 · 휴무
  const FONT = { title: ['Gowun Batang', 700], body: ['MaruBuriBold', 400] };
  let F = FONT;
  const fontOf = ([name, weight], px) => `${weight} ${Math.round(px)}px "${name}","Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  const SIZE = { story: [1080, 1920], post: [1080, 1350] }, SCALE = 2;
  const LIGHT = '#fff3f7', DARK = '#2a1418';
  const TH = {
    '데빌': { ink: LIGHT, sub: '#e5bcc4', ac: '#d4202f', ev: '#ff8796', off: '폐업' },
    '메이드': { ink: '#231318', sub: '#7d5563', ac: '#e0407f', ev: '#e0407f', off: '휴무' },
    '마츠리': { ink: '#33140f', sub: '#8a4a3c', ac: '#d3261b', ev: '#d3261b', off: '휴무' },
  };
  const PANEL_INK = '#231318', PANEL_TINT = '#fbe1e8', PANEL_LINE = '#e3b7c3';
  // 1주 · 1일 그림은 세 층 모두 연한 메이드 톤이라 글자를 진하게 써요
  const pale = wp => ({ ...TH[wp], ink: PANEL_INK, sub: TH['메이드'].sub, ev: TH[wp].ac });

  // title: [x, y, w, h, 글자색] · x/y: 칸 경계 (2주) · week: 매장별 칸 경계 (1주) · panels: 층 순서대로 [x, y, w, h] (1일) · labels: 층 이름판 [x, y, w, h]
  const LAYOUT = {
    'story-2w-devil': { title: [281, 260, 517, 105, LIGHT], x: [61, 183, 301, 421, 540, 659, 778, 898, 1020], y: [462, 1011, 1558], fs: 33 },
    'story-2w-maid': { title: [275, 266, 528, 107, DARK], x: [61, 198, 334, 472, 609, 746, 882, 1019], y: [464, 1011, 1563], fs: 36 },
    'story-2w-matsuri': { title: [275, 264, 523, 113, DARK], x: [61, 197, 336, 470, 609, 745, 883, 1019], y: [461, 1012, 1561], fs: 36 },
    'post-2w-devil': { title: [289, 82, 510, 91, LIGHT], x: [45, 167, 287, 413, 536, 659, 786, 911, 1035], y: [265, 707, 1157], fs: 33 },
    'post-2w-maid': { title: [289, 67, 505, 82, DARK], x: [53, 194, 333, 471, 609, 746, 886, 1026], y: [245, 717, 1182], fs: 36 },
    'post-2w-matsuri': { title: [272, 61, 537, 93, DARK], x: [52, 192, 331, 471, 610, 750, 890, 1029], y: [235, 752, 1234], fs: 36 },
    'story-1w': { title: [267, 161, 546, 77, DARK], labels: [[415, 264, 249, 36], [415, 705, 249, 36], [415, 1189, 250, 40]], week: [[[56, 177, 300, 420, 541, 661, 782, 904, 1025], 384, 678], [[56, 195, 333, 471, 609, 748, 886, 1025], 828, 1161], [[56, 195, 332, 471, 609, 747, 886, 1025], 1315, 1649]], fs: 28 },
    'post-1w': { title: [313, 92, 454, 64, DARK], labels: [[427, 180, 225, 24], [427, 547, 225, 25], [427, 896, 225, 25]], week: [[[53, 173, 296, 419, 540, 661, 784, 907, 1025], 279, 504], [[54, 191, 330, 471, 610, 750, 889, 1025], 646, 856], [[54, 191, 330, 470, 610, 750, 889, 1025], 996, 1202]], fs: 26 },
    'story-1d': { title: [277, 198, 527, 82, DARK], labels: [[430, 313, 219, 37], [430, 754, 219, 37], [430, 1203, 219, 38]], panels: [[101, 379, 879, 333], [101, 820, 879, 343], [101, 1269, 879, 347]], fs: 58 },
    'post-1d': { title: [311, 112, 457, 65, DARK], labels: [[427, 202, 224, 28], [427, 534, 224, 28], [427, 865, 224, 27]], panels: [[75, 251, 930, 256], [75, 585, 930, 254], [75, 913, 930, 256]], fs: 50 },
  };

  const WPS = () => A.FLOORS.map(f => f[0]);
  const codeOf = wp => A.FLOORS.find(f => f[0] === wp)[2];
  const addDays = (ds, n) => { const d = A.parse(ds); d.setDate(d.getDate() + n); return A.ymd(d); };
  const span = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
  const monthOf = ds => A.parse(ds).getMonth() + 1;
  const weekNo = ds => Math.floor((A.parse(ds).getDate() - 1) / 7) + 1;
  const isOpen = d => !d.closed && (d.shifts.length > 0 || d.slots.length > 0 || !!d.night);
  const nightOf = d => (d.night ? d.night.members.filter(m => !m.short) : []);
  // 아직 일정을 안 넣은 달은 쉬는 날이 아니라서 휴무 대신 비워 둬요
  const hasMonth = ds => {
    const d = A.parse(ds), first = A.ymd(new Date(d.getFullYear(), d.getMonth(), 1)), n = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return span(first, n).some(x => WPS().some(w => { const i = A.store.day(x, w); return i.closed || isOpen(i); }));
  };

  const rangeOf = o => {
    if (o.scope === '1d') return [o.ds, o.ds];
    const from = A.ymd(A.sundayOf(A.parse(o.ds)));
    return [from, addDays(from, o.scope === '2w' ? 13 : 6)];
  };
  const keyOf = o => {
    if (o.scope === '2w') return `${o.fmt}-2w-${codeOf(o.wp)}`;
    return `${o.fmt}-${o.scope}`;
  };
  const titleOf = o => {
    const [from] = rangeOf(o), m = monthOf(from);
    if (o.scope === '1d') return `${m}월 ${A.parse(from).getDate()}일 출근표`;
    if (o.scope === '1w') return `${m}월 ${weekNo(from)}째 주`;
    const week = ds => `${monthOf(ds)}월 ${weekNo(ds)}주차`;
    return `${week(from)} - ${week(addDays(from, 7))}`;
  };

  // ── 글꼴 · 그림 ──
  let cssP = null;
  const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  const fontsFor = async (text, fonts) => {
    cssP = cssP || Promise.all(FONT_CSS.map(href => new Promise(r => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = r; document.head.appendChild(l); })));
    const spec = [fonts.title, fonts.body].map(f => fontOf(f, 30));
    await withTimeout(cssP.then(() => Promise.all(spec.map(s => document.fonts.load(s, text)))).catch(() => {}), 6000);
  };
  const images = new Map();
  const imageOf = key => {
    if (!images.has(key)) images.set(key, new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => { images.delete(key); no(new Error('배경을 불러오지 못했어요')); }; i.src = `assets/export-${key}.jpg`; }));
    return images.get(key);
  };

  // ── 칸 하나 = 줄 목록 ──
  const line = (kind, text) => ({ kind, text });
  const LINE_H = { date: 1.4, ev: 1, gl: .95, gn: 1.5 };
  const lineH = (l, fs, lh) => fs * (LINE_H[l.kind] || lh);
  const heightOf = (ls, fs, lh) => ls.reduce((n, l) => n + lineH(l, fs, lh), 12);
  const tallest = (cells, fs, lh) => Math.max(...cells.map(ls => heightOf(ls, fs, lh)));
  const fitSize = (cells, h, fs0, lh) => { let fs = fs0; while (fs > 16 && tallest(cells, fs, lh) > h) fs--; return fs; };
  // 글자는 16 밑으로 줄이지 않아요. 그래도 넘치면 줄 간격을 좁혀요
  const squeeze = (cells, h, fs, lh) => Math.min(1, (h - 12) / (tallest(cells, fs, lh) - 12));
  const people = list => {
    const g = list.filter(s => s.guest), st = list.filter(s => !s.guest);
    return [...(g.length ? [line('gl', '게스트')] : []), ...g.map(s => line('gn', s.name)), ...st.map(s => line('nm', s.name))];
  };
  const dayLines = (ds, wp, dn) => {
    const d = A.store.day(ds, wp);
    return [line('date', dn), ...(d.event ? [line('ev', d.event)] : []), ...(isOpen(d) ? people(d.shifts) : hasMonth(ds) ? [line('off', TH[wp].off)] : [])];
  };
  // 夜 칸: 그 주의 야간 (지금은 토요일 하루뿐이에요)
  const nightLines = (days, wp) => days.flatMap(ds => { const m = nightOf(A.store.day(ds, wp)); return m.length ? [line('date', `${A.parse(ds).getDate()} 야간`), ...people(m)] : []; });

  const roundRect = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
  const pill = (c, cx, cy, text, maxW, fs, th, maxH = Infinity) => {
    const w = Math.min(c.measureText(text).width + fs * .5, maxW), h = Math.min(fs * 1.34, maxH);
    c.fillStyle = th.ac; roundRect(c, cx - w / 2, cy - h / 2, w, h, fs * .24); c.fill();
    c.fillStyle = '#fff'; c.fillText(text, cx, cy, w - fs * .3);
  };
  const STYLE = {
    date: (fs, th) => [fontOf(F.body, fs * 1.05), th.sub], ev: (fs, th) => [fontOf(F.body, fs * .72), th.ev],
    gl: (fs, th) => [fontOf(F.body, fs * .62), th.ev], off: (fs, th) => [fontOf(F.body, fs * .86), th.sub],
    nm: (fs, th) => [fontOf(F.body, fs), th.ink], gn: (fs, th) => [fontOf(F.body, fs), th.ink],
  };
  function drawCell(c, x, y, w, ls, th, fs, lh, sq = 1) {
    const cx = x + w / 2;
    let py = y + 8;
    ls.forEach(l => {
      const h = lineH(l, fs, lh) * sq, [font, color] = STYLE[l.kind](fs, th);
      c.font = font;
      if (l.kind === 'gn') pill(c, cx, py + h / 2, l.text, w - 8, fs, th, h - 1);
      else { c.fillStyle = color; c.fillText(String(l.text), cx, py + h / 2, w - 10); }
      py += h;
    });
  }

  // ── 1일: 이름을 가운뎃점으로 이어요 ──
  // 끝줄에 이름 하나만 남지 않게 줄 수는 그대로 두고 폭을 좁혀요
  function wrapNames(c, list, w, fs) {
    const gap = c.measureText(' · ').width, items = list.map(s => ({ s, iw: c.measureText(s.name).width + (s.guest ? fs * .6 : 0) }));
    const wrap = lim => {
      const rows = [[]];
      let used = 0;
      items.forEach(i => {
        if (rows[rows.length - 1].length && used + gap + i.iw > lim) { rows.push([]); used = 0; }
        used += (rows[rows.length - 1].length ? gap : 0) + i.iw;
        rows[rows.length - 1].push(i);
      });
      return rows;
    };
    let rows = wrap(w);
    for (let lim = w - fs; lim > 0; lim -= fs) { const r = wrap(lim); if (r.length > rows.length) break; rows = r; }
    return { rows, gap };
  }
  const widthOf = (row, gap) => row.reduce((n, i) => n + i.iw, 0) + (row.length - 1) * gap;
  function fitNames(c, list, w, h, fs0) {
    for (let fs = Math.floor(fs0); ; fs--) {
      c.font = fontOf(F.body, fs);
      const r = wrapNames(c, list, w, fs);
      if (fs <= 16 || (r.rows.length * fs * 1.6 <= h && r.rows.every(row => widthOf(row, r.gap) <= w))) return { ...r, fs };
    }
  }
  function nameDots(c, [x, y, w, h], list, th, fs0) {
    const { rows, gap, fs } = fitNames(c, list, w, h, fs0), lh = fs * 1.6, top = y + (h - rows.length * lh) / 2;
    c.font = fontOf(F.body, fs);
    rows.forEach((row, r) => {
      const cy = top + lh * (r + .5);
      let px = x + (w - widthOf(row, gap)) / 2;
      row.forEach(({ s, iw }, i) => {
        if (s.guest) pill(c, px + iw / 2, cy, s.name, iw + fs * .1, fs, th);
        else { c.fillStyle = PANEL_INK; c.fillText(s.name, px + iw / 2, cy); }
        px += iw;
        if (i < row.length - 1) { c.fillStyle = th.ac; c.fillText('·', px + gap / 2, cy); px += gap; }
      });
    });
  }
  function drawPanel(c, p, wp, ds, fs0) {
    const th = pale(wp), d = A.store.day(ds, wp), night = nightOf(d);
    const [px, py, pw, ph] = p, inX = px + 34, inW = pw - 68, name = fs0 * .64;
    // 흰 패널을 1주 칸과 같은 연분홍으로 물들여요. 곱하기라 틀의 구슬은 그대로예요
    c.save(); c.globalCompositeOperation = 'multiply'; c.fillStyle = PANEL_TINT; c.fillRect(px - 4, py - 4, pw + 8, ph + 8); c.restore();
    let top = py + 22, h = ph - 44;
    if (!isOpen(d)) { if (hasMonth(ds)) { c.font = fontOf(F.body, fs0 * .8); c.fillStyle = th.sub; c.fillText(th.off, px + pw / 2, py + ph / 2); } return; }
    if (d.event) { c.font = fontOf(F.body, fs0 * .56); c.fillStyle = th.ev; c.fillText(d.event, px + pw / 2, top + fs0 * .4); top += fs0 * .8; h -= fs0 * .8; }
    if (!night.length) { nameDots(c, [inX, top, inW, h], d.shifts, th, name); return; }
    const colW = (inW - 44) / 2, labelH = fs0 * .86, listH = h - labelH;
    // 주간 · 야간 글자는 같은 크기로 맞춰요
    const fs = Math.min(...[d.shifts, night].map(l => fitNames(c, l, colW, listH, name * .78).fs));
    [['주간', d.shifts, inX], ['야간', night, inX + colW + 44]].forEach(([label, list, x]) => {
      c.font = fontOf(F.body, fs0 * .56); c.fillStyle = th.ac; c.fillText(label, x + colW / 2, top + labelH / 2);
      nameDots(c, [x, top + labelH, colW, listH], list, th, fs);
    });
    c.fillStyle = PANEL_LINE; c.fillRect(px + pw / 2 - 1, top + 6, 2, h - 12);
  }

  function drawTwoWeeks(c, L, o, from) {
    const th = TH[o.wp], hasNight = L.x.length === 9, weeks = [0, 7].map(n => span(addDays(from, n), 7));
    const first = (ds, i, r) => { const d = A.parse(ds); return d.getDate() === 1 || (r === 0 && i === 0) ? `${d.getMonth() + 1}/${d.getDate()}` : d.getDate(); };
    const grid = weeks.map((days, r) => days.map((ds, i) => dayLines(ds, o.wp, first(ds, i, r))));
    const nights = hasNight ? weeks.map(days => nightLines(days, o.wp)) : [];
    const lh = 1.55, all = [...grid.flat(), ...nights], h = Math.min(L.y[1] - L.y[0], L.y[2] - L.y[1]), fs = fitSize(all, h, L.fs, lh), sq = squeeze(all, h, fs, lh);
    grid.forEach((row, r) => row.forEach((ls, i) => drawCell(c, L.x[i], L.y[r], L.x[i + 1] - L.x[i], ls, th, fs, lh, sq)));
    nights.forEach((ls, r) => { if (ls.length) drawCell(c, L.x[7], L.y[r], L.x[8] - L.x[7], ls, th, fs, lh, sq); });
  }
  function drawWeek(c, L, from) {
    const days = span(from, 7), lh = 1.32;
    const floors = WPS().map((wp, p) => {
      const [x, y0, y1] = L.week[p], cells = days.map(ds => dayLines(ds, wp, A.parse(ds).getDate()));
      return { wp, x, y0, h: y1 - y0, cells, night: x.length === 9 ? nightLines(days, wp) : [] };
    });
    // 세 층 글자 크기는 같게, 빽빽한 칸은 줄 간격을 좁혀서 맞춰요
    const fs = Math.min(...floors.map(f => fitSize([...f.cells, f.night], f.h, L.fs, 1.12)));
    floors.forEach(({ wp, x, y0, h, cells, night }) => {
      const th = pale(wp), sq = squeeze([...cells, night], h, fs, lh);
      cells.forEach((ls, i) => drawCell(c, x[i], y0, x[i + 1] - x[i], ls, th, fs, lh, sq));
      if (night.length) drawCell(c, x[7], y0, x[8] - x[7], night, th, fs, lh, sq);
    });
  }

  // 옵션 { scope:'2w'|'1w'|'1d', fmt:'story'|'post', wp, ds, fonts? } → 캔버스. 일정은 미리 불러 둔 뒤 불러요
  async function render(o) {
    const key = keyOf(o), L = LAYOUT[key], [W, H] = SIZE[o.fmt], title = titleOf(o), [from, to] = rangeOf(o);
    const days = span(from, Math.round((A.parse(to) - A.parse(from)) / 864e5) + 1);
    const names = days.flatMap(ds => WPS().flatMap(w => { const d = A.store.day(ds, w); return [...d.shifts.map(s => s.name), ...nightOf(d).map(m => m.name), d.event || '']; })).join('');
    const fonts = o.fonts || FONT;
    const [img] = await Promise.all([imageOf(key), fontsFor(`${title}${names}층데빌메이드마츠리휴무폐업게스트주간야간0123456789/·`, fonts)]);
    F = fonts;
    const cv = document.createElement('canvas'); cv.width = W * SCALE; cv.height = H * SCALE;
    const c = cv.getContext('2d');
    c.scale(SCALE, SCALE); c.imageSmoothingQuality = 'high';
    c.drawImage(img, 0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const [tx, ty, tw, th, tc] = L.title;
    let tf = Math.min(54, Math.round(th * .62));
    do c.font = fontOf(F.title, tf); while (c.measureText(title).width > tw - 48 && --tf > 24);
    c.fillStyle = tc; c.fillText(title, tx + tw / 2, ty + th / 2, tw - 32);
    if (L.labels) {
      c.font = fontOf(F.body, L.labels[0][3] * .86);
      WPS().forEach((wp, i) => { const [x, y, w, h] = L.labels[i]; c.fillStyle = TH[wp].ac; c.fillText(`${A.floorOf(wp)} ${wp}`, x + w / 2, y + h / 2, w - 12); });
    }
    if (o.scope === '2w') drawTwoWeeks(c, L, o, from);
    else if (o.scope === '1w') drawWeek(c, L, from);
    else WPS().forEach((wp, i) => drawPanel(c, L.panels[i], wp, o.ds, L.fs));
    return cv;
  }

  // 미리보기: 큰 캔버스를 한 번에 줄이면 거칠어서 반씩 줄여요
  const thumb = (cv, w) => {
    let cur = cv;
    while (cur.width / 2 >= w) {
      const n = document.createElement('canvas'); n.width = cur.width >> 1; n.height = cur.height >> 1;
      const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, n.width, n.height);
      cur = n;
    }
    return cur;
  };

  const FILE_SCOPE = { '2w': '2주', '1w': '1주', '1d': '1일' }, FILE_FMT = { story: '스토리', post: '게시글' };
  const fileName = o => { const [from] = rangeOf(o), d = A.parse(from); return `출근표_${FILE_SCOPE[o.scope]}${o.scope === '2w' ? `_${o.wp}` : ''}_${d.getMonth() + 1}월${d.getDate()}일_${FILE_FMT[o.fmt]}.png`; };

  function open() {
    const st = { scope: '2w', fmt: 'story', wp: WPS()[0], ds: A.today() };
    let alive = true, busy = false, seq = 0, png = null;
    const seg = (k, items) => `<div class="seg" role="group" data-k="${k}">${items.map(([v, l]) => `<button data-v="${v}" class="${st[k] === v ? 'on' : ''}" aria-pressed="${st[k] === v}">${l}</button>`).join('')}</div>`;
    const stepOf = () => (st.scope === '1d' ? 1 : 7);
    const rangeLabel = () => { const [a, b] = rangeOf(st); return st.scope === '1d' ? A.fmt(a) : `${A.fmtShort(a)} – ${A.fmtShort(b)}`; };
    const controls = () => `${seg('scope', [['2w', '2주'], ['1w', '1주'], ['1d', '1일']])}${seg('fmt', [['story', '스토리'], ['post', '게시글']])}
      ${st.scope === '2w' ? `<div class="chips cp-chips" role="group" aria-label="매장">${A.FLOORS.map(([w]) => { const t = A.THEMES[w]; return `<button class="chip${w === st.wp ? ' on' : ''}" data-w="${w}" aria-pressed="${w === st.wp}" style="--c:${t.c};--cs:${t.cs};--ci:${t.ci}"><img src="${A.logo(w)}" alt=""><span class="ct"><b>${A.esc(w)}</b></span></button>`; }).join('')}</div>` : ''}
      <div class="ex-date"><button class="ex-nav prev" data-step="-1" aria-label="이전">${A.ICON.chev}</button><b>${A.esc(rangeLabel())}</b><button class="ex-nav" data-step="1" aria-label="다음">${A.ICON.chev}</button></div>`;
    const draw = async () => {
      const el = s.el, ctl = el.querySelector('.ex-ctl'), box = el.querySelector('.ex-prev'), btn = el.querySelector('.sheet-a .primary'), me = ++seq;
      ctl.innerHTML = controls();
      ctl.querySelectorAll('[data-k] button').forEach(b => b.onclick = () => { st[b.parentElement.dataset.k] = b.dataset.v; draw(); });
      ctl.querySelectorAll('[data-w]').forEach(b => b.onclick = () => { st.wp = b.dataset.w; draw(); });
      ctl.querySelectorAll('[data-step]').forEach(b => b.onclick = () => { st.ds = addDays(st.ds, b.dataset.step * stepOf()); draw(); });
      png = null; btn.disabled = true;
      box.innerHTML = '<div class="tl-load"><span class="spin"></span></div>';
      const [from, to] = rangeOf(st), ok = await A.store.ensure(from, to);
      if (!alive || me !== seq) return;
      if (!ok) { box.innerHTML = A.emptyBox('cal', '불러오지 못했어요', '시트를 닫고 다시 열어 주세요'); return; }
      try {
        const cv = await render(st);
        if (!alive || me !== seq) return;
        // 공유는 누른 직후에 불러야 해서 PNG 는 미리 만들어 둬요
        png = new Promise(r => cv.toBlob(r, 'image/png'));
        box.replaceChildren(thumb(cv, box.clientWidth * (window.devicePixelRatio || 1))); btn.disabled = false;
      } catch (e) {
        if (alive && me === seq) box.innerHTML = A.emptyBox('cal', '이미지를 만들지 못했어요', (e && e.message) || '');
      }
    };
    const save = async (close, el) => {
      if (busy || !png) return;
      const btn = el.querySelector('.sheet-a .primary'), label = btn.textContent;
      busy = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = '만드는 중…';
      try {
        const blob = await png;
        if (!blob) throw new Error('이미지를 만들지 못했어요');
        await A.capture.deliver(blob, fileName(st));
      } catch (e) {
        A.toast('이미지를 저장하지 못했어요: ' + ((e && e.message) || e), true);
      } finally {
        busy = false; btn.removeAttribute('aria-busy'); btn.textContent = label;
      }
    };
    const s = A.sheet({
      title: '출근표 이미지',
      html: '<div class="ex-ctl"></div><div class="ex-prev"></div>',
      actions: [{ label: '이미지 저장하기', kind: 'primary', onClick: save }],
      onClose: () => { alive = false; },
    });
    draw();
    return s;
  }

  A.exportImg = { open, render };
}
