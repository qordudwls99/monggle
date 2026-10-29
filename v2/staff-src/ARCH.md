# v2 staff page: architecture and contract

`/v2/staff.html` rebuilds the redesigned staff page (prototype: `.ui-design/review-staff/proto/`) on the **real backend**. Production `/staff.html` and `/` stay untouched.

- Inventory of production behaviour: `.ui-design/v2-plan/staff-inventory.md`. It lists every RPC, view, storage and push call with `staff.html` line numbers. **Production `staff.html` is the behaviour contract.** Port its logic; never invent RPC names or params.
- Design rules: `.ui-design/system/DESIGN.md`. Builder rules from the prototype: `.ui-design/review-staff/proto/CONTRACT.md`.

## Files and build

```
v2/
  main.html                 customer page (done)
  staff.html                BUILD OUTPUT; never edit by hand
  assets/logo-{devil,maid,matsuri}.jpg
  staff-src/
    build.mjs               node v2/staff-src/build.mjs          -> v2/staff.html
                            node v2/staff-src/build.mjs --dev    -> .ui-design/v2-dev/staff.html (with dev/harness.js)
    head.html               <head> and the body shell (#app, #top, #screen, #tabbar, #toast)
    css/*.css               concatenated in name order into one <style>
    js/*.js                 concatenated in name order into one <script type="module">
    dev/harness.js          dev build only; must never reach v2/staff.html
```

- **One file at runtime.** The user wants a single HTML file. `build.mjs` inlines everything. It has no dependencies (Node 18+ stdlib only).
- **Every JS file is a block** (`{ … }`) so its top-level names stay private. Each file shares only through `window.App`. Only `js/00-config.js` may contain the `import` line, and the build hoists it to the top.
- **Asset paths:** logos are `assets/logo-*.jpg`, relative to `/v2/`. Icons and favicons are absolute (`/favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`). Include `<meta name="robots" content="noindex, nofollow">`. Do not link a manifest: an install from v2 would otherwise open the old app.
- **Service worker:** register `/sw.js`, the same as production. Push clicks still open `/staff.html`; that is acceptable for now.

## Globals (window.App)

| module | owns |
|---|---|
| `00-config.js` | `import {createClient}`, the `CONFIG` URL and anon key (copied from production `staff.html`; already public), `VAPID_PUBLIC`, `App.supa` |
| `01-api.js` | `App.api.rpc`, `App.api.direct`, `App.api.notify`, `App.api.uploadAvatar`, error text |
| `02-store.js` | `App.store` (cached reads, see below) |
| `03-core.js` | helpers, `App.sheet` / `App.confirm` / `App.prompt` / `App.toast`, tabs, `App.screen` / `App.view`, `App.render` with a sequence guard, hash deep link, pull-to-refresh, top bar, tab bar |
| `04-auth.js` | `App.session`, login sheet, `upgradeSession`, `pin_temp` forced change, logout, push banner, install bar |
| `10-day.js` | schedule shell (view switch, chips, date bar, calendar sheet) + 일별 + admin edit tools |
| `11-views.js` | 주간, 월간, 야간 |
| `12-capture.js` | 출근표 이미지 (html2canvas, share or download) |
| `13-drag.js` | desktop drag to move or delete (width ≥ 980, admin, 전체) |
| `20-swap.js`, `21-mine.js` | 대타 board with comments; 내 근무 |
| `22-bell.js`, `23-account.js` | bell sheet (admin derived items + personal notifications); 내 정보 (photo crop/upload, IG, PIN, push, logout) |
| `30-submit.js` | 시프트 제출 |
| `31-admin.js` | 관리: month status (submit open/close, publish), night questions with tallies, submission status, staff management, add staff, 근무 추가 form, bulk temp PIN |
| `32-admin-tools.js` | builder matrix, submission matrix, hope calendar, 근무일수, 야간 list, per-person answers, 희망자 배정 sheet |
| `34-guest.js` | guest → staff conversion |

## Session and auth (must match production exactly)

