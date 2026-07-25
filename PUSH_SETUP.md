# 🔔 푸시 알림 설정 (대타 게시판 댓글)

댓글이 달리면 관련자(요청자 + 그 글에 댓글 단 사람들) 폰으로 푸시가 가요.
앱 코드는 이미 준비됐고, **회원님은 3가지만** 하면 돼요.

---

## 1) SQL 2개 실행 (Supabase → SQL Editor → Run)
- 댓글: `supabase-comments.sql` (이미 했으면 패스)
- 구독 저장: **`supabase-push.sql`**

## 2) Edge Function 배포 (Supabase 대시보드)
1. Supabase → 왼쪽 **Edge Functions** → **Create a function**
2. 이름: **`notify`**
3. 코드 칸에 저장소의 **`supabase-functions/notify/index.ts`** 내용 **전체 복붙** → **Deploy**
4. 배포 후 **Secrets(환경변수)** 를 추가합니다 (Edge Functions → Manage secrets, 또는 Settings → Edge Functions):
   | 이름 | 값 |
   |------|-----|
   | `VAPID_PUBLIC_KEY` | 운영용 웹푸시 공개키 |
   | `VAPID_PRIVATE_KEY` | 운영용 웹푸시 비밀키 |
   | `VAPID_SUBJECT` | `mailto:본인이메일@example.com` |
   | `MONGGLE_ALLOWED_ORIGINS` | 운영/개발 origin 쉼표 구분 |
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 는 Supabase가 자동 제공합니다.
5. 다시 **Deploy**(또는 재배포)해서 secrets 적용.

> ⚠️ `VAPID_PRIVATE_KEY` 는 비밀이에요. 이 함수 secret에만 넣고 다른 곳에 노출 X.
> 과거 저장소나 문서에 비밀키를 기록한 적이 있다면 새 키로 교체하세요.

## 3) 각자 폰에서 "알림 켜기"
- 직원용(`/staff.html`) → 우측 상단 내 이름 → **마이페이지** → **🔔 알림 켜기** → 권한 허용.
- **아이폰은 반드시 먼저 "홈 화면에 추가"(앱 설치)** 한 상태여야 알림이 와요 (iOS 16.4+ 정책). 안드로이드는 설치 없이도 됨.
- 알림 받을 사람은 각자 한 번씩 켜야 해요.

---

## 동작 확인
1. A가 대타 글에 댓글 작성
2. 요청자/이전 댓글 작성자 폰에 **"대타 게시판 새 댓글"** 푸시 도착 (앱 닫혀 있어도)
3. 알림 탭하면 직원용 페이지가 열려요

## 안 오면 체크
- `notify` 함수가 Deploy 됐는지, secrets 3개 들어갔는지
- 받는 사람이 마이페이지에서 **알림 켜기** 했는지
- 아이폰이면 **홈 화면에 추가(앱)** 상태인지
- Supabase Edge Functions → `notify` → **Logs** 에서 오류 확인
