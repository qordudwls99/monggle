// 게스트 → 직원 바꾸기 (운영 staff.html 2268-2304 를 옮김. 실서버에 admin_guest_to_staff 가 없어서 여러 번 불러요)
// 1) 같은 이름 직원 찾기, 없으면 admin_add_staff (PIN 은 비워 둘 수 있음) 뒤 직원 목록 다시 읽어 id 찾기
// 2) 그 이름의 게스트 근무를 모두 admin_update_shift 로 직원에게
// 3) 게스트 야간 멤버: 직원을 먼저 넣고(admin_add_night_member) 성공하면 게스트를 빼요(admin_remove_night_member).
//    운영은 빼고 넣으면서 오류를 안 봐서, 넣기가 실패하면 야간 자리가 사라졌어요. 한 묶음 처리가 아니라 중간 실패는 요약에 남겨요.
{
  const A = window.App;

  // 여러 번 부르는 중에 또 실행하면 야간에 직원이 두 번 들어가요 → 하나씩만
  let converting = false;
  async function convert(name) {
    if (converting) { A.toast('게스트를 직원으로 바꾸는 중이에요'); return false; }
    converting = true;
    try { return await convertRun(name); } finally { converting = false; }
  }
  async function convertRun(name) {
    const g = String(name || '').trim();
    if (!g) { A.toast('게스트 이름이 없어요', true); return false; }
    if (!(await A.auth.require())) return false;

    // 바뀔 개수부터 읽어요 (공개 뷰)
    const [sh, nm] = await Promise.all([
      A.supa.from('shift_view').select('*').eq('guest_name', g),
      A.supa.from('night_member_view').select('*').eq('member_name', g),
      A.store.directory({ fresh: true }),
    ]);
    if (sh.error || nm.error) { A.toast('불러오지 못했어요. 다시 해 주세요', true); return false; }
    const shifts = (sh.data || []).filter(r => r.staff_id == null);
    const nights = (nm.data || []).filter(r => r.staff_id == null && (r.is_guest == null || r.is_guest));
    if (!shifts.length && !nights.length) { A.toast(`${g}님 이름으로 잡힌 게스트 근무가 없어요`, true); return false; }

    let st = A.store.staff().find(s => s.name === g);
    const what = [shifts.length ? `근무 ${shifts.length}개` : '', nights.length ? `야간 ${nights.length}개` : ''].filter(Boolean).join(', ');
    const ok = await A.confirm({
      title: '직원으로 바꾸기',
      text: st ? `게스트 ${g}님의 ${what}가 같은 이름의 직원 ${g}님에게로 옮겨 가요.`
               : `${g}님을 새 직원으로 만들고, 게스트 ${what}를 그 직원에게로 옮겨요.`,
      ok: '바꾸기',
    });
    if (!ok) return false;

    const admin = A.session && A.session.id;
    if (!st) {
      const pin = await A.prompt({
        title: 'PIN 정하기', text: `${g}님이 로그인할 때 쓸 숫자 6자리예요. 나중에 정하려면 비워 두세요.`,
        label: 'PIN', inputmode: 'numeric', maxlength: 6, placeholder: '숫자 6자리 (비워 두면 나중에)', ok: '다음',
        validate: v => (v && !/^\d{6}$/.test(v)) ? 'PIN은 숫자 6자리로 적어 주세요' : '',
      });
      if (pin === null) return false;
      const r = await A.api.rpc('admin_add_staff', { p_admin_id: admin, p_name: g, p_new_pin: pin || '', p_is_admin: false });
      if (r === false) return false;
      await A.store.directory({ fresh: true });
      st = A.store.staff().find(s => s.name === g);
      if (!st) { A.toast('직원을 만들지 못했어요. 직원 목록을 확인해 주세요', true); return false; }
    }
    const sid = st.id;
    A.toast('바꾸는 중…');

    // 2) 게스트 근무 → 직원
    let moved = 0, shiftFail = 0;
    for (const s of shifts) {
      if (!A.session) { shiftFail++; continue; }
      const r = await A.api.rpc('admin_update_shift', { p_admin_id: admin, p_shift_id: s.id, p_start: s.start_time || '', p_end: s.end_time || '', p_assignee: sid, p_guest: null }, { quiet: true });
      if (r === false) shiftFail++; else moved++;
    }
    // 3) 야간: 직원 넣기 → 성공했을 때만 게스트 빼기
    let nMoved = 0, addFail = 0;
    const leftover = [];
    for (const m of nights) {
      if (!A.session) { addFail++; continue; }
      const add = await A.api.rpc('admin_add_night_member', { p_admin_id: admin, p_date: m.work_date, p_workplace: m.workplace, p_staff_id: sid, p_name: null }, { quiet: true });
      if (add === false) { addFail++; continue; }
      const rem = await A.api.rpc('admin_remove_night_member', { p_admin_id: admin, p_id: m.id }, { quiet: true });
      if (rem === false) leftover.push(A.fmtShort(m.work_date)); else nMoved++;
    }

    A.store.invalidateAll();
    await A.render({ keep: true });
    const done = [shifts.length ? `근무 ${moved}개` : '', nights.length ? `야간 ${nMoved}개` : ''].filter(Boolean).join(', ');
    const bad = [
      shiftFail ? `근무 ${shiftFail}개` : '',
      addFail ? `야간 ${addFail}개` : '',
    ].filter(Boolean).join(', ');
    let msg = `${g}님을 직원으로 바꿨어요 (${done})`;
    if (bad) msg += ` · 못 옮긴 것: ${bad}`;
    if (leftover.length) msg += ` · 게스트 야간이 남았어요: ${leftover.join(', ')}`;
    A.toast(msg, !!(bad || leftover.length));
    return true;
  }

  A.guest = { convert };
}
