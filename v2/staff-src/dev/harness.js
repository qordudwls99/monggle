// __V2_DEV_HARNESS__ : 개발 빌드(--dev)에만 들어가요. 운영 v2/staff.html 에 들어가면 build.mjs 가 멈춰요.
// - 쓰기(rpc, from().insert/update/upsert/delete, functions, storage)는 모두 막고 window.__calls 에 남겨요 (토큰·PIN 가림).
// - 읽기(뷰 select, staff_directory)는 실서버 그대로. 관리자·내 정보 읽기 RPC 는 가짜 값.
// - ?as=admin|staff|out 으로 가짜 세션(tk_dev)을 심어요. &id=<직원 id> &name=<이름> &temp=1 (임시 PIN) &fail=stale (토큰 죽음 흉내)
// - &db=old : v2 DB 함수(supabase-v2.sql)와 admin_guest_to_staff 가 실서버처럼 '없는 함수' 오류. 기본은 v2 DB 가 있는 것처럼 가짜 값
// - 가짜 로그인: 이름 '없는사람' → 빈 결과, PIN 000000 → 틀린 PIN 문구, 그 밖은 성공 (이름에 '관리'가 있으면 관리자)
{
  const A = window.App;
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) {
    document.body.textContent = 'dev build: localhost only';
    throw new Error('dev harness refused to run on ' + location.hostname);
  }
  const q = new URLSearchParams(location.search);
  const FAIL_STALE = q.get('fail') === 'stale';
  const KEY = 'shift_session';

  // ── 가짜 세션 ──
  const as = q.get('as');
  if (as === 'out') localStorage.removeItem(KEY);
  else if (as === 'admin' || as === 'staff') {
    localStorage.setItem(KEY, JSON.stringify({
      id: +(q.get('id') || (as === 'admin' ? 900001 : 900002)),
      name: q.get('name') || (as === 'admin' ? '개발관리자' : '개발직원'),
      is_admin: as === 'admin', avatar: null, pin: 'tk_dev', pin_temp: q.get('temp') === '1',
    }));
  }

  // ── 기록 ──
  const calls = window.__calls = [];
  const SECRET = new Set(['p_pin', 'p_new_pin', 'token']);
  const redact = v => {
    if (Array.isArray(v)) return v.map(redact);
    if (v && typeof v === 'object' && !(v instanceof Blob)) {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = SECRET.has(k) ? '[redacted]' : redact(x);
      return o;
    }
    return v;
  };
  let blockedAt = 0;
  const log = (fn, args) => { blockedAt = Date.now(); calls.push({ fn, args: redact(args ?? null), at: Date.now() }); console.info('[dev] blocked', fn); };
  const ok = data => Promise.resolve({ data, error: null, status: 200 });
  const stale = () => Promise.resolve({ data: null, error: { message: 'P0001: PIN이 올바르지 않습니다' }, status: 400 });

  const supa = A.supa;
  const realRpc = supa.rpc.bind(supa);
  const realFrom = supa.from.bind(supa);
  const realStorage = supa.storage;
  const me = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  let nextId = 990000;

  // 쓰기 RPC 가 돌려줄 값: 새 id 가 필요한 것, 개수를 돌려주는 것, 나머지는 true
  const ID_FNS = new Set(['admin_add_staff', 'admin_add_shift', 'admin_add_night_member', 'admin_add_night_q', 'request_sub', 'add_swap_comment']);
  const COUNT_FNS = {
    submit_shift: a => (a.p_answers || []).length,
    admin_assign_from_submission: a => (a.p_staff_ids || []).length,
    admin_set_default_pin: () => 3,
  };

  // v2 DB 함수: 실서버에는 아직 없어요(2026-10-28). &db=old 로 그 상태를 흉내 내요
  const DB_OLD = q.get('db') === 'old';
  const V2_FNS = new Set(['my_notifications', 'mark_my_notifications_read', 'admin_reset_pin', 'admin_remind_submission']);
  const missing = fn => Promise.resolve({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` }, status: 404 });
  const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
  const SAMPLE_NOTI = () => [
    { id: 7003, kind: 'swap_taken', title: '대타가 정해졌어요', body: '10월 31일 데빌 근무를 미오님이 맡아요', link: { tab: 'mine', date: '2026-10-31', workplace: '데빌', request_id: 1 }, created_at: ago(1), read_at: null },
    { id: 7002, kind: 'application_approved', title: '지원이 수락됐어요', body: '11월 1일 메이드 빈 자리에 들어가요', link: { tab: 'schedule', date: '2026-11-01', workplace: '메이드', app_id: 1 }, created_at: ago(20), read_at: null },
    { id: 7001, kind: 'schedule_published', title: '11월 스케줄이 공개됐어요', body: '내 근무를 확인해 주세요', link: { tab: 'schedule', ym: '2026-11' }, created_at: ago(50), read_at: ago(40) },
  ];

  supa.rpc = (fn, args = {}, opts) => {
    if (fn === 'admin_guest_to_staff') return missing(fn);                  // 저장소 SQL 에만 있고 실서버에는 없음
    if (DB_OLD && V2_FNS.has(fn)) return missing(fn);
    if (fn === 'my_notifications') return FAIL_STALE ? stale() : ok(SAMPLE_NOTI());
    if (fn === 'staff_directory') return realRpc(fn, args, opts);            // 공개 읽기
    if (fn === 'admin_staff_directory') {
      if (FAIL_STALE) return stale();
      return Promise.resolve(realRpc('staff_directory')).then(r => r.error ? r : {
        data: (r.data || []).map((s, i) => ({ ...s, has_pin: i % 6 !== 5, locked: i % 9 === 4, pin_temp: i % 7 === 3 })), error: null, status: 200 });
    }
    if (fn === 'my_profile') {
      if (FAIL_STALE) return stale();
      const s = me() || {};
      return ok({ name: s.name || '', instagram: '', avatar_url: s.avatar || null, is_admin: !!s.is_admin });
    }
    if (fn === 'my_submission') return FAIL_STALE ? stale() : ok([]);
    if (fn === 'staff_signin') {
      log(fn, args);
      const name = String(args.p_name || '').trim();
      if (!name || name === '없는사람') return ok([]);
      if (args.p_pin === '000000') return ok([{ err: 'PIN이 틀렸어요. (남은 시도 4회)' }]);
      return ok([{ id: 900003, name, is_admin: name.includes('관리'), avatar_url: null, pin_temp: q.get('temp') === '1', token: 'tk_dev', err: null }]);
    }
    log(fn, args);
    if (fn === 'staff_signout') return ok(null);
    if (FAIL_STALE) return stale();
    if (ID_FNS.has(fn)) return ok(++nextId);
    if (COUNT_FNS[fn]) return ok(COUNT_FNS[fn](args));
    if (fn === 'admin_reset_pin') return ok('482913');                       // 가짜 임시 PIN
    if (fn === 'admin_remind_submission') return ok(9);
    if (fn === 'mark_my_notifications_read') return ok((args.p_ids || [1, 2]).length);
    return ok(true);
  };

  // 표 읽기는 그대로, 표 쓰기는 막기
  const TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
  supa.from = table => new Proxy(realFrom(table), {
    get(t, k) {
      if (TABLE_WRITES.has(k)) return (...a) => { log(`from:${table}.${k}`, a[0]); return ok(null); };
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });

  // 엣지 함수: 모두 막기 (getter 라서 인스턴스에 덮어씀)
  const fakeFunctions = { invoke: (name, opts = {}) => { log(`functions.invoke:${name}`, opts.body); return ok({ ok: true }); } };
  Object.defineProperty(supa, 'functions', { configurable: true, get: () => fakeFunctions });

  // 저장소: 공개 주소 만들기만 그대로, 올리기·지우기 등은 막기
  const fakeStorage = {
    from(bucket) {
      const b = realStorage.from(bucket);
      return {
        getPublicUrl: (...a) => b.getPublicUrl(...a),
        upload: (path, blob, o) => { log(`storage.upload:${bucket}`, { path, size: blob && blob.size, contentType: o && o.contentType }); return ok({ path }); },
        update: path => { log(`storage.update:${bucket}`, { path }); return ok({ path }); },
        remove: paths => { log(`storage.remove:${bucket}`, { paths }); return ok([]); },
        move: (a, b2) => { log(`storage.move:${bucket}`, { from: a, to: b2 }); return ok(null); },
        copy: (a, b2) => { log(`storage.copy:${bucket}`, { from: a, to: b2 }); return ok(null); },
      };
    },
  };
  Object.defineProperty(supa, 'storage', { configurable: true, get: () => fakeStorage });

  // 표시
  document.body.insertAdjacentHTML('beforeend', '<div id="devLabel" style="position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:200;background:#d92d20;color:#fff;font:700 10px/1.2 system-ui,sans-serif;padding:2px 8px 3px;border-radius:0 0 8px 8px;pointer-events:none">DEV · 쓰기 차단</div>');

  // 막힌 쓰기 바로 뒤의 성공 알림에는 '실제로는 저장 안 됨'을 붙여요 (진짜 저장된 줄 알고 헷갈리지 않게)
  queueMicrotask(() => {
    const t0 = A.toast;
    if (t0) A.toast = (msg, err) => t0(!err && msg && Date.now() - blockedAt < 5000 ? `${msg} · 테스트 화면이라 실제로는 저장 안 됐어요` : msg, err);
  });

  // 임시 스케줄 화면: 진짜 스케줄 화면(10-day.js)이 없을 때만. store.ensure + day() 가 실데이터를 주는지 보는 용도
  queueMicrotask(() => {
    if (A.screens && A.screens.schedule) return;
    A.screen('schedule', {
      async render(el) {
        const S = A.state, ds = A.ymd(S.date);
        await A.store.ensure(ds, ds);
        const row = p => `<div class="lrow">${A.avatar(p)}<span class="lm"><span class="lt">${A.esc(p.name || '빈 자리')}</span><span class="ls">${[p.guest ? '게스트' : '', p.status === 'seeking_sub' ? '대타 구하는 중' : '', p.short ? '부족' : '', p.applicants ? `신청 ${p.applicants.length}명` : ''].filter(Boolean).join(' · ')}</span></span></div>`;
        let html = A.pageHead('임시 스케줄', `개발용 화면 · ${A.fmt(ds)}`) +
          `<div class="tools"><button class="btn sm" data-d="-1">이전 날</button><button class="btn sm" data-d="0">오늘</button><button class="btn sm" data-d="1">다음 날</button></div>`;
        A.FLOORS.forEach(([wp, fl]) => {
          const d = A.store.day(ds, wp);
          html += `<section class="sec"><div class="sec-h"><h2>${fl} ${A.esc(wp)}</h2><span class="aside">${d.draft ? '작성 중 · ' : ''}${d.closed ? '휴무' : `${d.shifts.length}명`}</span></div>` +
            (d.event ? `<p class="sheet-p">이벤트 ${A.esc(d.event)}</p>` : '') +
            d.shifts.map(row).join('') + d.slots.map(row).join('') +
            (d.night ? `<p class="sheet-p">야간 ${A.esc(d.night.hours)}</p>${d.night.members.map(row).join('')}` : '') + '</section>';
        });
        el.innerHTML = html;
        el.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
          const k = +b.dataset.d;
          if (k === 0) S.date = A.parse(A.today()); else { const x = new Date(S.date); x.setDate(x.getDate() + k); S.date = x; }
          A.render();
        });
      },
    });
  });
}
