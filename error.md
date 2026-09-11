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
| `ERROR: 42P01: relation "core.policy_config" does not exist` | STEP 5를 STEP 3보다 먼저 또는 단독 실행 | [#10](#10-error-42p01-relation-corepolicy_config-does-not-exist) |
| `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/permission'` | Node ESM 테스트가 확장자 없는 런타임 import를 해석하지 못함 | [#13](#13-err_module_not_found-libpermission) |
| `ERROR: role "anon" already exists` | 임시 PostgreSQL DB 검증에서 클러스터 공용 역할을 다시 생성함 | [#14](#14-error-role-anon-already-exists) |
| `ERROR: function auth.uid() does not exist` | 일반 PostgreSQL 검증 DB에 Supabase Auth 함수가 없음 | [#15](#15-error-function-authuid-does-not-exist) |
| `cannot change name of view column` | 기존 뷰 열 사이에 새 열을 삽입해 재적용 실패 | [#16](#16-cannot-change-name-of-view-column) |
| `zsh: no matches found: app/(user)/...` | 괄호가 있는 경로를 따옴표 없이 전달 | [#17](#17-zsh-no-matches-found-appuser) |
| `The following paths are ignored` | `.superpowers/sdd/.gitignore`가 보고서도 제외 | [#18](#18-the-following-paths-are-ignored) |

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

---

## #10 `ERROR: 42P01: relation "core.policy_config" does not exist`

**증상**

```text
Failed to run sql query: ERROR: 42P01: relation "core.policy_config" does not exist
LINE 3: insert into core.policy_config (policy_key, policy_value, description)
```

**원인**

STEP 5 SQL의 첫 번째 `insert`가 참조하는 `core.policy_config` 테이블은 STEP 5에서 생성하지 않습니다. 이 테이블은 `supabase/migrations/20260828000200_step3_data_isolation.sql`에서 생성됩니다. STEP 5 내용만 복사해 SQL Editor에서 단독 실행하면 테이블이 없어 42P01이 발생합니다.

**해결**

SQL Editor에서 아래 순서로 전체 파일을 실행합니다.

```text
STEP 2  20260828000100_step2_auth_rbac.sql
STEP 3  20260828000200_step3_data_isolation.sql
STEP 4  20260828000300_step4_import_pipeline.sql
STEP 5  20260828000400_step5_sku_demand_profile.sql
```

이미 STEP 2~4를 실행했다면 STEP 5만 다시 실행하면 됩니다. STEP 3 실행 여부는 다음 쿼리로 확인할 수 있습니다.

```sql
select to_regclass('core.policy_config');
```

결과가 `core.policy_config`로 나오면 STEP 5를 실행합니다. `null`이면 STEP 3을 먼저 실행합니다. 각 단계는 `if not exists`와 `on conflict do nothing`을 사용하므로 이미 적용된 단계도 재실행할 수 있습니다.

---

## #11 Agent 테스트가 매번 "AI 가 설정되지 않았습니다" 로 끝난다

**증상.** `lib/agent/orchestrator.test.ts` 에서 가짜 모델을 주입했는데도 `runAgent` 가 모델을
한 번도 부르지 않고 다음 오류로 끝났습니다.

```
AI 가 설정되지 않았습니다. 환경변수 OPENAI_API_KEY · OPENAI_MODEL 를 채워주세요.
```

**원인.** 테스트에서 환경변수를 잠깐 채우는 헬퍼가 **동기 함수**였습니다.

```ts
function withEnv<T>(run: () => T): T {
  process.env.OPENAI_API_KEY = 'k';
  try { return run(); }          // ← 프로미스를 그대로 돌려주고
  finally { /* 환경변수 복원 */ } // ← 여기서 바로 지웁니다
}
```

`run()` 이 `async` 이므로 `return run()` 은 프로미스만 돌려주고 즉시 `finally` 가 실행됩니다.
`runAgent` 가 `process.env` 를 읽는 시점에는 이미 지워진 뒤입니다.

**해결.** 헬퍼를 `async` 로 바꾸고 `return await run()` 으로 기다립니다.

**규칙.** `try/finally` 로 전역 상태(환경변수 · 시간 · 모의 객체)를 되돌리는 헬퍼는 안에서
비동기 함수를 부르는 순간 반드시 `async` + `await` 여야 합니다. 증상이 "설정이 없다" 처럼
엉뚱하게 나오므로 원인을 프로덕션 코드에서 찾다가 시간을 씁니다.

---

## #12 `ERROR: 42703: column "last_message_at" does not exist`

**증상.** STEP 16 마이그레이션(`20260909000100_step16_agent_conversation.sql`)을 SQL Editor 에
붙여 실행하니 표를 만드는 중에 위 오류가 났습니다.

**원인.** 그 데이터베이스에 **이름은 같고 컬럼이 다른** `core.agent_conversation` 이 이미
있었습니다. `create table if not exists` 는 이름만 보고 조용히 건너뛰고, 바로 다음 줄의

```sql
create index if not exists agent_conversation_user_idx
  on core.agent_conversation (user_id, last_message_at desc);
```

가 없는 컬럼을 가리켜 죽습니다. 오류 메시지는 "컬럼이 없다" 고만 말하므로 **이미 다른 표가
있다** 는 진짜 원인이 드러나지 않습니다.

**해결.** 마이그레이션 앞에 §0 을 두어, 옛 모양이 있으면 **지우지 않고 옮깁니다.**

```
core.agent_conversation → core.agent_conversation_legacy_<YYYYMMDDHHMM>
core.agent_message      → core.agent_message_legacy_<YYYYMMDDHHMM>
```

딸린 인덱스 이름도 함께 바꿔야 새 인덱스를 만들 수 있습니다. 인덱스 이름은 스키마 안에서
유일하고, `create index if not exists` 는 이름이 같으면 컬럼이 달라도 건너뛰기 때문입니다.

**왜 지우지 않는가.** 옛 표에 대화가 남아 있을 수 있고, 지운 것은 되돌릴 수 없습니다.
옮겨 둔 표를 열어 보고 필요 없을 때 사람이 지웁니다.

```sql
select * from core.agent_conversation_legacy_<시각> limit 20;
drop table core.agent_message_legacy_<시각>, core.agent_conversation_legacy_<시각>;
```

**규칙.** `create table if not exists` 는 "같은 모양이 있다" 가 아니라 "같은 이름이 있다" 를
봅니다. 이름이 겹칠 수 있는 표를 만들 때는 컬럼 존재를 직접 확인하고, 다르면 분명한 조치를
취하도록 적습니다.

---

## #13 `ERR_MODULE_NOT_FOUND: Cannot find module '.../lib/permission'`

**증상.** `node --test` 실행 시 `lib/menu.ts`가 불러오는 `lib/permission`을 찾지 못해 테스트
파일 자체가 시작되지 않았습니다.

**원인.** 기존 import는 타입 전용이라 실행 전에 제거됐지만, `WORK_ROUTE_PERMISSIONS`를 함께
불러오면서 런타임 import가 됐습니다. Node ESM 해석기는 확장자 없는 상대 경로를 자동으로
`.ts` 파일에 연결하지 않습니다.

**해결.** Node 테스트가 직접 거치는 상대 런타임 import를 `./permission.ts`로 명시했습니다.
프로젝트의 `allowImportingTsExtensions` 설정으로 Next.js 타입 검사에서도 같은 경로를 허용합니다.

**예방.** 타입 전용 import에 런타임 값을 추가할 때는 해당 모듈이 `node --test`에서도 직접
로드되는지 확인하고, 그렇다면 `.ts` 확장자를 함께 명시합니다.

---

## #14 `ERROR: role "anon" already exists`

**증상.** 별도 로컬 PostgreSQL 데이터베이스에서 마이그레이션을 검증하려고 `anon`과
`authenticated` 역할을 준비하는 명령을 실행하자 `anon` 생성에서 중단됐습니다.

**원인.** PostgreSQL 역할은 데이터베이스별 객체가 아니라 클러스터 공용 객체입니다. 새 검증
데이터베이스를 만들었더라도 같은 클러스터에 Supabase용 `anon` 역할이 이미 있으면 다시 만들 수 없습니다.

**해결.** `pg_roles`에서 역할 존재 여부를 먼저 확인하고 기존 `anon`·`authenticated` 역할을
재사용했습니다. 임시 데이터베이스에는 `auth.users`처럼 마이그레이션이 참조하는 객체만 만듭니다.

**예방.** 임시 DB 검증 준비에서 클러스터 공용 역할은 무조건 생성하지 말고 다음 조회로 확인합니다.

```sql
select rolname from pg_roles where rolname in ('anon', 'authenticated');
```

---

## #15 `ERROR: function auth.uid() does not exist`

**증상.** 일반 로컬 PostgreSQL 임시 DB에 RBAC 마이그레이션을 적용하자 `auth.uid()` 기본값을
정의하는 위치에서 중단됐습니다.

**원인.** `auth.uid()`는 Supabase가 제공하는 함수라서 빈 PostgreSQL 데이터베이스에는 없습니다.
애플리케이션 마이그레이션은 Supabase 환경을 전제로 하므로 정상이며, 임시 검증 환경만 불완전했습니다.

**해결.** 임시 DB의 `auth` 스키마에 세션 설정 `request.jwt.claim.sub`를 UUID로 읽는 최소
`auth.uid()` 함수를 만든 뒤 마이그레이션을 다시 검증했습니다. 실제 마이그레이션 파일에는 스텁을 넣지 않습니다.

```sql
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
```

---

## #16 `cannot change name of view column`

**증상.** 이미 생성된 뷰에 이름 열을 추가한 마이그레이션을 다시 실행하자 다음 오류가 났습니다.

```text
ERROR: cannot change name of view column "requested_at" to "requester_name"
HINT: Use ALTER VIEW ... RENAME COLUMN ... to change name of view column instead.
```

**원인.** PostgreSQL의 `create or replace view`는 기존 열의 이름과 순서를 유지해야 합니다. 기존
`requested_by, requested_at` 사이에 `requester_name`을 넣자 두 번째 열을 새로 삽입한 것이 아니라
기존 `requested_at`의 이름을 바꾸려는 것으로 해석했습니다.

**해결.** 기존 13개 열의 이름과 순서를 그대로 두고 `requester_name`, `decider_name`을 SELECT
목록 끝에 추가했습니다. 새 열을 뒤에 붙이는 변경은 기존 뷰를 삭제하지 않고 재적용할 수 있습니다.

**예방.** 배포된 뷰를 `create or replace`로 확장할 때는 기존 열 사이에 끼워 넣지 말고 항상 끝에
추가합니다. 열 순서 자체를 바꿔야 한다면 의존 객체를 확인한 뒤 별도 마이그레이션으로 처리합니다.

---

## #17 `zsh: no matches found: app/(user)/...`

**증상.** App Router 경로를 지정해 diff를 확인하려 하자 zsh가 명령 실행 전에 다음 오류를 냈습니다.

```text
zsh: no matches found: app/(user)/approvals/page.tsx
```

**원인.** zsh는 따옴표 없는 괄호를 glob 패턴으로 해석합니다. Next.js의 route group 경로에 있는
`(user)`가 파일 경로가 아니라 패턴으로 처리되어 일치 항목을 찾지 못했습니다.

**해결.** `git diff -- 'app/(user)/approvals/page.tsx'`처럼 경로 전체를 작은따옴표로 감쌌습니다.

**예방.** 괄호·대괄호가 포함된 App Router 경로는 모든 셸 명령에서 항상 따옴표로 감쌉니다.

---

## #18 `The following paths are ignored`

**증상.** Task 보고서를 다른 구현 파일과 함께 staging하려 하자 다음 안내가 출력되고 보고서만
staging되지 않았습니다.

```text
The following paths are ignored by one of your .gitignore files:
.superpowers/sdd/refactor_260911
```

**원인.** 저장소 루트 `.gitignore`가 아니라 `.superpowers/sdd/.gitignore`의 `*` 규칙이 SDD
산출물 전체를 제외합니다. 사용자가 명시적으로 요구한 보고서도 기본 `git add` 대상에서 빠집니다.

**해결.** 다른 무시 파일은 건드리지 않고 요청된 `task-2-report.md` 한 파일만 `git add -f -- <경로>`로
명시해 추적합니다.

**예방.** `.superpowers/sdd/` 아래 산출물을 커밋해야 하는 작업은 먼저 `git check-ignore -v <경로>`로
적용 규칙을 확인하고, 사용자 지정 파일만 좁게 강제 추가합니다.