- **Session record.** `localStorage['shift_session']` holds JSON `{id, name, is_admin, avatar, pin, pin_temp}`.
  - `pin` holds the session token `tk_…`, never a PIN. Never log, print or display it.
  - Legacy sessions whose `pin` does not start with `tk_` go through `upgradeSession` via `staff_signin`, as production does.
- **Login.** Call `staff_signin(p_name, p_pin)` with the real 6-digit PIN typed by the user. The inventory §2 lists the results and the error texts:
  - empty array → "이름 또는 PIN이 올바르지 않아요"
  - `err` → show that text
  - `pin_temp` → force the 내 정보 PIN change.
- **Logout.** Call `staff_signout`, then remove the key.
- **Other storage keys** (same as production): `push_ask_dismiss`, `install_dismiss`, `noti_seen_ids`.
- **Anonymous use is allowed.** Schedule views and the 대타 board list work logged out. Actions open the login sheet. 내 근무 and 제출 show a login prompt. The top bar shows "로그인" when logged out and the avatar circle when logged in.
- **Stale sessions.** If an RPC error says the token is invalid ("PIN이 올바르지 않습니다" or similar), clear the session and ask to log in again. Production ignores this (bug).
- **`is_admin`.** It comes from the signin row. Admin UI is a convenience; the server enforces every `admin_*` RPC.

## `App.api`

- `rpc(fn, args, {ok, quiet})` mirrors production `rpc()` (staff.html 1072-1079):
  - No session → open the login sheet and return `false`.
  - Calls `supa.rpc(fn, {...args, p_pin: session.pin})`. The caller passes `p_staff_id` or `p_admin_id` = `session.id`, exactly as production does per RPC.
  - On error, toast `message.replace(/^.*?:\s*/, '')` and return `false`.
  - On success, toast `ok` if given and return `data ?? true`.
  - It does not re-render; screens call `App.store.invalidate…` and then `App.render({keep:true})`.
- `notify(body)` invokes the `notify` edge function, fire-and-forget like production, with `staff_id` and `token` added. Use only the bodies production uses until the v2 notify changes are deployed.
- `uploadAvatar(blob)` uses the `avatars` bucket with path `<id>-<Date.now()>.jpg` (JPEG, ≤1MB), then `set_my_avatar`.

## `App.store` (reads; all anon views unless noted)

Month-window cache. A render does `await App.store.ensure(from, to)` and then reads synchronously. Writes invalidate.

- `ensure(from, to)` loads, for the date range: `shift_view`, `closure_view`, `night_view`, `day_event_view`, `night_member_view`, and `application_view` (open applications). It also loads `schedule_status_view` once, plus the staff directory: `staff_directory`, or `admin_staff_directory` for admins.
- `day(ds, wp)` returns:
  ```
  {ds, wp, closed, event,
   shifts:[Shift], slots:[Shift & {applicants:[{appId, staffId, name}]}],
   night: {hours, members:[Night]} | null, draft}
  ```
  - `event` comes from `day_event_view`. Production's day view reads shift memo, which is a bug.
  - `hours` is the raw `night_view.hours` text and must be shown as is. Production stores free text such as `주간 16:00~23:00 · 야간 23:00~익일 05:00`. Never rewrite it from parsed selects unless the admin edits it.
- **`Shift`** = `{id, date, wp, name, staffId, guest, insta, avatar, start, end, memo, status, empty}`.
  - `empty` = no staff and no guest. That is an open slot, shown as 빈 자리 / 부족.
  - `status` `'seeking_sub'` = 대타 구하는 중.
- **`Night`** = `{id, date, wp, name, staffId, guest, insta, avatar, short}`. `short` = name '부족' with no staff, a placeholder.
- `isDraft(ds)` is true when the month is unpublished. `status(ym)` = `{published, submit_open}`; a month with no row = published and closed.
- **Hiding draft months.** Non-admins never see draft months in any view, including 내 근무 (production bug: 내 근무 leaked them).
- **Other reads:** `swaps({status})`, `comments(ids)`, `myShifts()` (day shifts and night memberships from today, published only), `submission(ym)`, `nightQuestions(ym)`, `answers(ym)`. Use the exact views and filters from inventory §1.2.

