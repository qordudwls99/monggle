// 읽기 저장소: 스케줄은 달 단위로 모아 두고(ensure → day 는 바로 읽기), 나머지는 부를 때마다 새로 읽어요.
// 뷰·열·조건은 운영 staff.html 그대로 (.ui-design/v2-plan/staff-inventory.md §1.2). 쓰기 뒤에는 invalidate….
{
  const A = window.App;
  const coll = new Intl.Collator('ko');
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const ymOf = ds => String(ds).slice(0, 7);
  const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };
  const monthsIn = (from, to) => {
    const out = [], last = ymOf(to);
    let [y, m] = ymOf(from).split('-').map(Number);
    for (let i = 0; i < 240; i++) {
      const ym = `${y}-${pad(m)}`; out.push(ym);
      if (ym >= last) break;
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  };
  const isAdmin = () => !!(A.session && A.session.is_admin);
  // 게스트 먼저, 그다음 이름 (가나다)
  const byGuestFirst = (a, b) => ((b.guest ? 1 : 0) - (a.guest ? 1 : 0)) || coll.compare(a.name || '', b.name || '');
  let lastFail = 0;
  const failToast = () => { const t = Date.now(); if (t - lastFail < 3000) return; lastFail = t; A.toast('불러오지 못했어요. 당겨서 새로고침해 주세요', true); };

  // ── 모양 맞추기 ──
  // Shift: empty = 직원도 게스트도 없는 줄 (빈 자리 / 부족). status 'seeking_sub' = 대타 구하는 중
  // gname = 명단에 없는 이름으로 넣은 줄. guest = 손님 페이지에 '게스트'로 보이는지 (표시를 끄면 gname 이어도 false)
  // showGuest: DB 에 show_guest 칸이 있을 때만 true/false, 없으면 null (supabase-v2-guest-label.sql 적용 전)
  const showGuestOf = r => { if (!('show_guest' in r)) return null; A.guestLabel = true; return r.show_guest !== false; };
  // start_time 칸이 있을 때만 A.shiftTime (supabase-v2-shift-time.sql 적용 전엔 근무 시간 바꾸기를 숨겨요)
  const shiftTimeOf = r => { if ('start_time' in r) A.shiftTime = true; return r; };
  const toShift = r => {
    const guestName = r.guest_name || null;
    const empty = r.staff_id == null && !guestName;
    return {
      gname: !empty && r.staff_id == null, showGuest: showGuestOf(r),
      id: r.id, date: r.work_date, wp: r.workplace,
      name: empty ? '' : (r.display_name || r.staff_name || guestName || ''),
      staffId: r.staff_id ?? null,
      guest: !empty && (r.is_guest != null ? !!r.is_guest : r.staff_id == null),
      insta: r.staff_instagram || null, avatar: r.staff_avatar || null,
      start: r.start_time || '', end: r.end_time || '', memo: r.memo || '',
      status: r.status || 'confirmed', empty,
    };
  };
  // Night: short = 이름 '부족' + 직원 없음 (자리 표시)
  const toNight = r => {
    const short = r.member_name === '부족' && r.staff_id == null;
    return {
      gname: !short && r.staff_id == null, showGuest: showGuestOf(r),
      id: r.id, date: r.work_date, wp: r.workplace, name: r.member_name || '',
      staffId: r.staff_id ?? null, guest: !short && (r.is_guest != null ? !!r.is_guest : r.staff_id == null),
      insta: r.instagram || null, avatar: r.avatar || null, short,
      start: shiftTimeOf(r).start_time || '', end: r.end_time || '',
    };
  };
  const toSwap = r => ({
    id: r.id, shiftId: r.shift_id, status: r.status, reason: r.reason || '', createdAt: r.created_at,
    requesterId: r.requester_id, requesterName: r.requester_name || '',
    takerId: r.taker_id ?? null, takerName: r.taker_name || '',
    date: r.work_date, wp: r.workplace, start: r.start_time || '', end: r.end_time || '',
  });

  // ── 상태(공개·제출) ──
  let statusMap = new Map(), statusP = null;
  function loadStatus({ cached = false } = {}) {
    if (cached && statusP) return statusP;
    const p = statusP = (async () => {
      const { data, error } = await A.supa.from('schedule_status_view').select('*');
      if (error) { if (statusP === p) statusP = null; failToast(); return false; }
      statusMap = new Map((data || []).map(r => [r.ym, { published: r.published !== false, submit_open: !!r.submit_open }]));
      return true;
    })();
    return p;
  }
  // 줄이 없는 달 = 공개 + 제출 닫힘
  const status = ym => ({ ...(statusMap.get(ym) || { published: true, submit_open: false }) });
  const isDraft = ds => status(ymOf(ds)).published === false;
  const openMonths = () => [...statusMap].filter(([, v]) => v.submit_open).map(([k]) => k).sort();

  // ── 직원 목록 (관리자는 admin_staff_directory, 실패하면 공개 목록) ──
  let staff = [], dirP = null;
  function directory({ fresh = false } = {}) {
    if (fresh) dirP = null;
    if (dirP) return dirP;
    const p = dirP = (async () => {
      const s = A.session;
      let r = null;
      if (s && s.is_admin) r = await A.api.direct('admin_staff_directory', { p_admin_id: s.id, p_pin: s.pin });
      if (!r || r.error) r = await A.api.direct('staff_directory');
      if (r.error) { if (dirP === p) dirP = null; failToast(); return staff; }
      staff = (r.data || []).map(x => ({ ...x }))
        .sort((a, b) => ((b.is_admin ? 1 : 0) - (a.is_admin ? 1 : 0)) || coll.compare(a.name || '', b.name || ''));
      return staff;
    })();
    return p;
  }

  // ── 달 단위 스케줄 ──
  const months = new Map();   // ym -> {p, data}
  async function loadMonth(ym) {
    const from = `${ym}-01`, to = monthEnd(ym);
    const range = v => A.supa.from(v).select('*').gte('work_date', from).lte('work_date', to);
    const res = await Promise.all([
      range('shift_view').order('work_date').order('workplace').order('start_time'),
      range('closure_view'), range('night_view'), range('day_event_view'),
      range('night_member_view'), range('application_view'),
    ]);
    const bad = res.find(r => r.error);
    if (bad) throw bad.error;
    const [sh, cl, ni, ev, nm, ap] = res.map(r => r.data || []);
    const d = { shifts: new Map(), closed: new Set(), nights: new Map(), events: new Map(), members: new Map(), apps: new Map() };
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const key = r => r.work_date + '|' + r.workplace;
    sh.forEach(r => push(d.shifts, key(r), toShift(r)));
    cl.forEach(r => d.closed.add(key(r)));
    ni.forEach(r => d.nights.set(key(r), r.hours));
    ev.forEach(r => { if (r.event) d.events.set(key(r), r.event); });
    nm.forEach(r => push(d.members, key(r), toNight(r)));
    ap.forEach(r => push(d.apps, r.shift_id, { appId: r.id, staffId: r.applicant_id, name: r.applicant_name || '' }));
    return d;
  }
  // from~to 의 달을 모두 읽어 둬요 (+ 공개 상태, 직원 목록). 다 되면 true, 하나라도 실패하면 false
  async function ensure(from, to = from) {
    if (from > to) [from, to] = [to, from];
    const jobs = monthsIn(from, to).map(ym => {
      let e = months.get(ym);
      if (!e) {
        e = { p: null, data: null };
        months.set(ym, e);
        const mine = e;
        e.p = loadMonth(ym).then(
          d => { if (months.get(ym) === mine) mine.data = d; return true; },
          err => { console.warn('store: month load failed', ym, err && err.message); if (months.get(ym) === mine) months.delete(ym); failToast(); return false; });
      }
      return e.p;
    });
    jobs.push(loadStatus({ cached: true }), directory());
    const r = await Promise.all(jobs);
    return r.every(x => x !== false);
  }
  // 바로 읽기 (ensure 뒤). 관리자가 아니면 공개 전 달은 비워서 줘요 (draft:true 만 남김).
  function day(ds, wp) {
    const key = ds + '|' + wp, e = months.get(ymOf(ds)), d = e && e.data;
    const draft = isDraft(ds);
    const blank = { ds, wp, closed: false, event: null, shifts: [], slots: [], night: null, draft };
    if (!d || (draft && !isAdmin())) return blank;
    if (d.closed.has(key)) return { ...blank, closed: true };
    const all = d.shifts.get(key) || [];
    const shifts = all.filter(s => !s.empty).sort(byGuestFirst);
    const slots = all.filter(s => s.empty).map(s => ({ ...s, applicants: (d.apps.get(s.id) || []).slice() }));
    const hours = d.nights.get(key);
    const night = hours ? {
      hours,
      members: (d.members.get(key) || []).slice().sort((a, b) => ((a.short ? 1 : 0) - (b.short ? 1 : 0)) || byGuestFirst(a, b)),
    } : null;
    return { ds, wp, closed: false, event: d.events.get(key) || null, shifts, slots, night, draft };
  }
  function invalidate(from, to = from) {
    if (from > to) [from, to] = [to, from];
    monthsIn(from, to).forEach(ym => months.delete(ym));
  }
  function invalidateAll() { months.clear(); statusP = null; dirP = null; }

  // ── 화면별 읽기 (캐시 없음) ──
  // 대타: {status:'open'|'completed'|…, requesterId, shiftId, since(ISO), limit}. open 은 근무일 순, 그 밖은 최근 글 순
  async function swaps({ status: st, requesterId, shiftId, since, limit } = {}) {
    let q = A.supa.from('swap_view').select('*');
    if (st) q = q.eq('status', st);
    if (requesterId != null) q = q.eq('requester_id', requesterId);
    if (shiftId != null) q = q.eq('shift_id', shiftId);
    if (since) q = q.gte('created_at', since);
    q = st === 'open' ? q.order('work_date').order('start_time') : q.order('created_at', { ascending: false });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) { failToast(); return []; }
    return (data || []).map(toSwap);
  }
  // 댓글: {요청 id: [댓글…]} (오래된 순)
  async function comments(ids = []) {
    const out = {};
    ids = [...new Set(ids)].filter(x => x != null);
    if (!ids.length) return out;
    const { data, error } = await A.supa.from('swap_comment_view').select('*').in('request_id', ids).order('created_at');
    if (error) { failToast(); return out; }
    (data || []).forEach(r => (out[r.request_id] = out[r.request_id] || []).push({
      id: r.id, requestId: r.request_id, authorId: r.author_id, authorName: r.author_name || '',
      avatar: r.avatar || null, body: r.body || '', createdAt: r.created_at,
    }));
    return out;
  }
  // 내 근무: 오늘부터, 주간(Shift, night:false) + 야간(Night, night:true), 공개된 달만, 날짜 순
  async function myShifts() {
    const s = A.session;
    if (!s) return [];
    const today = ymd(new Date());
    const [sh, nm, st] = await Promise.all([
      A.supa.from('shift_view').select('*').eq('staff_id', s.id).gte('work_date', today).order('work_date').order('start_time'),
      A.supa.from('night_member_view').select('*').eq('staff_id', s.id).gte('work_date', today).order('work_date'),
      loadStatus({ cached: true }),
    ]);
    if (sh.error || nm.error || st === false) { failToast(); return []; }   // 공개 상태를 모르면 공개 전 달이 섞일 수 있어요
    return [
      ...(sh.data || []).map(r => ({ ...toShift(r), night: false })),
      ...(nm.data || []).map(r => ({ ...toNight(r), night: true })),
    ].filter(x => !isDraft(x.date))
      .sort((a, b) => a.date.localeCompare(b.date) || ((a.night ? 1 : 0) - (b.night ? 1 : 0)) || String(a.start || '').localeCompare(String(b.start || '')));
  }
  // 내 제출: {qkey: choice} ('d:YYYY-MM-DD' → '메이드'…, 'n:<id>' → '가능'|'불가능')
  async function submission(ym) {
    const s = A.session;
    if (!s) return {};
    const r = await A.api.direct('my_submission', { p_staff_id: s.id, p_pin: s.pin, p_ym: ym });
    const map = {};
    if (r.error) { if (A.session) A.toast(r.text, true); return map; }
    (Array.isArray(r.data) ? r.data : []).forEach(a => { if (a && a.qkey) map[a.qkey] = a.choice; });
    return map;
  }
  // 야간 문항: 날짜 → sort → id 순
  async function nightQuestions(ym) {
    const { data, error } = await A.supa.from('submission_night_view').select('*').eq('ym', ym);
    if (error) { failToast(); return []; }
    return (data || []).map(n => ({ id: n.id, ym: n.ym, label: n.label || '', sort: n.sort, wp: n.workplace, date: n.work_date, hours: n.hours || '' }))
      .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (a.sort - b.sort) || (a.id - b.id));
  }
  // 모두의 제출 답 (관리자 화면용; 뷰는 공개)
  async function answers(ym) {
    const { data, error } = await A.supa.from('submission_answer_view').select('*').eq('ym', ym);
    if (error) { failToast(); return []; }
    return (data || []).map(a => ({ staffId: a.staff_id, staffName: a.staff_name || '', ym: a.ym, qkey: a.qkey, choice: a.choice }));
  }

  A.store = {
    ensure, day, isDraft, status, loadStatus, openMonths, directory, staff: () => staff,
    invalidate, invalidateAll, swaps, comments, myShifts, submission, nightQuestions, answers,
  };
}
