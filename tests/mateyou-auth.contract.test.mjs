import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('브라우저는 PIN 세션 대신 custom:mateyou OAuth를 사용한다', async () => {
  const html = await read('staff.html');

  assert.match(html, /provider:\s*'custom:mateyou'/);
  assert.match(html, /flowType:\s*'pkce'/);
  assert.doesNotMatch(html, /session\.pin/);
  assert.doesNotMatch(html, /localStorage\.setItem\(['"]shift_session/);
  assert.doesNotMatch(html, /supa\.rpc\(['"]staff_login/);

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML id는 중복되면 안 됩니다');
  for (const id of ['loginModal', 'linkModal', 'accessModal', 'myModal']) {
    assert.ok(ids.includes(id), `${id}가 있어야 합니다`);
  }
});

test('DB 인증 경계는 auth.uid 연결과 Partner+를 서버에서 확인한다', async () => {
  const sql = await read('supabase-mateyou-auth.sql');

  assert.match(sql, /where p\.user_id = auth\.uid\(\)/);
  assert.match(sql, /create or replace function public\._require_partner_plus/);
  for (const action of [
    'request_sub',
    'accept_sub',
    'claim_shift',
    'apply_slot',
    'submit_shift',
    'add_swap_comment',
  ]) {
    const start = sql.indexOf(`function public.${action}`);
    assert.notEqual(start, -1, `${action} 함수가 있어야 합니다`);
    const body = sql.slice(start, start + 2_500);
    assert.match(body, /perform public\._require_partner_plus\(\)/);
  }

  assert.match(sql, /revoke all privileges on function public\.staff_login/);
  assert.match(sql, /revoke select on public\.application_view/);
  assert.match(sql, /revoke select on public\.submission_answer_view/);
  assert.match(sql, /pin = null,\s+pin_temp = false/);
  assert.match(sql, /function public\.admin_unlink_staff/);
});

test('entitlement 동기화는 로그인 사용자를 검증하고 서비스 토큰을 서버에서만 쓴다', async () => {
  const edge = await read('supabase-functions/sync-mateyou-entitlements/index.ts');

  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /MATEYOU_ENTITLEMENT_SERVICE_TOKEN/);
  assert.match(edge, /mateyou_profiles/);
  assert.match(edge, /MONGGLE_ALLOWED_ORIGINS/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin['"]:\s*['"]\*['"]/);
});

test('푸시 함수도 호출자와 최신 Partner+ 자격을 확인한다', async () => {
  const edge = await read('supabase-functions/notify/index.ts');

  assert.match(edge, /auth\.getUser\(\)/);
  assert.match(edge, /is_partner_plus/);
  assert.match(edge, /entitlement_checked_at/);
  assert.doesNotMatch(edge, /Access-Control-Allow-Origin['"]:\s*['"]\*['"]/);
});
