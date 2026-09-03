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
| `_next/static/chunks/*.js` 404 | `.next` 를 지운 뒤에도 옛 dev 서버가 살아 있음 | [#8](#8-_nextstaticchunksjs-404) |
| `PGRST106` · 406 — 스키마를 못 찾음 | `raw` 는 REST API 에 노출하지 않음 | [#9](#9-raw-스키마에-쓰지-못함) |
| `"use server" file can only export async functions` | 액션 파일이 상수를 export | [#10](#10-use-server-file-can-only-export-async-functions) |
| `column reference "..." is ambiguous` | 함수 반환 컬럼과 테이블 컬럼 이름이 같음 | [#11](#11-column-reference-is-ambiguous) |
| `npm run build` 실패 | 아래 참조 | [#7](#7-npm-run-build-가-실패한다) |
| `Type 'string \| null' is not assignable to type '"HIGH" \| ...'` | enum 성 컬럼을 삼항으로 좁힘 | [#12](#12-type-string--null-is-not-assignable-to-type-high--medium--low--null) |
| 표 안 `.hl-warn` · `.hl-crit` 이 색이 안 붙음 | CSS 선택자가 `.insight-body` 스코프 | [#13](#13-표-안에서-hl-warn--hl-crit-이-색이-안-붙는다) |
| lightgbm `OSError: Library not loaded: libomp` | OpenMP 런타임 없음 | [#14](#14-macos-에서-lightgbm-import-가-oserror-로-죽는다-forecast-service) |
| `got multiple values for argument` | `**dict` 안에 위치 인자와 같은 키 | [#15](#15-def-fa-kw-에-a--를-넘기면-typeerror-python) |
| Python 행의 `basis.method` 가 소문자로 바뀜 | dict 펼치기로 키 덮임 | [#16](#16-basis-jsonb-에-모델-explanation-을-펼쳐-넣으면-키가-덮인다-forecast-service) |
| `ERR_MODULE_NOT_FOUND` — `npm test` 만 실패 | 순수 함수 파일의 상대 import 에 `.ts` 없음 | [#17](#17-cannot-find-module-libstatus-imported-from-librecommendation-modelts) |
| `ERR_INVALID_TYPESCRIPT_SYNTAX` — `??` 와 `\|\|` 혼용 | 괄호 없이 섞음 | [#18](#18-err_invalid_typescript_syntax-nullish-coalescing-operator-requires-parens-when-mixing-with-logical-operators) |
| `Property 'isFront' does not exist` (recharts) | 2.x 예제를 3.x 에 사용 | [#19](#19-property-isfront-does-not-exist-on-type--referencedotprops-recharts-3x) |
| 권한 검사가 조용히 통과됨 | `if not (… or NULL)` 은 분기를 타지 않음 | [#20](#20-sql-권한-게이트가-null-때문에-열린다-3값-논리) |
| `TS2802 RegExpStringIterator` — tsc 만 실패 | `for…of body.matchAll()` (target es5) | [#21](#21-ts2802-type-regexpstringiterator-can-only-be-iterated-through-when-using-the---downleveliteration-flag-or-with-a---target-of-es2015-or-higher) |
| SQL 파일을 붙여넣었는데 **아무것도 설치되지 않음** | 파일 끝의 관리자 전용 함수 호출이 실패 → SQL Editor 의 암묵적 트랜잭션이 전체 롤백 | [#22](#22-sql-파일-끝의-관리자-전용-함수-호출-한-줄이-파일-전체를-롤백시킨다) |
| `UnhandledSchemeError: Reading from "node:crypto"` — build 만 실패 | `'use client'` 파일이 서버 전용 모듈을 import | [#23](#23-unhandledschemeerror-reading-from-nodecrypto-is-not-handled-by-plugins) |
| `kpi-filter` 예외를 적었는데 `npm test` 가 계속 실패 | JSX 주석 `{/* */}` 은 검사 정규식(`//`)에 안 걸림 | [#24](#24-kpi-filter-없음-예외-주석은--여야-한다-jsx-주석은-안-걸린다) |
| `structure of query does not match function result type` | `information_schema` 컬럼은 `text` 가 아니라 `sql_identifier` | [#25](#25-structure-of-query-does-not-match-function-result-type--information_schema-컬럼은-text-가-아니다) |
| `permission denied for schema analytics` — secret 키인데도 | `service_role` 의 RLS 우회는 GRANT 를 면제하지 않음 | [#26](#26-service_role-은-rls-만-우회한다--grant-는-우회하지-않는다) |

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

---

## #8 `_next/static/chunks/*.js` 404

```
Failed to load resource: the server responded with a status of 404 (Not Found)
:3000/_next/static/chunks/main-app.js
```

**증상** 화면이 뜨긴 하는데 버튼이 아무 반응이 없습니다. 업로드·폼 제출이 전부 먹통입니다.

**원인** `.next` 를 지우거나 `npm run build` 를 돌리기 **전에** 띄운 dev 서버가 그대로 살아 있습니다.
그 서버는 메모리에 든 옛 매니페스트를 보고 있는데, 그 청크 파일은 디스크에서 사라졌습니다.
`next.config.ts` 를 고친 경우에도 재기동 전에는 반영되지 않습니다.

**해결** dev 서버를 끄고 다시 띄웁니다.

```bash
pkill -f "next dev"          # 또는 실행 중인 터미널에서 Ctrl+C
rm -rf .next
npm run dev
```

브라우저에서 강력 새로고침(⌘⇧R)까지 하면 확실합니다.

**확인** 실행 중인 서버가 정말 하나인지 봅니다. 포트가 3000 이 아니라 3001 로 잡혔다면 옛 서버가 3000 을 붙들고 있는 것입니다.

```bash
ps aux | grep "next" | grep -v grep
```

---

## #9 `raw` 스키마에 쓰지 못함

```
HTTP 406  /rest/v1/usage_history   (Accept-Profile: raw)
PGRST106  The schema must be one of the following: public, core, analytics
```

**증상** 파일 검증까지는 되는데, 마지막 "적재" 에서 실패합니다.

**원인** `raw` 는 **일부러** REST API 에 노출하지 않습니다(`SCHEMA.md` · `sql/01-grants.sql`).
`core` · `analytics` 뷰가 postgres 소유(security definer)라 `raw` 를 대신 읽어주기 때문입니다.
그래서 앱에서 `supabase.schema('raw').insert()` 를 부를 수 없습니다.

**해결 — Exposed schemas 에 `raw` 를 추가하지 않습니다.**

추가하면 적재는 되지만, 로그인한 사용자가 `raw` 를 **직접 읽는 길도 함께 열립니다.**
정제를 거치지 않은 원본을 화면이 읽게 되고, 이 프로젝트가 3계층을 나눈 이유가 사라집니다.

대신 `core` 에 `security definer` 함수를 두고 앱은 그 함수만 부릅니다.

```bash
sql/09-import-commit.sql 실행   # core.import_commit(batch_id)
```

```ts
// lib/import/repository.ts
await supabase.schema('core').rpc('import_commit', { p_batch_id: batchId });
```

덤으로 적재가 한 트랜잭션에서 끝나므로, 중간에 실패해도 절반만 들어가는 일이 없습니다.

---

## #10 `"use server" file can only export async functions`

```
A "use server" file can only export async functions, found object.
app/(admin)/admin/data/upload/page.tsx (61:7) @ UploadPage
```

**증상** 화면을 열거나 버튼을 누르면 런타임 오류가 납니다. `npm run build` 는 통과합니다.

**원인** `'use server'` 를 맨 위에 둔 파일은 **async 함수만** export 할 수 있습니다.
그 파일의 export 는 전부 클라이언트에서 호출 가능한 엔드포인트가 되기 때문입니다.
상수를 하나라도 내보내면 그 파일을 쓰는 화면이 통째로 죽습니다.

```ts
// ✕ 반려
'use server';
export const EMPTY_PREVIEW = { ... };      // ← 객체
export async function analyzeUpload() {}
```

**왜 build 가 못 잡는가** 동적 페이지(`ƒ`)는 미리 렌더링하지 않아 요청 시점에야 평가됩니다.
정적 페이지였다면 빌드에서 걸렸을 것입니다.

**해결** 상수와 타입을 같은 폴더의 `state.ts` 로 옮깁니다.

```ts
// state.ts — 'use server' 없음
export type PreviewState = { ... };
export const EMPTY_PREVIEW: PreviewState = { ... };

// actions.ts
'use server';
import { EMPTY_PREVIEW, type PreviewState } from './state';
export async function analyzeUpload(): Promise<PreviewState> { ... }
```

타입만 내보내는 것은 괜찮습니다. 컴파일 때 사라지기 때문입니다.

**재발 방지** `lib/use-server-exports.test.ts` 가 `app/` 과 `lib/` 의 모든 `'use server'` 파일을
훑어 async 함수가 아닌 export 를 찾아냅니다. `npm test` 에 포함됩니다.

---

## #11 `column reference "..." is ambiguous`

```
실행에 실패했습니다: column reference "run_id" is ambiguous
```

**증상** `RETURNS TABLE (...)` 로 만든 PL/pgSQL 함수가 실행 중에 멈춥니다.

**원인** `RETURNS TABLE` 의 컬럼 이름은 함수 안에서 **변수**가 됩니다.
그 이름이 테이블 컬럼 이름과 같으면, 아래처럼 한정하지 않은 참조에서 어느 쪽인지 판단하지 못합니다.

```sql
create function core.run_baseline_forecast(...)
returns table (run_id text, ...)      -- ← run_id 가 변수가 됩니다
...
  select count(*) into v_n
    from core.forecast_result
   where run_id = v_run_id;           -- ✕ 컬럼인가 변수인가?
```

**해결** 함수 안에서 테이블 컬럼을 쓸 때 **항상 별칭을 붙입니다.**

```sql
  select count(*) into v_n
    from core.forecast_result f
   where f.run_id = v_run_id;         -- ○

  update core.forecast_run as r       -- ○ UPDATE 도 별칭을 씁니다
     set status = 'SUCCESS'
   where r.run_id = v_run_id;
```

`SET` 왼쪽은 항상 컬럼이므로 한정하지 않아도 됩니다. 문제가 되는 건 `WHERE` 와 `SELECT` 목록입니다.

**미리 막는 법** 함수를 만들 때 반환 컬럼 이름을 훑고, 그 이름이 본문에서 쓰는 테이블에 있으면
그 테이블 참조를 전부 별칭으로 바꿉니다. 이름을 바꾸는 방법도 있지만, 앱이 읽는 결과 컬럼 이름이 달라집니다.

**적용 파일** `sql/11-forecast-engine.sql` — `create or replace function` 이므로 그대로 다시 실행하면 됩니다.


---

## #12 `Type 'string | null' is not assignable to type '"HIGH" | "MEDIUM" | "LOW" | null'`

```
lib/inventory.ts(206,14): error TS2322
  Types of property 'confidence' are incompatible.
```

**증상** 뷰 컬럼(enum 성격)을 `String(value)` 로 정규화한 뒤 삼항으로 좁혀 객체 리터럴에 넣으면 `.map()` 콜백 안에서 좁혀진 타입이 유지되지 않고 `string` 으로 넓어집니다.

**해결** 좁은 union 을 돌려주는 작은 함수를 따로 둡니다. `lib/status.ts` 의 `toRiskStatus` · `toReasonCode` 와 같은 방식입니다.

```ts
function confidenceOf(value: unknown): LeadtimePolicy['confidence'] {
  switch (value) {
    case 'HIGH': case 'MEDIUM': case 'LOW': return value;
    default: return null;
  }
}
```

**예방** 뷰 컬럼이 enum 성격이면 정규화 함수를 먼저 만들고 타입을 그 함수의 반환값으로 잡습니다. (STEP 9 에서 발견)

---

## #13 표 안에서 `.hl-warn` · `.hl-crit` 이 색이 안 붙는다

**증상** 오류 없이, 강조하려던 숫자가 본문 색 그대로 나옵니다.

**원인** `styles/components.css` 의 두 규칙이 `.insight-body` 하위로만 정의돼 있었습니다.

**해결** `.table .hl-warn` · `.table .hl-crit` 규칙을 파일 끝에 추가했습니다 (STEP 9).

**예방** 기존 클래스를 새 자리에서 쓸 때는 CSS 선택자의 스코프를 먼저 확인합니다.

---

## #14 macOS 에서 lightgbm import 가 `OSError` 로 죽는다 (forecast-service)

```
OSError: dlopen(.../lightgbm/lib/lib_lightgbm.dylib, 0x0006):
  Library not loaded: @rpath/libomp.dylib
```

**원인** pip 로 lightgbm 을 깔아도 OpenMP 런타임(`libomp`)은 따라오지 않습니다.

**해결** 개발 머신은 `brew install libomp`. Docker 이미지는 `apt-get install libgomp1` (`forecast-service/Dockerfile` 에 포함).

**예방** `pytest.importorskip` 은 `ImportError` 만 잡습니다. 네이티브 라이브러리 로드 실패는 `OSError` 라 빠져나갑니다. 선택 의존성을 건너뛰는 코드는 `except Exception` 으로 받습니다 (`forecast-service/app/registry.py`).

---

## #15 `def f(a, **kw)` 에 `**{'a': ...}` 를 넘기면 `TypeError` (Python)

```
TypeError: set_job() got multiple values for argument 'run_id'
```

**원인** 결과 dict 를 `set_job(run_id, **result)` 로 넘겼는데 `result` 안에도 `run_id` 가 있었습니다. 함수 본문에서 pop 해도 소용없습니다 — 인자 바인딩 단계에서 터집니다.

**해결** 첫 인자를 위치 전용(`def set_job(run_id, /, **fields)`)으로 바꿉니다.

**예방** 단위 테스트만으로는 안 잡혔습니다. 가짜 커서로 실행 전 경로를 한 번 도는 테스트(`tests/test_db_writes.py`)를 둡니다.

---

## #16 `basis` jsonb 에 모델 explanation 을 펼쳐 넣으면 키가 덮인다 (forecast-service)

**증상** `{"method": model_id, **explanation}` 에서 explanation 의 `method` 가 최상위 `method` 를 덮어 sql/11 의 basis 와 키 모양이 달라짐.

**해결** 모델별 근거는 `basis.explanation` 아래에 중첩. 최상위 키는 sql/11 과 같게 `method` · `interval` (+ Python 은 `engine` · `service_version`).


---

## #17 `Cannot find module '…/lib/status' imported from …/lib/recommendation-model.ts`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/…/lib/status'
    imported from /…/lib/recommendation-model.ts
```

**증상** `npx tsc --noEmit` 과 `npm run build` 는 통과하는데 `npm test` 만 죽습니다. 새 테스트 파일이 아니라 그 파일이 import 하는 모듈 쪽에서 납니다.

**원인** `npm test` 는 `node --test` 로 TypeScript 를 그대로 실행합니다. Node 의 ESM 해석기는 확장자를 보완하지 않으므로 `from './status'` 가 풀리지 않습니다. Next.js 번들러는 보완해 주기 때문에 빌드는 통과합니다.

**해결** 테스트가 import 하는 `lib/*` 순수 함수 파일은 상대 import 에 `.ts` 를 붙입니다 (`lib/scm-model.ts` 가 이미 `from './status.ts'`). Supabase 클라이언트를 쓰는 조회 파일은 테스트가 닿지 않으므로 기존대로 확장자 없이 둡니다.

**예방** 순수 함수 파일(`*-model.ts`)과 조회 파일을 나눌 때 전자의 상대 import 에는 `.ts`. (STEP 10 에서 발견)

---

## #18 `ERR_INVALID_TYPESCRIPT_SYNTAX: Nullish coalescing operator(??) requires parens when mixing with logical operators`

```
lib/override-model.ts:176
    isActive: bool(row.is_active) ?? row.superseded_at === null || row.superseded_at === undefined,
SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]
```

**증상** `npm test` 가 테스트 실패가 아니라 모듈 로딩 단계에서 통째로 죽습니다. 실패한 파일은 테스트가 아니라 그 테스트가 import 한 모듈입니다.

**원인** `??` 와 `||` 를 괄호 없이 섞었습니다. `node --test` 의 타입 제거기가 파싱 자체를 거부합니다.

**해결** 뒤쪽 논리식을 괄호로 묶습니다. `bool(x) ?? (a === null || a === undefined)`

**예방** `npx tsc --noEmit` 이 같은 것을 `TS5076` 으로 먼저 잡습니다. 검증은 tsc → test → build 순서로 돌리세요. (STEP 12 에서 발견)

---

## #19 `Property 'isFront' does not exist on type … ReferenceDotProps` (recharts 3.x)

```
components/chart/comparison-chart.tsx(147,17): error TS2322
```

**증상** `npx tsc --noEmit` 에서만 납니다. recharts 2.x 예제를 그대로 옮기면 만납니다.

**원인** recharts 3.x 에서 `ReferenceDot` · `ReferenceLine` 의 `isFront` prop 이 없어졌습니다 (step.md §4.1 이 예고한 구버전 예제 문제).

**해결** `isFront` 를 지우고, 참조 도형을 `<Line>` 뒤에 둡니다. 3.x 는 JSX 순서대로 그립니다.

**예방** 차트 래퍼를 새로 만들 때 예제의 recharts 버전을 먼저 확인합니다. `package.json` 은 `recharts@3.10.1` 고정. (STEP 11 에서 발견)

---

## #20 SQL 권한 게이트가 NULL 때문에 열린다 (3값 논리)

```sql
-- ✕ app.cron_secret 이 설정되지 않으면 게이트가 통과됩니다
if not (core.is_admin() or p_secret = current_setting('app.cron_secret', true)) then
  raise exception '권한이 없습니다';
end if;
```

**증상** 오류 없이, 인증 없는 호출이 통과합니다.

**원인** 설정이 없으면 `current_setting(..., true)` 가 NULL → `p_secret = NULL` 은 NULL → `false or NULL` 은 NULL → `not NULL` 은 NULL → **`if NULL then` 은 분기를 타지 않습니다.** 즉 `raise` 가 실행되지 않고 함수가 계속 진행됩니다.

**해결** 설정을 지역 변수로 먼저 받고 NULL 을 명시적으로 배제합니다.

```sql
v_secret := current_setting('app.cron_secret', true);
if not (core.is_admin() or (v_secret is not null and v_secret <> '' and p_secret = v_secret)) then
  raise exception '권한이 없습니다';
end if;
```

**예방** `if` 조건에 NULL 이 될 수 있는 비교가 들어가면 `coalesce(..., false)` 로 감싸거나 `is not true` / `is distinct from` 를 씁니다. 특히 **anon 에 execute 를 준 함수**는 게이트를 실제로 4가지 경우(관리자 · 올바른 비밀 · 틀린 비밀 · 설정 없음)로 시험하세요. (STEP 14 에서 발견 — 검토가 잡음)

---

## #21 `TS2802: Type 'RegExpStringIterator' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher`

```
lib/approval.test.ts(52,23): error TS2802
    for (const match of body.matchAll(/…/g)) { … }
```

**증상** `npx tsc --noEmit` 만 실패합니다. `npm test` 는 통과합니다 — `node --test` 는 타입을 지우고 실행할 뿐이라 최신 Node 런타임에서 `matchAll` 반복자가 그냥 돕니다.

**원인** 이 프로젝트의 `tsconfig` target 이 `es5` 라, `matchAll` 이 돌려주는 반복자를 `for…of` 로 도는 것을 허용하지 않습니다. `target` 을 올리면 다른 파일의 출력도 함께 바뀌므로 건드리지 않습니다.

**해결** `Array.from(body.matchAll(...))` 로 배열로 받습니다.

**예방** 검증은 tsc → test → build 순서로 (#18 과 같은 이유). 두 명이 각각 겪었습니다. (STEP 13 · STEP 16)

---

## #22 SQL 파일 끝의 관리자 전용 함수 호출 한 줄이 파일 전체를 롤백시킨다

```
psql:sql/20-alert.sql:1229: ERROR:  알림 스캔 권한이 없습니다
CONTEXT:  PL/pgSQL function core.scan_alerts(text) line 40 at RAISE
```

**증상** SQL Editor 에 `sql/20-alert.sql` 을 붙여넣으면 위 오류가 납니다. 그리고 오류 한 줄만 실패한 것이 아니라 **파일이 통째로 적용되지 않습니다.** `core.alert` 테이블도, 12개 알림 룰도, `analytics.v_alert*` 뷰 4개도 없습니다. 다음에 `sql/21-dashboard.sql` 을 실행하면 `relation "analytics.v_alert_kpi" does not exist` 로 그 파일까지 넘어집니다.

**원인** 두 가지가 겹칩니다.

1. **권한** — 파일 끝 확인용 블록에 `select * from core.scan_alerts();` 가 있었습니다. 이 함수는 `core.is_admin()` 으로 막혀 있는데, SQL Editor 에는 JWT 가 없어 `auth.uid()` 가 NULL 입니다. `sql/03-auth.sql` 의 `is_admin()` 정의로는 false 라 raise 가 터집니다. (`sql/25-python-models.sql` 이 `session_user in ('postgres')` 갈래를 더해 이 경우를 통과시키지만, 번호 순서상 20 이 25 보다 먼저입니다.)
2. **트랜잭션** — SQL Editor 는 붙여넣은 스크립트 **전체를 하나의 쿼리 문자열로** 보냅니다. PostgreSQL 이 여기에 암묵적 트랜잭션을 씌우므로, 마지막 줄에서 난 오류가 **앞의 DDL 을 전부 되돌립니다.** psql 로 한 줄씩 실행할 때와 결과가 완전히 다릅니다.

**해결** SQL 파일은 DDL 만 하게 두고, 관리자 전용 함수 호출은 파일 밖으로 뺍니다. `sql/20-alert.sql` 의 그 줄은 주석 + 실행 안내로 바꿨습니다. 스캔은 `/alerts` 화면의 [지금 스캔] 버튼으로 하거나, `sql/25` 적용 후 SQL Editor 에서 그 한 줄만 따로 실행합니다.

**예방**

- 파일 끝 "확인" 블록에는 **읽기 전용 select 만** 넣습니다. `core.is_admin()` 으로 막힌 함수(`scan_alerts` · `run_baseline_forecast` · `run_backtest` · `run_virtual_operation` · `import_commit` · `set_leadtime_plan` …)를 파일 안에서 호출하지 않습니다.
- 실행 전에 `scripts/sql-verify/run.sh` 로 확인합니다. `EDITOR_TXN=1` 을 주면 SQL Editor 의 암묵적 트랜잭션을 그대로 흉내 내므로, "한 줄 실패 → 파일 전체 롤백" 을 로컬에서 볼 수 있습니다.
- 적용 순서와 재실행 규칙은 `sql/README.md` 가 기준입니다. (STEP 14 · 로컬 SQL 검증 하네스가 잡음)

---

## #23 `UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins`

```
Module build failed: UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins (Unhandled scheme).

Import trace for requested module:
node:crypto
./lib/api/auth-model.ts
./app/(admin)/admin/api/keys/key-create-form.tsx
```

**증상** `npx tsc --noEmit` 과 `npm test` 는 통과하는데 `npm run build` 만 죽습니다.

**원인** `'use client'` 컴포넌트가 서버 전용 모듈을 import 했습니다. 상수 하나를 가져오려고 쓴 import 라도, 그 모듈이 `node:crypto` 를 쓰면 **모듈 전체**가 클라이언트 번들에 딸려 들어갑니다. 웹팩은 클라이언트 번들에 `node:` 스킴을 넣을 수 없습니다.

**왜 tsc 와 test 가 못 잡는가** tsc 는 서버/클라이언트 경계를 보지 않습니다. `node --test` 는 애초에 Node 안이라 `node:crypto` 가 그냥 풀립니다. 이 경계는 **번들러만** 압니다.

**해결** 클라이언트가 실제로 필요로 하는 것만 crypto 없는 파일로 뽑아냅니다.

```ts
// lib/api/scopes.ts — 상수만. node:crypto 없음
export const API_SCOPES = [...] as const;

// lib/api/auth-model.ts — 서버 전용 (createHash 사용)
export { API_SCOPES } from './scopes.ts';   // 서버 코드는 한 곳만 보면 됩니다
```

`'use client'` 파일은 `scopes.ts` 를 import 합니다.

**예방** `'use client'` 파일이 `lib/*` 를 import 할 때, 그 모듈이 `node:` 모듈이나 Supabase 서버 클라이언트를 끌고 오지 않는지 봅니다. 상수·타입만 필요하면 파일을 나눕니다. (STEP 19 에서 발견)

---

## #24 `kpi-filter: 없음` 예외 주석은 `//` 여야 한다 (JSX 주석은 안 걸린다)

```
✖ KPI 카드가 있는 화면은 카드를 눌러 목록을 좁힐 수 있다
  app/(admin)/admin/api/docs/page.tsx — KpiCard 와 DataTable 이 있는데 filter 가 없습니다
```

**증상** 예외 사유를 분명히 적었는데도 `npm test` 가 계속 그 파일을 지적합니다.

**원인** `lib/kpi-filter.test.ts` 의 검사 정규식이 `//` 로 시작하는 줄만 봅니다. JSX 안에 `{/* kpi-filter: 없음 — … */}` 로 적으면 걸리지 않습니다.

**해결** 파일 머리나 TS 코드 영역에 `//` 줄 주석으로 적습니다. 줄표는 em dash(`—`) 여야 하고 뒤에 사유가 있어야 합니다.

**예방** 이 예외는 **일부러** 눈에 띄게 만들어 두었습니다. 조용히 빠져나가지 못하게 하려는 것이므로, 정규식을 넓히지 말고 주석 위치를 옮기세요. (STEP 19 에서 발견)

---

## #25 `structure of query does not match function result type` — `information_schema` 컬럼은 `text` 가 아니다

```
ERROR:  structure of query does not match function result type
DETAIL:  Returned type information_schema.sql_identifier[] does not match expected type text[] in column 3.
```

**증상** SQL 파일은 처음 실행도 재실행도 멀쩡히 통과하는데, 그 함수를 **실제로 부르면** 터집니다.

**원인** `analytics.v_raw_schema` 는 `information_schema.columns` 를 그대로 내보냅니다. `column_name` 의 타입이 `text` 가 아니라 `information_schema.sql_identifier` 이고, `array_agg(column_name)` 은 `sql_identifier[]` 가 되어 `returns table (… text[])` 와 맞지 않습니다.

**해결** 명시적으로 캐스팅합니다. 비교에 쓸 때도 마찬가지입니다.

```sql
select coalesce(array_agg(c.column_name::text), '{}')
  from analytics.v_raw_schema c
 where c.table_name::text = v_table;
```

**예방** `create function` 은 본문의 타입을 검사하지 않습니다. **파일이 통과했다는 것은 파싱만 됐다는 뜻입니다** (#11 과 같은 계열). `information_schema` 를 읽는 `RETURNS TABLE` 함수는 반드시 한 번 호출해 보세요 — `scripts/sql-verify/run.sh` 가 그 일을 합니다. (STEP 19 에서 발견)

---

## #26 `service_role` 은 RLS 만 우회한다 — GRANT 는 우회하지 않는다

```
ERROR:  permission denied for schema analytics
```

**증상** secret 키(`service_role`)로 붙었는데도 조회가 막힙니다. 환경변수를 잘못 넣은 것으로 오해하기 쉽습니다.

**원인** `service_role` 은 `BYPASSRLS` 속성으로 **행 수준 보안만** 건너뜁니다. 스키마 `usage` 와 테이블·뷰 `select` 는 여느 롤과 똑같이 GRANT 가 있어야 합니다. `sql/28-anon-lockdown.sql` 이 `anon` 의 권한을 거둘 때, 아무도 `service_role` 에 명시적으로 준 적이 없다는 사실이 드러난 것입니다.

**해결** 필요한 객체에만 명시적으로 줍니다 (`sql/26-api.sql` §10-2 — 뷰 9개와 함수 1개. 쓰기 권한은 주지 않습니다).

```sql
grant usage on schema analytics to service_role;
grant select on analytics.v_stockout_risk to service_role;   -- 필요한 것만 한 줄씩
```

**예방** "이 키는 관리자니까 다 될 것" 이라고 넘기지 마세요. RLS 와 GRANT 는 **서로 다른 층**입니다 (#3·#4·#5 의 3층 구조와 같은 이야기). 권한을 회수하는 파일을 새로 만들었다면, 그 뒤에 **각 롤로 실제 조회를 한 번씩 해 보세요.** (STEP 19 에서 발견)
