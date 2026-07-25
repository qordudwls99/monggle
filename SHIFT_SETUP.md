# 출근 시프트 설정 안내

출근 스케줄은 누구나 볼 수 있고, 계정 기능은 메이트유 로그인으로 이용합니다.

- 메이트유 일반 회원: 로그인, 공개 스케줄 조회
- 출근부 파트너+: 시프트 제출, 빈자리 신청, 대타 수락, 댓글
- 기존 출근자 연결: 내 근무, 대타 요청, 출근부 프로필
- 출근부 관리자: 직원·근무·편성 관리

파트너+와 출근자 연결은 서로 다른 권한입니다. 파트너+ 회원이어도 실제 직원 레코드가 필요한 기능은 기존 출근자를 한 번 연결해야 합니다.

## 구성 파일

| 파일 | 설명 |
|---|---|
| `staff.html` | 직원용 PWA |
| `supabase-setup.sql` 및 후속 SQL | 기존 출근부 스키마 |
| `supabase-mateyou-auth.sql` | 메이트유 OAuth 전환 마이그레이션 |
| `supabase-functions/sync-mateyou-entitlements/index.ts` | Partner+ 권한 동기화 |
| `MATEYOU_AUTH_SETUP.md` | 운영 환경 설정과 배포 순서 |

## 최초 설치

1. Supabase 프로젝트를 생성합니다.
2. 기존 SQL 파일을 번호 대신 아래 순서로 적용합니다.
   - `supabase-setup.sql`
   - `supabase-update.sql`
   - 나머지 사용 중인 `supabase-*.sql`
   - 마지막에 `supabase-mateyou-auth.sql`
3. `staff.html`의 `CONFIG`에 Supabase Project URL과 publishable/anon 키를 설정합니다.
4. [MATEYOU_AUTH_SETUP.md](./MATEYOU_AUTH_SETUP.md)에 따라 OIDC Provider와 Edge Function을 연결합니다.

브라우저에 들어가는 Supabase publishable/anon 키는 공개용입니다. 서비스 역할 키, OIDC client secret, entitlement service token은 브라우저 코드에 넣으면 안 됩니다.

## 기존 직원의 첫 연결

1. 관리자가 직원 레코드에 6자리 연결 PIN을 설정합니다.
2. 직원이 `메이트유로 로그인`을 완료합니다.
3. 마이페이지에서 `기존 출근자 연결`을 누릅니다.
4. 출근부 이름과 PIN을 한 번 입력합니다.

PIN은 직원 연결 요청에만 사용되고 브라우저 저장소에는 보관되지 않습니다. 연결 이후 인증은 Supabase 세션과 메이트유 계정으로 처리됩니다.

## 근무 변경 흐름

```text
A의 근무 → 대타 요청 → 게시판 공개 → B가 수락 → 근무가 B에게 이전
```

대타 요청과 수락은 연결된 출근부 파트너+만 수행할 수 있습니다. 권한은 화면뿐 아니라 데이터베이스 함수에서도 다시 확인합니다.

## 배포

정적 화면은 Vercel 배포를 사용합니다. `supabase-mateyou-auth.sql` 적용 시 기존 PIN 로그인 함수 실행권이 즉시 제거되므로, OIDC Provider·Supabase Custom Provider·Edge Function·프론트엔드가 모두 준비된 유지보수 구간에 전환하세요.
