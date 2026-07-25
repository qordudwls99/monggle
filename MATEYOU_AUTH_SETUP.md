# MateYou OIDC 운영 설정

이 문서는 메이트유 계정으로 Monggle에 로그인하고, 출근부 파트너+ 자격을 별도로 동기화하는 운영 순서입니다.

```text
Monggle
  → Supabase Auth (custom:mateyou)
  → MateYou OIDC Provider
  → Supabase 세션 발급
  → sync-mateyou-entitlements
  → MateYou 내부 entitlement API
  → Monggle profile/Partner+ 갱신
```

## 1. MateYou 서버

MateYou 서버 DB에 `server/migrations/20260725000200_oidc_provider.sql`을 적용하고 다음 secret을 운영 환경에 설정합니다.

| 이름 | 값/용도 |
|---|---|
| `OIDC_ISSUER` | `https://api.mateyou.me/oidc` |
| `OIDC_MONGGLE_CLIENT_ID` | `monggle` |
| `OIDC_MONGGLE_CLIENT_SECRET` | 32자 이상의 무작위 secret |
| `OIDC_MONGGLE_REDIRECT_URIS` | Supabase Custom Provider 화면의 Callback URL |
| `OIDC_COOKIE_KEYS` | 32자 이상 키 2개 이상, 쉼표 구분 |
| `OIDC_JWKS_JSON` | RS256 private JWK를 포함한 JWKS JSON |
| `OIDC_LOGIN_PROVIDERS` | 예: `google,discord,twitter,apple` |
| `MONGGLE_ENTITLEMENT_SERVICE_TOKEN` | 32자 이상의 서비스 간 secret |

`OIDC_JWKS_JSON`, client secret, cookie key, service token은 secret manager에만 저장합니다.

MateYou에 연결된 각 소셜 로그인 콘솔에도 아래 callback을 등록합니다.

```text
https://api.mateyou.me/oidc/interaction/callback/google
https://api.mateyou.me/oidc/interaction/callback/discord
https://api.mateyou.me/oidc/interaction/callback/twitter
https://api.mateyou.me/oidc/interaction/callback/apple
```

배포 후 아래 discovery URL이 HTTPS에서 열리고 `authorization_code`, `S256`만 광고하는지 확인합니다.

```text
https://api.mateyou.me/oidc/.well-known/openid-configuration
```

## 2. Supabase Custom OAuth Provider

Supabase Dashboard의 Auth → Providers → New Provider에서 다음과 같이 등록합니다.

| 항목 | 값 |
|---|---|
| 방식 | Auto-discovery (OIDC) |
| Identifier | `custom:mateyou` |
| Client ID | `monggle` |
| Client Secret | MateYou의 `OIDC_MONGGLE_CLIENT_SECRET`과 동일 |
| Issuer URL | `https://api.mateyou.me/oidc` |
| Scopes | `openid profile email` |
| PKCE | 활성화 |
| Email optional | 활성화 |

화면에 표시된 Callback URL을 MateYou의 `OIDC_MONGGLE_REDIRECT_URIS`에 정확히 등록합니다. Supabase URL Configuration에는 운영 `staff.html` URL과 필요한 로컬 개발 URL을 Redirect URLs로 허용합니다.

## 3. Monggle 데이터베이스

기존 출근부 SQL이 모두 적용된 뒤 `supabase-mateyou-auth.sql`을 실행합니다.

이 마이그레이션은 다음을 함께 수행합니다.

- `mateyou_profiles` 생성
- 기존 PIN 검증을 Supabase `auth.uid()` 기반 연결 검증으로 교체
- 직원 연결 성공 시 사용한 PIN 즉시 폐기
- 일반 회원/Partner+/관리자 권한 분리
- 기존 PIN 로그인 실행권 제거
- 신청자·제출 답변 공개 view 차단
- 아바타 쓰기를 인증 사용자 자기 폴더로 제한

적용 직후 기존 PIN 로그인 화면은 더 이상 동작하지 않으므로 Edge Function과 새 `staff.html` 배포를 같은 전환 구간에서 진행합니다.

## 4. Edge Function

다음 함수를 배포합니다.

```text
supabase-functions/sync-mateyou-entitlements
supabase-functions/notify
```

두 함수 모두 JWT 검증을 켠 상태로 배포합니다. Supabase가 자동 제공하는 `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` 외에 다음 secret을 추가합니다.

| 이름 | 값 |
|---|---|
| `MATEYOU_ENTITLEMENT_URL` | `https://api.mateyou.me/api/internal/entitlements/monggle` |
| `MATEYOU_ENTITLEMENT_SERVICE_TOKEN` | MateYou 서버와 동일한 서비스 간 secret |
| `MONGGLE_ALLOWED_ORIGINS` | 운영/개발 origin 쉼표 구분, 예: `https://example.com,http://localhost:4173` |
| `VAPID_PUBLIC_KEY` | 웹푸시 공개키 |
| `VAPID_PRIVATE_KEY` | 웹푸시 비밀키 |
| `VAPID_SUBJECT` | 운영 연락처, 예: `mailto:ops@example.com` |

## 5. 권장 배포 순서

1. MateYou DB migration 적용
2. MateYou OIDC 환경변수 설정 및 서버 배포
3. discovery endpoint와 소셜 callback 확인
4. Supabase `custom:mateyou` 등록
5. Monggle Edge Function secret 설정 및 함수 배포
6. 짧은 유지보수 구간에서 `supabase-mateyou-auth.sql` 적용
7. 새 `staff.html` 배포
8. 아래 계정 시나리오로 확인

## 6. 필수 확인 시나리오

| 계정 | 기대 결과 |
|---|---|
| 일반 MateYou 회원 | 로그인 성공, 공개 스케줄 조회, Partner+ 기능 잠김 |
| Partner+·미연결 | Partner+ 표시, 기존 출근자 연결 안내 |
| Partner+·연결 | 제출·빈자리 신청·대타 참여 가능 |
| 연결된 관리자 | 관리 탭과 민감 조회 가능 |
| 자격 API 장애 | 로그인/기본 조회 유지, Partner+ 액션 실패 폐쇄 |
| 로그아웃 | Supabase 세션 제거, 직원/관리자 기능 즉시 숨김 |

운영 반영 전에는 client secret 불일치, callback URL 오타, 허용 origin 누락을 가장 먼저 확인하세요.