## Screens, views and rendering

- The registration API is the same as the prototype: `App.screen(key, {render(el)})` and `App.view(key, {title, isNow, now, step, render, chips})`. Render functions may be `async`.
- `App.render()` carries a sequence token. A render that finishes after a newer one has started must not touch the DOM (this fixes the production fast prev/next race).
- **Tabs:** 스케줄 · 대타 · 내 근무 · 제출, plus 관리 for admins. The bell is in the top bar (admins: derived items; everyone: personal notifications once the DB feature is live).
  - Hash deep links: `#schedule|swaps|mine|submit|admin`, with `#swaps` kept for production compatibility.
- **Weeks start on Sunday**, matching the approved customer v2. The default store filter is 전체.
- **Month navigation** uses `new Date(y, m+dir, 1)` (production setMonth bug fixed).
- **Week and month under 전체** show events and night members (production bug fixed).

## Behaviour decisions

Where the prototype and production differ, production wins unless a decision below or the user says otherwise.

- **PIN** is 6 digits everywhere. Changing it has no current-PIN field (`set_my_pin` takes no current PIN).
- **Submission**
  - Every day of the month is listed (as in production). Unselected days are **not** sent (as in production); the confirm copy says they stay empty. Night answers may stay blank (user, 2026-10-28).
  - The DB values are `'메이드'|'데빌'|'마츠리'|'상관없음'|'출근불가능'` for days and `'가능'|'불가능'` for nights.
- **Swaps**
  - A decided swap removes the owner's shift (user, 2026-10-28).
  - The deadline is 16:00 on the work date, computed on the client as production does.
- **휴무** deletes that day's shifts in production. Until the v2 DB change (non-destructive closure) is live, the confirm copy must say so.
- **Applying to empty slots** (`apply_slot` / `cancel_application`) is re-enabled; production had the UI disconnected. Verify that both RPCs exist live before shipping.
- **Every native `alert`/`prompt`/`confirm` is a sheet.**
- **Never** use yellow, gold or amber, gradients (except the Instagram glyph), emoji, or outlined destructive buttons. Use one primary per view or sheet. Floors are always 3층 데빌 → 2층 메이드 → 1층 마츠리.

## DB changes (approved in principle 2026-10-28; SQL must be shown and approved before applying)

These are drafted in `supabase-v2.sql` and `supabase-functions/notify`. **The client must work before and after they land.** Detect a missing RPC from its error and hide the dependent UI.

1. **Personal notifications.** A `staff_notifications` table with `my_notifications` / `mark_my_notifications_read` RPCs.
   - Rows are written by approve/reject application, `accept_sub` (to the requester), publish (to all staff), and an admin "다시 알림 보내기" for missing submitters.
   - Push goes to those staff through new `notify` event types whose recipients are resolved on the server.
2. **PIN reset.** `admin_reset_pin` returns a random one-time 6-digit temp PIN to the admin and sets `pin_temp`. The staff member must change it at next login.
3. **Non-destructive 휴무.** Turning a day off moves that day's shifts to a backup, and turning it back on restores them. Every existing reader keeps working unchanged.

## Verification

- **Dev harness** (`--dev`) intercepts every write: `supa.rpc` except read RPCs, `functions.invoke`, and storage upload. It logs `{fn, args}` (the token redacted) to `window.__calls` and returns stub success. Reads go to live views (the public data the customer page already shows).
  - `?as=admin|staff|out` fakes a session.
  - Admin-only read RPCs and `my_*` read RPCs are stubbed.
- **Parity check:** for each write action, v2 must call the same RPC with the same parameter names as production (inventory §1.1).
- **Checks:** `node --check` on each JS file, `node v2/staff-src/build.mjs` succeeds, and a headless click-through on the dev build.

## Core API as built (L0, 2026-10-28)

`A = window.App`. Read `js/03-core.js` and `js/04-auth.js` for the details. The notes below are the rules that trip people up.

### `A.api`

