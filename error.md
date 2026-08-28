# 오류 기록

에러가 날 때마다 여기에 **증상 → 원인 → 해결** 을 추가합니다.
증상이 같아 보여도 원인이 다른 경우가 많으므로, 화면에 뜬 **오류 문구를 그대로** 적습니다.

## 빠른 찾기

| 오류 문구 | 원인 | 해결 |
|---|---|---|
| `... is not a function` | import 한 함수가 `lib/` 에 없음 | [#1](#1-x-is-not-a-function) |
| 표는 뜨는데 값이 전부 `—` | 정규화 함수의 컬럼 후보 이름이 뷰와 불일치 | [#2](#2-표는-뜨는데-값이-전부--로-나온다) |
| `Invalid schema: analytics` (PGRST106) | 스키마가 API 에 **노출** 안 됨 | [#3](#3-invalid-schema-analytics) |
| `permission denied for schema analytics` (42501) | 스키마에 **GRANT** 없음 | [#4](#4-permission-denied-for-schema-analytics) |
| `permission denied for table leadtime_plan` (42501) | 테이블에 쓰기 GRANT 없음 | [#5](#5-permission-denied-for-table-leadtime_plan--조회하면-빈-배열) |
| 조회는 되는데 빈 배열 `[]` | RLS 만 켜지고 정책이 없음 | [#5](#5-permission-denied-for-table-leadtime_plan--조회하면-빈-배열) |
| 고쳤는데 화면이 그대로 | dev 서버 / 브라우저 캐시 | [#6](#6-db-는-고쳤는데-화면은-옛-오류-그대로) |
| `npm run build` 실패 | 아래 참조 | [#7](#7-npm-run-build-가-실패한다) |
| 배포 화면에서 사이드바와 본문이 기본 HTML처럼 세로로 깨짐 | `styles/shell.css`의 셸 규칙이 덮어써짐 | [#8](#8-배포-화면에서-사이드바와-본문이-기본-html처럼-깨진다) |
| `supabase db lint --local` connection refused | 로컬 Supabase DB가 실행되지 않음 | [#9](#9-supabase-db-lint---local-connection-refused) |

> **Supabase 3층 구조를 먼저 기억하면 #3·#4·#5 를 헷갈리지 않습니다.**
>
> ```
> 1층  Exposed schemas   PostgREST 가 그 스키마로 라우팅할지   → 아니면 Invalid schema
> 2층  GRANT             Postgres 롤이 접근할 수 있는지        → 아니면 permission denied
> 3층  RLS 정책          그 롤이 어느 행을 볼 수 있는지        → 아니면 빈 배열 []
> ```
>
> 1층만 확인하고 넘어가면 2층·3층 문제를 못 찾습니다. 세 층은 서로 독립입니다.

---

## #1 `X is not a function`

**증상**

```
Uncaught TypeError: (0 , _lib_scm__WEBPACK_IMPORTED_MODULE_3__.getStockoutRisks) is not a function
    at StockoutPage (page.tsx:42:21)
```

**원인**
`app/analysis/leadtime/page.tsx` 자리에 리드타임 예제가 아니라 **오후 실습 정답(재고 소진 위험) 페이지**가 들어가 있었습니다.
그 파일은 `getStockoutRisks` 와 `StockoutRisk` 를 import 하는데, 배포본 `lib/` 에는 그 둘이 **의도적으로 없습니다**
(참가자가 오후에 만들 몫이라 `README_배포전_확인.md` 가 "없어야 함" 으로 검사하는 항목입니다).
없는 export 를 import 하면 `undefined` 가 되고, 호출하는 순간 TypeError 가 납니다.

**해결**
`app/analysis/leadtime/page.tsx` 를 `getLeadtimeGap` / `LeadtimeGap` 을 쓰는 본보기 화면으로 다시 작성했습니다.

**예방** — 배포 전 이 3줄이 모두 비어 있어야 합니다.

```bash
grep -n "StockoutRisk" lib/scm-model.ts
grep -n "getStockoutRisks" lib/scm.ts
ls app/analysis/stockout            # No such file 이어야 함
```

---

## #2 표는 뜨는데 값이 전부 `—` 로 나온다

**증상** 오류는 안 나고 행 수도 맞는데 숫자 칸이 전부 `—`.

**원인**
`normalizeLeadtimeGap` 이 찾던 컬럼 이름이 실제 `analytics.v_leadtime_gap` 컬럼과 하나도 안 맞았습니다.

| 화면 필드 | 찾던 이름 | 실제 컬럼 |
|---|---|---|
| masterLeadTime | `master_lt` | `std_lead_time` |
| sampleCount | `sample_count` | `n_samples` |
| actualAverage | `actual_avg` | `mean_days` |
| p80 | `p80` | `p80_days` |
| gap | `gap` | `gap_days` |

정규화 함수는 못 찾으면 `null` 을 돌려주므로 **오류 없이 조용히** 빈 값이 됩니다. 그래서 더 찾기 어렵습니다.

**해결** `lib/scm-model.ts` 의 컬럼 후보 목록 맨 앞에 실제 이름을 추가했습니다(기존 이름도 그대로 둡니다).

**예방** 새 정규화 함수를 만들면 `lib/scm-model.test.ts` 에 **실제 뷰 컬럼명으로** 테스트를 한 개 추가합니다. `npm test` 로 돌립니다.

---

## #3 `Invalid schema: analytics`

**증상**

```
Invalid schema: analytics          (PostgREST 코드 PGRST106)
```

**원인** 그 스키마가 Data API 에 **노출**되어 있지 않습니다. 권한 문제가 아닙니다.

**해결** Supabase → Project Settings → API → **Exposed schemas** 에 `core`, `analytics` 추가 후 Save.

**확인** — 일부러 없는 스키마를 요청하면 노출 목록을 알려줍니다.

```bash
curl -s -H "apikey: $KEY" -H "Accept-Profile: __nope__" \
  "$URL/rest/v1/x?select=*"
# → "Only the following schemas are exposed: public, graphql_public, analytics, core"
```

---

## #4 `permission denied for schema analytics`

**증상**

```
{"code":"42501","message":"permission denied for schema analytics"}
```

**원인**
`dump.sql` 에 **GRANT 문이 한 줄도 없습니다**(`grep -c GRANT dump.sql` → 0).
덤프를 복원하면 스키마와 뷰가 전부 `postgres` 소유로만 만들어지고 `anon` 롤에는 권한이 붙지 않습니다.
**Exposed schemas 를 켜도 이 오류는 그대로 납니다.** 노출과 권한은 별개입니다(위 3층 구조 참조).

**해결** SQL Editor 에서 `sql/01-grants.sql` 실행.

**★ 덤프를 다시 복원할 때마다 다시 실행해야 합니다.**
`dump.sql` 은 맨 앞에서 뷰와 스키마를 `DROP` 하는데, 객체를 drop 하면 거기 붙어 있던 GRANT 도 같이 사라집니다.
`alter default privileges` 설정도 스키마에 붙어 있어서 스키마가 drop 되면 함께 날아갑니다.
Exposed schemas 는 DB 가 아니라 프로젝트 설정이라 살아남습니다 — 그래서 복원 후에는
"노출은 되는데 권한만 없는" 조합(#4)이 됩니다.

---

## #5 `permission denied for table leadtime_plan` / 조회하면 빈 배열

**증상**

```
SELECT core.leadtime_plan  →  []
UPDATE core.leadtime_plan  →  42501 permission denied for table leadtime_plan
                              hint: "GRANT UPDATE ON core.leadtime_plan TO anon"
```

**원인** 두 가지가 겹칩니다.
- `core.leadtime_plan` 과 `core.usage_profile` 은 `dump.sql` 에서 **RLS 만 켜지고 정책이 없습니다**(dump.sql:10936, 10948). 정책 없는 RLS 는 "전부 거부" 라 SELECT 가 빈 배열로 옵니다.
- 쓰기는 RLS 이전에 **테이블 GRANT** 자체가 없습니다. `01-grants.sql` 은 `select` 만 줍니다.

**해결** 앱에서 이 두 테이블을 저장까지 하려면 `sql/02-policies.sql` 실행 (GRANT + 정책 둘 다 들어 있습니다).
SQL Editor / Table Editor 로만 값을 바꿀 거면 실행하지 않아도 됩니다 — 그쪽은 `postgres` 롤이라 RLS 를 우회합니다.

**함정** `core.leadtime_plan` 은 수업 전에 원래 0행이 정상입니다.
그래서 **"아직 안 채운 것"과 "RLS 가 막은 것"이 화면상 구분되지 않습니다.**
값을 넣었는데도 화면이 비어 있으면 이걸 의심하세요.

---

## #6 DB 는 고쳤는데 화면은 옛 오류 그대로

**증상** SQL 도 돌렸고 REST 로는 200 이 오는데, 브라우저 화면은 여전히 옛 오류 문구.

**원인** 설정을 바꾸기 **전에** 띄운 dev 서버 / 브라우저가 옛 결과를 붙들고 있습니다.

**해결**

```bash
Ctrl+C
npm run dev
```
그리고 브라우저 강제 새로고침 (`Cmd+Shift+R`).

**확인** — 화면을 믿기 전에 DB 쪽을 먼저 갈라서 봅니다. 200 이 오면 문제는 DB 가 아니라 화면 쪽입니다.

```bash
set -a && . ./.env.local && set +a
curl -s -w "\n[HTTP %{http_code}]\n" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Accept-Profile: analytics" \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/v_leadtime_gap?select=supplier_name&limit=2"
```

---

## #7 `npm run build` 가 실패한다

**증상 A**

```
Type error: 'env' is possibly 'null'.
  app/api/health/supabase/route.ts:6  if (!env.configured)
```

**원인** `getSupabaseEnv()` 가 옛 버전에서는 `{ configured: boolean }` 를 돌려줬지만, 지금은 실패 시 **`null`** 을 돌려줍니다.
**해결** `if (!env)` 로 고칩니다.

**증상 B**

```
error TS5097: An import path can only end with a '.ts' extension
  lib/scm-model.test.ts:3  import { normalizeLeadtimeGap } from './scm-model.ts';
```

**원인** `node --test` 로 테스트를 돌리려면 `.ts` 확장자가 필요한데, 기본 tsconfig 는 이를 거부합니다.
**해결** `tsconfig.json` 에 `"allowImportingTsExtensions": true` 추가. 테스트는 `npm test`.

**증상 C**

```text
lib/supabase/server.ts: Parameter 'cookiesToSet' implicitly has an 'any' type
```

**원인** `@supabase/ssr`의 cookie adapter 객체에서 `setAll` 콜백 인자가 현재 TypeScript 설정으로 자동 추론되지 않았습니다.

**해결** `SetAllCookies` 타입을 import하고 `Parameters<SetAllCookies>[0]`으로 `cookiesToSet`을 명시합니다. middleware의 cookie adapter에도 같은 타입을 적용합니다.

---

## #8 배포 화면에서 사이드바와 본문이 기본 HTML처럼 깨진다

**증상**

- 사이드바가 왼쪽 고정 열이 아니라 페이지 위쪽의 일반 텍스트처럼 표시됩니다.
- 메뉴 링크가 한 줄로 붙고 상단바와 본문 글자 크기가 브라우저 기본값처럼 커집니다.
- `npm run build`는 성공하지만 실제 배포 화면의 레이아웃은 깨집니다.

**원인**

`app/globals.css`는 정상적으로 `styles/shell.css`를 import하고 있었지만,
`styles/shell.css` 안에는 분석 탭 규칙만 남아 있었습니다. 이전 패치가 한 줄로 압축된 파일 전체를 교체하면서
`.app-shell`, `.sidebar`, `.topbar`, `.content`, 모바일 media query가 함께 삭제됐습니다.

**해결**

`styles/shell.css`에 앱 셸, 250px 사이드바, sticky 상단바, 콘텐츠 영역, 분석 탭,
760px 모바일 전환 규칙을 디자인 토큰 기반으로 복원했습니다.

**예방**

`lib/design-system.test.ts`가 다음 필수 규칙을 검사합니다.

```text
.app-shell  .sidebar  .topbar  .content  .nav-button
@media (max-width: 760px)
```

CSS 변경 후 `npm test`와 `npm run build`를 모두 실행하고, production 서버에서 사이드바 계산 폭이
`250px`인지 확인합니다.

---

## #9 `supabase db lint --local` connection refused

**증상**

```text
failed to connect to host=127.0.0.1 port=54322: connection refused
```

**원인**

Supabase CLI는 설치되어 있지만 `supabase start`로 로컬 PostgreSQL이 실행되지 않은 상태입니다.

**해결**

Docker가 실행 중인 개발 환경에서 `supabase start` 후 `supabase db lint --local`을 다시 실행합니다.
로컬 DB를 사용하지 않는 배포 환경에서는 연결된 프로젝트를 확인한 뒤 migration을 적용합니다.