- `rpc(fn, args, {ok, quiet})` returns exactly `false` on failure; on success it returns `data ?? true`. **Test the result with `=== false`**, because a successful call can return `0`.
- `direct(fn, args)` returns `{data, error, text}` and adds no `p_pin`.
- `notify(body)`, `uploadAvatar(blob)` (returns the url or `false`), `errText`.

### `A.store`

- `ensure(from, to)` returns a `Promise<bool>`.
- Synchronous reads: `day(ds, wp)`, `isDraft`, `status(ym)`, `staff()`.
- Other loaders: `loadStatus()`, `openMonths()`, `directory({fresh})`.
- Cache control: `invalidate(from, to)`, `invalidateAll()`.
- Async reads:
  - `swaps({status, requesterId, shiftId, since, limit})`
  - `comments(ids)` (grouped by request id)
  - `myShifts()` (Shift or Night items with a `night` flag)
  - `submission(ym)` → `{qkey: choice}`
  - `nightQuestions(ym)`, `answers(ym)`
- For a non-admin, `day()` blanks the content of draft months and returns only `draft: true`.

### Overlays and helpers

- `sheet({title, html, actions, onOpen, onClose})`, `confirm({…, danger})`, `prompt({title, text, label, value, placeholder, inputmode, maxlength, validate, ok, cancel})` → `Promise<string|null>`, `toast(msg, err)`.
- Helpers: `today`, `sundayOf`, `ymShift`, `igUrl`, `avatar(name | {name, avatar}, cls, url)`, plus the prototype helpers and `ICON`.

### Screens and navigation

- `screen(key, {render(el, {keep})})`, `view(key, def)`, `render({keep})` → `Promise<bool>`.
- `go(tab, {date, view, wp})`, `goDay(ds, wp)`, `isAdmin()`.
- `state.role` is `admin`, `staff` or `out`.
- Tab keys: `schedule`, `swaps` (with `#swap` as an alias), `mine`, `submit`, `admin`.
- `render(el)` receives a detached element:
  - Query inside it with `el.querySelector`; `A.$` is for shell nodes only.
  - Set the theme with `el.dataset.theme`.

### `A.session` and `A.auth`

- `A.auth` exposes `openLogin`, `require` (→ `Promise<bool>`), `logout`, `expire`, `update`, `enablePush`, `pushOn` and `maybeAskPush`.
- Hooks other modules fill in: `A.bell.mount(btn)`, `A.account.open()`, `A.onTempPin`.

## Cross-module contract (L1)

Each name below is owned by exactly one file. Callers must guard every call (`A.x?.y?.(…)`), because builders work in parallel.

| name | owner | what |
|---|---|---|
| `A.draftBar(ds)`, `A.lockedMonth()`, `A.bindDraft(root)` | 10-day.js | Draft banner with 공개하기 (`admin_set_published`), and the locked-month empty state. |
| `A.editShift(shift)`, `A.addShift(ds, wp)` | 10-day.js | Admin shift sheets (staff/guest/empty, start/end). |
| `A.night.openAdd(ds, wp)`, `A.night.remove(member)` | 11-views.js | Night member sheet: staff, guest, 부족, and 가능 submitters of the covering night question. Remove asks for confirmation first. `ensureNightOn` checks for errors. |
| `A.swap.request(shift)` | 20-swap.js | 대타 구하기 sheet (`request_sub`, with a polite reminder when the person has ≥2 requests in the last 15 days). After success it calls `notify` to the admins. |
| `A.features` = `{v2db:false}`, `A.featuresReady` (Promise) | 22-bell.js | Probes `my_notifications` once after login. If the RPC is missing, `v2db` stays false. Gate every v2-DB feature on `A.features.v2db`. |
| `A.bell` | 22-bell.js | Bell items. Admins get open applications (수락/거절), open swaps and the last completed swaps, with unread state from `noti_seen_ids`. Everyone gets personal notifications when `v2db` is on. |
| `A.account.open({focus:'pin'})`, `A.onTempPin` | 23-account.js | 내 정보: photo crop and upload, IG, PIN (6 digits), push, logout. |
| `A.adminTools.open(kind, ym)`, `A.adminTools.openHopes(ds, wp)` | 32-admin-tools.js | `kind` is one of `builder`, `matrix`, `hopecal`, `counts`, `nights` or `person:<staffId>`. |
| `A.guest.convert(name)` | 34-guest.js | Guest → staff conversion. |
| `A.capture.open(ym, wp)` | 12-capture.js | Schedule image sheet. |
| `A.drag.bind(root)` | 13-drag.js | Desktop drag to another floor or to the trash. |

### Data rule for writes

After a successful write, call `A.store.invalidate(ds, ds)` (or `invalidateAll()`), then `await A.render({keep:true})`, then toast. Never send `notify` with an `event` body unless `A.features.v2db` is true. The deploy order is: notify function first, then the SQL.

### Night hours are free text

Show `night.hours` raw. Edit it with `A.prompt`, prefilled with the current text; when none exists, prefill the production default `주간 16:00~23:00 · 야간 23:00~익일 05:00`.

### 휴무 copy

- When `v2db` is false: "이 날 근무 N명이 지워져요".
- When `v2db` is true: "휴무를 풀면 근무가 돌아와요".

## L1 additions (2026-10-28, before the screen builders)

### Schedule views (owner of the shell: 10-day.js)
- `A.view(key, {title(d), isNow(d), now:[tagText, btnText], step(d, dir) → Date, chips?: false, render(listEl, {ds, wp, admin, edit})})`. The registry is `A.views[key]`.
- To smoke-test a view without the shell, call it directly: `const d = document.createElement('div'); document.getElementById('screen').append(d); await App.views.week.render(d, {ds:'2026-10-28', wp:'전체', admin:true, edit:false})`.
- **Shift elements** (rows in day, names in week) carry `data-shift-id`, `data-date` and `data-wp`. Night members carry `data-night-id`.
- After rendering, day and week call `A.drag?.bind?.(listEl)`. `13-drag.js` activates only for admin, viewport ≥ 980 and wp 전체.

### Live RPC facts (pg_proc, read-only, 2026-10-28)
- All 44 production RPCs exist with the inventory parameter names, plus `p_pin`. `apply_slot(p_staff_id, p_pin, p_shift_id)` and `cancel_application(p_staff_id, p_pin, p_shift_id)` exist.
- `admin_guest_to_staff` does **not** exist live; it is repo-only. Guest → staff must port production's multi-call path (staff.html 2270-2310).
- `my_notifications`, `mark_my_notifications_read`, `admin_reset_pin` and `admin_remind_submission` do not exist yet (`supabase-v2.sql`, not applied). Gate every use on `A.features.v2db`. The first deploy will most likely run with `v2db = false`.
  - `my_notifications(p_staff_id, p_pin, p_limit)` → rows `{id, kind, title, body, link:{tab, date?, workplace?, ym?, app_id?, request_id?}, created_at, read_at}`. The kinds are `application_approved`, `application_rejected`, `swap_taken`, `schedule_published` and `submission_reminder`.
  - `mark_my_notifications_read(p_staff_id, p_pin, p_ids | null)` → int.
  - `admin_reset_pin(p_admin_id, p_pin, p_target_id)` → the 6-digit temp PIN text. Show it once to the admin; never log it.
  - `admin_remind_submission(p_admin_id, p_pin, p_ym)` → int (people notified).

### Progress bar (user decision 2026-10-28)
- The admin submission count uses `.segbar` (in `01-staff.css`). It has one cell per person, or ten 10% cells above 30 people.
- The bar takes the class `lo` under 40%, `mid` from 40% to 79%, and `hi` from 80%. Its colours are `--red`, `--orange` and `--green`.
- Port the markup from the prototype's `segbar()` in `proto/js/admin.js`. The 제출 tab's day count keeps `.prog`.

### Dev builds for parallel work
- `node v2/staff-src/build.mjs --dev --out <name> --only <prefixes>` writes `.ui-design/v2-dev/<name>/staff.html`. It includes JS 00–04 plus the files whose names start with the prefixes, and all CSS.
- Open it at `http://127.0.0.1:4340/.ui-design/v2-dev/<name>/staff.html?as=admin`.
- Harness flags:
  - `as=admin|staff|out`
  - `id`, `name`
  - `temp=1`
  - `fail=stale`
  - `db=old`: the v2 DB functions return "function not found", as on live today.
- Each builder owns its CSS file: `10-day.css`, `11-views.css`, `20-people.css`, `30-admin.css`, `32-tools.css`. Shared CSS (`00-moe-system.css`, `01-staff.css`) belongs to the coordinator. Report any needed change instead of editing it.

### Staff list for large rosters (user, 2026-10-28)
The live directory has about 90 people. The 관리 staff list therefore uses:
- One-line 52px rows.
- A `.seg` filter: 전체 / 확인 필요 (locked, no PIN or temp PIN) / 관리자.
- Sort order: name only (가나다). Superseded on 2026-10-28: 확인 필요 first, then admins. 확인 필요 = locked or no PIN; temp PIN is not shown because most staff have one.
- Under 전체 with no search, the first 8 rows plus "나머지 N명 보기".
- Search by name or 초성.

The prototype source is `proto/js/admin.js` `staffSec()`/`staffRows()`. Preview it with `?many=90`.

## Staff picker (core, 2026-10-28)
- `A.staffPick({staff, sel, attr, wrap, label})` returns a search field plus a scrolling list of staff (sorted 가나다, 초성 search). It replaces the `<select>` in 근무 넣기/고치기 (10-day) and 근무 추가 (31-admin).
- The chosen id goes into a hidden input carrying `attr`, so callers still read `.value`. `wrap` lands on the outer div, for the `data-p`/`data-for` show and hide toggles.
- Call `A.bindStaffPick(el)` in `onOpen`. `A.cho` and `A.nameHit(name, q)` are the shared 초성 helpers.

## 출근표 짜기 merged into the schedule (2026-10-28)
- In 일별 edit mode, each store section ends with a 희망 block: chips of people who chose that store and are not in it yet, then 상관없음 people (shown faded) who are not placed anywhere that day. This is the same rule as production 희망자 넣기.
- A tap calls `admin_assign_from_submission` with one id, then `done()`. If the person already works in another store that day, that store's name is shown in small red text on the chip.
- Answers are cached per month for 60 s in 10-day.
- The 희망자 floor-tool button is removed. The month view's ＋희망 still opens `A.adminTools.openHopes`.
- In 관리, "출근표 짜기" is now 스케줄에서 짜기 plus 표로 한 번에 짜기. 근무 한 칸 추가 (`openShiftAdd`) is removed; it duplicated '+ 사람 넣기' in schedule edit.

## Bottom sheet (core, 2026-10-28)
- `A.sheet` DOM: `.modal` > `.modal-c` > `.sheet-top` (`.grab` + `.sheet-h` with `.sheet-x`) + `.sheet-b` (the scroller) + `.sheet-a` (pinned actions). Code that needs the sheet's scroll position reads `.sheet-b`, not `.modal-c`.
- `close()` runs `onClose`, settles promises and restores focus synchronously. The element gets `.closing` (`pointer-events:none`) and is removed after the slide-out, so "is a sheet open?" checks must use `#app > .modal:not(.closing)`.
- Drag to close: the `.sheet-top` pointer events always drag. A touch pull on `.sheet-b` works only at scrollTop 0, and never on `input, textarea, select, .spk-list, .pick-list, .tl-body, .crop-cv, [data-nopull]`, nested scrollers or `.tl-sheet`. Add `data-nopull` to any new gesture area.

## Login gate (core, 2026-10-29)

The user asked for this: staff without a login can't enter at all.

- **Logged out.** `render()` draws only `renderGate()`:
  - a lock icon and "직원만 볼 수 있어요";
  - a 로그인 button and a link to `/v2/main.html`;
  - no tabs (`body.gated` hides `#tabbar`).
- **On boot** the login sheet opens automatically.
- **The hash is kept** (for example `#swaps`), so that tab opens after login. Logout and an expired token both return to the gate.
- **This is a screen gate only.** The public views (`swap_view`, `swap_requests`, `swap_comments`, `shift_view`) are still anon-readable at the DB.
