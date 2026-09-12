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
| `Promise<{ error: ... }>` is not assignable to `Promise<void>` | 일반 form 액션이 값을 반환함 | [#19](#19-form-action은-promisevoid를-요구한다) |
| `column reference "notification_id" is ambiguous` | 반환 테이블 함수의 출력 열과 SQL 열 이름이 충돌 | [#20](#20-column-reference-notification_id-is-ambiguous) |
| `permission denied for table purchase_order` (security_invoker 뷰) | `analytics` 뷰가 `raw` 테이블을 직접 참조함 | [#22](#22-permission-denied-for-table-purchase_order-security_invoker-뷰에서) |
| 임시 DB에 `supabase/schema-dump/*.sql`을 복원하면 여러 오류가 연쇄로 남 | 스텁이 불완전하고 일부 마이그레이션이 정책 재적용에 취약함 | [#21](#21-schema-dumpsql-복원-임시-db-부트스트랩) |
| 도메인별 승인 결과 알림이 예상한 template_code로 저장되지 않음(값은 있는데 내용이 일반 문구) | 같은 dedupe_key를 쓰는 다른 AFTER UPDATE 트리거가 이름 알파벳 순서상 먼저 실행되어 `on conflict do nothing`에 먼저 이김 | [#23](#23-승인-결과-알림이-일반-문구로만-남고-도메인-상세-알림이-안-보인다) |
| `cannot drop columns from view` (앞 마이그레이션 재적용) | 뒤 마이그레이션이 같은 뷰 끝에 열을 덧붙인 뒤 앞 마이그레이션의 좁은 뷰 정의를 다시 실행 | [#24](#24-cannot-drop-columns-from-view) |
| `function core.xxx(unknown, unknown, integer, ...) does not exist` (smallint 인자) | 정수 리터럴(int4)이 `smallint` 파라미터로 암시적 변환되지 않아 오버로드 해석 실패 | [#25](#25-function-corexxx-does-not-exist-smallint-인자) |
| psql 스크립트에서 `syntax error at or near ":"` 또는 `column "f" does not exist` (`\gset` 뒤) | `\gset`은 NULL·빈 결과 컬럼의 변수를 **설정하지 않고**, bare(따옴표 없는) boolean 변수는 `f`/`t`로 치환돼 컬럼명처럼 파싱됨 | [#26](#26-gset-뒤-syntax-error-또는-column-f-does-not-exist) |
| `column reference "schedule_id" is ambiguous` (`ON CONFLICT (열이름)`에서) | `RETURNS TABLE`의 출력 열 이름과 `ON CONFLICT (열이름)`의 대상 열 이름이 같음 | [#27](#27-on-conflict-열이름에서-column-reference-is-ambiguous) |
| `Type 'MapIterator<...>' can only be iterated through when using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher` | `tsconfig.json`의 `target`이 `es5`라 `Map.entries()`를 바로 스프레드(`[...map.entries()]`)할 수 없음 | [#28](#28-mapiterator를-바로-스프레드할-수-없다) |
| `policy "upload_batch_active_select" for table "upload_batch" already exists` | 마이그레이션의 `create policy` 앞에 `drop policy if exists`가 없어 재적용이 멈춤 | [#29](#29-마이그레이션-전체를-두-번-적용하면-중간에서-멈춘다) |
| 마이그레이션 전체를 파일명 순서로 다시 적용하면 중간에서 멈춤(`cannot drop columns from view` · `cannot change name of view column` · `policy ... already exists`) | 뒤 파일이 앞 파일의 뷰를 넓혔거나, 정책을 drop 없이 다시 만듦 | [#29](#29-마이그레이션-전체를-두-번-적용하면-중간에서-멈춘다) |
| `npm run build`에서 `Cannot find module 'jsr:@supabase/supabase-js@2'`(Deno Edge Function 파일에서) | Next.js `tsconfig.json`이 `supabase/functions/**`도 타입체크 대상에 포함시킴 | [#30](#30-npm-run-build가-supabasefunctions의-deno-edge-function을-타입체크하려다-실패한다) |
| `ERROR: extension "pg_cron" is not available` (로컬 DB 검증 스위트 bootstrap) | 일반 로컬 PostgreSQL(Homebrew)에는 Supabase 전용 확장 `pg_cron`·`pg_net`이 없음 | [#31](#31-로컬-db-검증-스위트가-pg_cron-확장-없음으로-멈춘다) |
| Backtest 를 돌리면 항상 `status='FAILED'`, message `FILTER specified, but sqrt is not an aggregate function` | `FILTER` 절이 집계(`avg`)가 아니라 그것을 감싼 `sqrt()` 에 붙어 있음 | [#32](#32-backtest-가-항상-실패한다-filter-specified-but-sqrt-is-not-an-aggregate-function) |
| `invalid input syntax for type numeric: "1,000"` (`analytics.v_available_stock` 조회 시) | `raw.purchase_order`/`raw.goods_receipt` 텍스트 열을 콤마 허용 없이 곧바로 `::numeric` 캐스트 | [#33](#33-invalid-input-syntax-for-type-numeric-1000-콤마-섞인-텍스트-캐스트) |

## #32 Backtest 가 항상 실패한다 (`FILTER specified, but sqrt is not an aggregate function`)

**증상.** `core.run_backtest(<forecast run_id>)` 를 부르면 예외는 나지 않는데(uuid 를 정상 반환)
결과 행이 언제나 실패로 남습니다.

```sql
select backtest_run_id, status, message from core.backtest_run order by started_at desc limit 1;
-- status  = FAILED
-- message = FILTER specified, but sqrt is not an aggregate function
```

Champion 이 한 품목도 선정되지 않고, 그 결과 발주계획(Task 9b)의 모든 라인이
`CHAMPION_UNAVAILABLE` 로 계산 불가가 됩니다.

**원인.** `supabase/migrations/20260828000600_step7_backtest_champion.sql:75` 의 RMSE 식에서
`FILTER` 절이 집계 함수가 아니라 그것을 감싼 `sqrt()` 에 붙어 있었습니다.

```sql
sqrt(avg(power(...))) filter (where ...)   -- ✗ sqrt 는 집계가 아니다 → 파싱 단계에서 실패
sqrt(avg(power(...)) filter (where ...))   -- ✓ FILTER 는 avg 에 붙는다
```

PostgreSQL 에서 `FILTER` 는 집계 함수에만 붙일 수 있습니다. 같은 블록의 다른 `FILTER`
(`sum(abs(...)) filter` · `avg(abs(...)) filter`)는 집계가 바깥에 있어 정상입니다 — 틀린 곳은
RMSE 한 줄뿐이었습니다. 다른 마이그레이션의 `coalesce(sum(...) filter (...), 0)` 형태도
`FILTER` 가 `sum` 에 붙어 있어 정상입니다.

**왜 오래 드러나지 않았는가.** 두 가지가 겹쳤습니다.

1. `run_backtest` 는 본문 전체를 `begin … exception when others then … end` 로 감싸고, 실패를
   `backtest_run` 행에 `FAILED` 로 적은 뒤 **정상적으로 uuid 를 반환합니다.** 호출한 쪽은 예외를
   보지 못하므로, 반환값만 확인하면 성공한 것처럼 보입니다.
2. 기존 검증 스위트는 Backtest 결과 행을 fixture 로 **직접 넣었습니다**
   (`supabase/tests/procurement_plan/fixtures.psql` — 계산 규칙 검증에 필요한 값을 정확히 고정하려는
   의도였습니다). 그래서 이 함수를 실제로 실행한 테스트가 하나도 없었습니다.

`supabase/tests/practice_data/pipeline-fixtures.psql`(Task 15)이 실제 경로 —
`run_baseline_forecast` → `run_backtest` → Champion — 를 그대로 밟으면서 처음 잡혔습니다.

**해결.** 이미 적용된 STEP 7 파일은 고치지 않고(refactor.md §5-6) 보정 마이그레이션을 만들었습니다.

```
supabase/migrations/20260912000500_fix_backtest_rmse_filter.sql
```

`core.run_backtest` 를 `create or replace` 로 다시 정의하며 RMSE 한 줄만 바꿉니다. 이미 `FAILED`
로 남은 과거 행은 지우지 않습니다 — 그때 실제로 실패한 것이 사실이기 때문입니다. 보정 적용 뒤
다시 실행하면 새 행이 `SUCCESS` 로 생깁니다.

**예방.** 결과 행을 fixture 로 직접 넣는 검증은 "저장된 값을 읽는 쪽"만 증명합니다. 그 값을
**만드는 함수**를 한 번은 실제로 불러 보는 시나리오를 함께 두세요. 예외를 삼키고 상태 컬럼에만
적는 함수(`run_baseline_forecast` · `run_backtest`)는 반환값이 아니라 **상태 컬럼을 확인**해야
합니다.

## #29 마이그레이션 전체를 두 번 적용하면 중간에서 멈춘다

**증상.** `supabase/migrations/*.sql`를 파일명 순서로 한 번 적용한 뒤 **그대로 한 번 더** 적용하면
두 번째 회차에서 5개 파일이 멈췄습니다(2026-09-12 최종 리뷰).

```text
20260828000300_step4_import_pipeline.sql:60:  ERROR:  policy "upload_batch_active_select" for table "upload_batch" already exists
20260828000500_step6_baseline_forecast.sql:285: ERROR:  cannot change name of view column "is_stale" to "train_input_row_count"
20260828000600_step7_backtest_champion.sql:142: ERROR:  policy "backtest_run_active_select" for table "backtest_run" already exists
20260911000100_step18_master.sql:276:          ERROR:  cannot drop columns from view
20260911000850_stage1_item_policy_revision.sql:489: ERROR:  cannot drop columns from view
```

**원인.** 세 가지입니다.

1. **뒤 파일이 앞 파일의 뷰를 넓혔다.** `create or replace view`는 기존 열 뒤에 열을 덧붙일 수는
   있어도 뺄 수 없습니다(#16 · #24). `0850`·`0900`이 `analytics.v_item_policy`를, `0950`이
   `analytics.v_supplier_departure`·`v_master_readiness`를 넓힌 뒤에는 `0100`·`0850`의 좁은
   정의를 다시 실행할 수 없습니다.
2. **뒤 파일이 앞 파일의 테이블에 열을 추가했다.** `analytics.v_forecast_run`은
   `select r.*, … as is_stale` 모양이라, `0900`이 `core.forecast_run`에 지문 열 5개를 추가하자
   `r.*`가 넓어지면서 새 열이 `is_stale` **앞에** 끼어들었습니다(#16과 같은 원인).
3. **정책을 drop 없이 다시 만들었다.** STEP 4 · STEP 7의 `create policy`에는
   `drop policy if exists`가 없었습니다(#21에서 스위트 bootstrap이 우회하던 것과 같은 문제).

**해결.**

- 1·2번은 **뒤 파일이 이미 넓혀 둔 경우 앞 파일이 그 뷰를 건너뛰게** 했습니다. 앞 파일에
  `do $migration$ … if (뒤 파일이 추가한 열이 이미 있으면) raise notice … else execute $v$create or
  replace view …$v$ … end if; end $migration$;` 를 둡니다. 처음 적용(뷰가 없거나 아직 좁을 때)에는
  원래 정의가 그대로 만들어지므로 최종 상태는 달라지지 않습니다.
- `drop view … cascade`로 지우지 **않습니다.** 그 뷰에 의존하는 뒤 파일의 뷰
  (`analytics.v_inventory_performance` 등)까지 함께 사라지기 때문입니다.
- 3번은 `create policy` 앞에 `drop policy if exists` 두 줄을 넣었습니다(정책 내용은 그대로).

**예방.** `bash supabase/tests/migration_rerun/run-all.sh`가 전체를 두 번 적용해 이 경로를
검증합니다. 뷰에 열을 덧붙이는 마이그레이션을 새로 쓸 때는 이 스위트를 함께 돌리세요.

## #24 `cannot drop columns from view`

**증상.** Task 9b pre-review fix에서 `20260911000900_stage1_procurement_plan.sql`이 `analytics.v_item_policy` 끝에
`approved_*` 열 8개를 덧붙인 뒤 `bash supabase/tests/item_policy/run-all.sh`를 실행하자 bootstrap이 멈췄습니다.

```text
재적용 실패: 20260911000850_stage1_item_policy_revision.sql
psql:…/20260911000850_stage1_item_policy_revision.sql:489: ERROR:  cannot drop columns from view
```

**원인.** `create or replace view`는 기존 열 뒤에 열을 덧붙일 수는 있어도 뺄 수는 없습니다(#16의 반대 방향).
item_policy 스위트의 bootstrap은 전체 마이그레이션을 적용한 **뒤에** 0850만 한 번 더 실행해 재실행 안전성을
확인했는데, 그 시점의 뷰는 0900이 넓힌 24열이라 0850의 16열 정의로 되돌리려다 실패했습니다.

**해결.** 스위트 bootstrap이 대상 마이그레이션을 **자기 순서 자리에서 곧바로** 한 번 더 적용하도록 바꿨습니다
(`supabase/tests/item_policy/bootstrap.sh`). "0850 직후 상태에서 0850을 다시 실행해도 안전한가"라는 확인의 뜻은
그대로이고, 이후 마이그레이션까지 모두 적용된 최종 상태도 그대로입니다.

**예방.** 뒤 마이그레이션이 뷰를 확장하면 앞 마이그레이션은 **단독으로** 다시 실행할 수 없습니다(0100 → 0850의
`v_item_policy`도 같은 관계). 재실행 안전성은 그 마이그레이션 직후 상태에서 확인합니다. Supabase SQL Editor에서
옛 마이그레이션을 다시 실행해야 한다면 그 뒤 마이그레이션도 순서대로 다시 실행합니다.

## #23 승인 결과 알림이 일반 문구로만 남고 도메인 상세 알림이 안 보인다

**증상.** Task 9a에서 `core.apply_item_policy_decision()`이 승인 결과를 `core.enqueue_order_notice(
'approval:' || new.approval_id || ':decision:' || new.status, 'ITEM_POLICY_DECIDED', ...)`로 예약했는데,
`core.notification_outbox`를 확인하면 같은 dedupe_key 행이 `template_code = 'APPROVAL_DECIDED'`(Task 3의
일반 승인 결과 알림)로만 남아 있고 `ITEM_POLICY_DECIDED`는 없었습니다.

**원인.** `core.approval_request`에는 `after update of status` 트리거가 여러 개 걸려 있습니다 —
Task 3의 `approval_notification_sync`(일반 결과 알림)와 도메인별 후처리 트리거(Task 9a의
`item_policy_decision_apply` 등). PostgreSQL은 같은 시점의 트리거를 **트리거 이름의 알파벳 순서**로
실행합니다. `core.enqueue_notification`은 `(dedupe_key, recipient_user_id, channel)`에
`on conflict do nothing`을 걸어 두므로, 같은 dedupe_key(`approval:<id>:decision:<status>`)를 쓰면
먼저 실행된 트리거가 그 키를 선점하고 뒤에 실행된 트리거의 삽입은 조용히 무시됩니다.
`item_policy_decision_apply`는 `i`로 시작해 `a`로 시작하는 `approval_notification_sync`보다
항상 나중에 실행되므로 도메인 알림이 매번 졌습니다(반대로 `alloc_priority_decision_apply`는 `a`+`l`이
`a`+`p`보다 앞서 우연히 이깁니다 — 트리거 이름 순서에 기대는 설계는 이렇게 한쪽만 우연히 통과할 수
있어 위험합니다).

**해결.** 도메인 알림에는 Task 3 일반 알림과 **다른 dedupe_key**를 씁니다
(`'item_policy_revision:' || v_revision.revision_id || ':decision:' || new.status`). 두 알림이 각자
따로 쌓여 요청자는 일반 알림과 도메인 상세 알림을 모두 받습니다.

**예방.** 여러 `after update` 트리거가 같은 원장 테이블에 걸려 있고 그중 하나가 다른 트리거와 같은
`enqueue_notification` dedupe_key로 "내용을 덮어쓸" 생각이라면, 트리거 이름 알파벳 순서에 기대지 말고
직접 `select relname from pg_trigger ... order by tgname`으로 실행 순서를 확인하거나, 애초에
dedupe_key를 도메인별로 다르게 둡니다. DB 검증 스위트에 `notification_outbox`의 `template_code` ·
`payload` 내용까지 확인하는 시나리오를 넣어야 이런 승자독식 충돌이 조용히 넘어가지 않습니다.

## #22 `permission denied for table purchase_order` (security_invoker 뷰에서)

**증상**

```text
ERROR:  permission denied for table purchase_order
```

`analytics.v_available_stock`(security_invoker=true)이 `raw.purchase_order` · `raw.goods_receipt`를
상관 서브쿼리로 직접 읽자, SCM_PLANNER 권한으로 로그인한 세션에서도 이 오류가 났습니다.

**원인**

`security_invoker=true` 뷰는 뷰 소유자가 아니라 **호출자의 권한**으로 모든 참조 테이블을 읽습니다.
SCHEMA.md 규칙상 `authenticated`는 `raw` 테이블에 직접 GRANT가 없으므로(`core` 뷰를 한 번 거쳐야
합니다), security_invoker 뷰가 `raw`를 바로 참조하면 거의 항상 이 오류가 납니다.

**해결**

`raw.purchase_order` · `raw.goods_receipt` 집계를 `core.v_open_po_qty`(소유자 권한, 일반 뷰)로 빼고
`analytics.v_available_stock`은 그 결과만 `left join`으로 읽도록 고쳤습니다. `core.v_inbound_qty` ·
`core.v_stock_on_hand`와 같은 자리입니다.

**예방** 새 `security_invoker` analytics 뷰를 만들 때 `raw.*`를 직접 참조하는 줄이 있는지
`grep -n 'from raw\.\|join raw\.' <migration>.sql`로 확인합니다. 있으면 소유자 권한 `core` 뷰로
한 번 감싼 뒤 그 뷰를 참조합니다.

## #21 `schema-dump/*.sql` 복원 임시 DB 부트스트랩

**증상.** Task 4에서 `supabase/schema-dump/2026-09-11.sql`을 임시 PostgreSQL에 복원해 새
마이그레이션을 검증하려 하자, 아래 오류가 순서대로 났습니다.

```text
ERROR: schema "public" already exists
ERROR: schema "auth" does not exist
ERROR: column "raw_user_meta_data" of relation "users" does not exist
ERROR: column "created_at" does not exist  -- auth.users
ERROR: role "postgres" does not exist
ERROR: policy "upload_batch_active_select" for table "upload_batch" already exists
```

**원인.** `schema-dump/*.sql`은 `pg_dump` 스키마 전용 덤프라 `DROP SCHEMA` 없이 바로
`CREATE SCHEMA public;`으로 시작하고, `auth.users` FK · `auth.uid()` 기본값 · `raw_user_meta_data` ·
`created_at` 컬럼을 이미 있는 것으로 가정하며, `postgres`·`supabase_admin` 롤에 대한 GRANT도
들어 있습니다. 또한 STEP 4 · STEP 7 마이그레이션의 RLS 정책 생성 블록(`do $$ ... create policy ...`)에
`drop policy if exists`가 없어, 덤프에 이미 그 정책이 있는 상태로 마이그레이션을 재실행하면
"정책이 이미 있다" 오류로 멈춥니다(이 두 마이그레이션 자체의 기존 버그이며 Task 4 범위 밖입니다).

**해결.** 부트스트랩 순서를 고정합니다.

```sql
-- 1) 기본 public 스키마는 그대로 두고 auth 스텁만 먼저 만든다 (error.md #14 · #15)
create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
```

```bash
# 2) postgres · supabase_admin 롤이 없으면 만든다 (클러스터 공용 — error.md #14 참고)
psql ... -c "create role postgres superuser;" -c "create role supabase_admin superuser;"

# 3) 덤프의 "CREATE SCHEMA public;" 한 줄만 걸러내고 복원한다 (기본 public을 이미 썼으므로)
sed '/^CREATE SCHEMA public;$/d' supabase/schema-dump/2026-09-11.sql | psql ...

# 4) supabase/migrations/*.sql을 파일명 순서대로 전부 적용한다.
#    STEP 4 · STEP 7에서 "policy ... already exists"가 나면 그 파일이 만드는 정책만
#    drop policy if exists로 지운 뒤 같은 파일을 다시 실행한다.
```

**예방.** 이 스텁과 순서를 다음 Task도 그대로 재사용합니다. 검증이 끝나면 `drop database`로
지우고, 이번에 새로 만든 `postgres`·`supabase_admin` 롤은 클러스터에 남겨두거나 지워도
무방합니다(둘 다 로그인 불가 · 데이터 없음). 지웠다면 다음 Task가 2)를 다시 실행해야 합니다.

## #20 반환 테이블 함수에서 `notification_id`가 모호하다는 오류

**증상**

```text
ERROR: column reference "notification_id" is ambiguous
DETAIL: It could refer to either a PL/pgSQL variable or a table column.
```

**원인**

`returns table (notification_id ...)`로 선언한 PL/pgSQL 함수 안에서는 출력 열 이름도 변수로
취급됩니다. 같은 함수의 `UPDATE ... RETURNING notification_id`에서 테이블 별칭을 생략하면
PostgreSQL이 출력 변수와 실제 테이블 열 중 어느 것을 뜻하는지 결정할 수 없습니다.

**해결**

`UPDATE core.notification_outbox AS o`처럼 별칭을 선언하고, `RETURNING o.notification_id`와
조건절의 열을 모두 별칭으로 한정합니다. 반환 테이블 함수를 변경한 뒤에는 정적 문자열 검사만 하지
말고 임시 PostgreSQL에서 함수를 실제 호출해 모호한 열 오류까지 확인합니다.

**같은 원인의 변형 (Task 6).** `core.expire_temporary_allocations`(`returns table (order_id uuid, ...)`)
안의 `perform 1 from core.sales_order where order_id = v_order.order_id for update`와
`update core.sales_order set status = 'EXPIRED' ... where order_id = v_order.order_id`도 별칭 없이
`order_id`를 그대로 조건절에 썼다가 같은 `42702 column reference "order_id" is ambiguous` 오류가
났다(WHERE 절 왼쪽의 `order_id`가 출력 변수와 충돌 — 오른쪽 `v_order.order_id`는 레코드 필드라
문제없다). `core.sales_order s where s.order_id = ...`처럼 테이블 별칭을 붙여 해결했다. **예방.**
`returns table (...)` 함수 안에서 그 출력 열과 이름이 같은 테이블 열을 조건절에 쓸 때는 SELECT뿐
아니라 UPDATE · DELETE · PERFORM의 WHERE 절에도 예외 없이 별칭을 붙인다.

## #19 `<form action>`은 `Promise<void>`를 요구한다

**증상**

```text
Type '(formData: FormData) => Promise<{ error: string | null; }>' is not assignable to
type '(formData: FormData) => void | Promise<void>'.
```

**원인**

React의 일반 `<form action={serverAction}>`은 서버 액션이 값을 반환하지 않는 계약입니다.
`useActionState`용 액션처럼 상태 객체를 반환하면 TypeScript 빌드가 거절합니다.

**해결**

일반 form에서 직접 쓰는 읽음 처리 액션은 성공 시 반환하지 않고, 입력 또는 저장 오류는 예외로 처리했습니다.
화면에 결과 상태를 표시해야 하는 폼은 `useActionState`를 사용하고 그 훅의 액션 계약에 맞춥니다.

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

**같은 원인의 변형 (Task 5).** `grep -rln readFileSync lib --include=*.test.ts`도 zsh가 `--include=*.test.ts`를
먼저 glob으로 풀려다 `zsh: no matches found: --include=*.test.ts`로 멈췄습니다. 옵션 값에 `*`가 들어가면
`--include='*.test.ts'`처럼 값을 따옴표로 감쌉니다.

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

---

## #28 `MapIterator`를 바로 스프레드할 수 없다

**증상.** Task 11의 `app/(user)/allocations/page.tsx`에서 `Map`에 모은 MANUAL 품목 목록을 순회하려고
`[...manualItems.entries()].map(...)`를 쓰자 `npm run build`가 다음 오류로 멈췄다.

```text
Type error: Type 'MapIterator<[string, string | null]>' can only be iterated through when
using the '--downlevelIteration' flag or with a '--target' of 'es2015' or higher.
```

**원인.** `tsconfig.json`의 `target`이 `es5`다(`lib`는 `esnext`를 포함해 `Map`·`Map.entries()` 자체는
쓸 수 있지만, es5 타깃에서는 이터레이터 스프레드 문법의 트랜스파일이 기본으로 막혀 있다).

**해결.** 스프레드 대신 `Array.from(manualItems.entries())`로 바꿨다 — 이터레이터를 배열로 바꾸는
호출 형태라 es5 타깃에서도 그대로 컴파일된다.

**예방.** 이 저장소에서 `Map`·`Set`을 순회할 때는 `[...x]`가 아니라 `Array.from(x)`를 먼저 시도한다.
`tsconfig.json`의 `target`을 올리는 것은 이 작업 범위 밖이라 건드리지 않았다.

## #25 `function core.xxx(unknown, unknown, integer, ...) does not exist`(smallint 인자)

**증상.** Task 10a의 `core.set_supplier_departure_rule(p_departure_id bigint, p_supplier_id text,
p_weekday smallint, ...)`를 리터럴 인자로 호출하자 다음 오류가 났습니다.

```text
ERROR:  function core.set_supplier_departure_rule(unknown, unknown, integer, unknown, unknown, unknown, unknown, unknown, unknown) does not exist
```

**원인.** SQL에 `1`처럼 그냥 숫자를 쓰면 PostgreSQL은 그것을 `integer`(int4)로 취급합니다.
`integer → smallint`(int2) 캐스트는 `assignment` 수준이라 함수 오버로드 해석(요구하는 건 `implicit`
캐스트)에서는 쓰이지 않습니다. `null`은 `unknown`이라 아무 타입에나 맞지만, 리터럴 정수는 맞지 않아
"그런 함수가 없다"로 보입니다 — 실제로는 타입 불일치입니다.

**해결.** RPC로 호출되는 함수(화면 · 테스트가 리터럴 인자로 부르는 함수)의 파라미터 타입을
`smallint` 대신 `integer`로 넓혔습니다. 테이블 컬럼 자체는 `smallint`로 남겨도 괜찮습니다(INSERT/UPDATE
문맥의 대입 캐스트는 정상 동작합니다) — 문제는 오직 "함수 인자 타입 해석"에서만 생깁니다.

**예방.** ADMIN 명령 함수 등 SQL 리터럴로 직접 호출될 함수는 `smallint`를 파라미터 타입으로 쓰지
않습니다. 저장 컬럼이 `smallint`이어도 함수 시그니처는 `integer`로 받고 내부에서 컬럼에 대입합니다.

## #26 `\gset` 뒤 syntax error 또는 `column "f" does not exist`

**증상.** Task 10a 검증 스위트(`supabase/tests/master_edit/scenarios.psql`)에서 `\gset`으로 컬럼값을
psql 변수에 담은 뒤 참조하자 두 가지 오류가 났습니다.

```text
ERROR:  syntax error at or near ":"
ERROR:  column "f" does not exist
```

**원인.** 두 가지가 겹쳤습니다.
1. `\gset`은 컬럼값이 NULL이거나 결과행이 0건이면 해당 변수를 **설정하지 않고 비워 둡니다**(빈
   문자열로 설정하는 게 아닙니다). 그 뒤 `:'그변수'`를 쓰면 psql이 치환할 값이 없어 `:'` 가 SQL에
   그대로 남아 구문 오류가 됩니다.
2. boolean 컬럼값을 `:변수`(따옴표 없이)로 참조하면 `false`가 리터럴 `f`로 치환되어
   `... = 'f'`가 아니라 `f = 'f'`처럼 **컬럼 참조**로 파싱됩니다.

**해결.** NULL이 될 수 있는 컬럼이나 행이 없을 수 있는 조회는 `\gset`으로 변수에 담지 않고,
`masteredit_test.check((select ... is null from ...), '설명')`처럼 조건 전체를 서브쿼리 안에서
판정했습니다(item_policy 스위트가 이미 쓰던 방식). boolean 변수를 비교할 때는 반드시 `:'변수' = 't'`
처럼 따옴표로 감쌌습니다.

**예방.** psql 검증 스크립트에서 `\gset`은 "항상 값이 있는(NOT NULL이고 행이 반드시 존재하는)" 컬럼에만
쓰고, boolean·nullable 컬럼은 따옴표로 감싸거나 존재/조건 자체를 서브쿼리로 확인합니다.

## #27 `ON CONFLICT (열이름)`에서 `column reference is ambiguous`

**증상.** Task 10b `core.build_procurement_schedule(p_plan_id) RETURNS TABLE (schedule_id uuid, ...)` 안에서
`INSERT INTO core.receipt_schedule_result (...) ON CONFLICT (schedule_id) DO UPDATE ...`를 실행하자 다음
오류가 났습니다.

```text
ERROR:  column reference "schedule_id" is ambiguous
LINE 3:     on conflict (schedule_id) do update set confirmed_recei...
DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
```

**원인.** error.md #20(`RETURNING`)과 같은 종류지만 자리가 다릅니다. `RETURNS TABLE`의 출력 열은 함수
본문 전체에서 암묵적인 PL/pgSQL 변수로도 취급됩니다. `INSERT ... RETURNING 열` · `UPDATE ... SET 열 = ...`의
왼쪽은 문법상 반드시 테이블 열이라 안전하지만, `ON CONFLICT (열이름)` 충돌 대상 열 목록은 **테이블 별칭을
붙일 수 없는 bare 식별자**라서 출력 변수와 이름이 겹치면 그대로 모호해집니다.

**해결.** 열 이름 대신 제약 이름으로 지정합니다.

```sql
insert into core.receipt_schedule_result (schedule_id, confirmed_receipt_date)
values (v_schedule_id, v_confirmed_receipt_date)
on conflict on constraint receipt_schedule_result_schedule_id_key
do update set confirmed_receipt_date = excluded.confirmed_receipt_date;
```

`\d core.<표>`로 자동 생성된 제약 이름(`<표>_<열>_key`)을 먼저 확인합니다.

**예방.** `RETURNS TABLE (...)` 함수 안에서 그 출력 열과 이름이 같은 열에 `INSERT ... ON CONFLICT (열이름)`을
쓸 때는 처음부터 `ON CONFLICT ON CONSTRAINT <제약이름>`을 씁니다(#20의 `RETURNING`·WHERE 별칭 규칙과
같은 예방 습관을 ON CONFLICT 대상 열까지 넓힌다).

## #30 `npm run build`가 `supabase/functions`의 Deno Edge Function을 타입체크하려다 실패한다

**증상.** Task 14(pg_cron 알림 스케줄러)에서 `supabase/functions/notify/index.ts`(Deno Edge
Function, `jsr:@supabase/supabase-js@2` import)를 추가한 뒤 `npm run build`가 다음 오류로
실패했습니다.

```text
./supabase/functions/notify/index.ts:18:30
Type error: Cannot find module 'jsr:@supabase/supabase-js@2' or its corresponding type declarations.
```

**원인.** `tsconfig.json`의 `include`가 `**/*.ts`라 저장소 전체의 `.ts` 파일을 다 포함합니다.
`supabase/functions/**`는 Deno 런타임 전용 코드(`jsr:` 스펙파이어, `Deno.serve`, `Deno.env`)라
Next.js가 쓰는 Node 기반 TypeScript 프로젝트(`moduleResolution: bundler`)로는 애초에 해석할
수 없는 모듈 스펙입니다. 이 디렉터리는 Next.js 앱의 일부가 아니라 별도로 배포되는
Supabase CLI 산출물입니다.

**해결.** `tsconfig.json`의 `exclude`에 `supabase/functions`를 추가했습니다.

```json
"exclude": ["node_modules", "supabase/functions"]
```

Deno 코드 자체의 타입 검사는 이 tsconfig와 무관하게 `supabase functions deploy`(또는
`deno check`)가 배포 시점에 Deno 자체 타입 검사기로 수행합니다.

**예방.** Deno Edge Function을 저장소 안에 추가할 때는 `supabase/functions/` 아래에만 두고,
Next.js `tsconfig.json`의 `include`가 그 경로까지 삼키지 않는지 `npm run build`로 바로
확인합니다. 반대로 Edge Function 쪽에서 `lib/`의 Node 전용 코드(`node:crypto` 등)를 그대로
import하면 Deno 배포 쪽에서 같은 종류의 오류가 날 수 있으므로, 공유가 필요한 순수 로직은
Node 의존성이 없는 형태로 각 런타임에 맞게 따로 유지합니다.

## #31 로컬 DB 검증 스위트가 `pg_cron` 확장 없음으로 멈춘다

**증상.** 관리자 계정 관리(`supabase/tests/user_admin/`) 스위트의 `bootstrap.sh`가 전체
마이그레이션을 파일명 순서로 적용하는 중 다음 오류로 멈췄습니다.

```text
마이그레이션 실패: 20260912000100_stage1_pg_cron_jobs.sql
ERROR:  extension "pg_cron" is not available
DETAIL:  Could not open extension control file
".../share/postgresql@17/extension/pg_cron.control": No such file or directory.
```

**원인.** Task 14가 추가한 `20260912000100_stage1_pg_cron_jobs.sql`은 `create extension pg_cron` ·
`create extension pg_net`으로 시작합니다. 이 두 확장은 Supabase 플랫폼에는 기본 포함돼 있지만,
`supabase/tests/*`가 쓰는 일반 로컬 PostgreSQL(Homebrew `postgresql@17`)에는 설치돼 있지
않습니다 — 별도로 컴파일된 확장 바이너리가 필요합니다(`shared_preload_libraries` 등록과 클러스터
재시작까지 필요해, 로컬 검증 목적만으로 클러스터 전체를 건드리는 것은 다른 스위트를 동시에 쓰는
세션에 영향을 줄 수 있어 피했습니다).

**해결.** 이 스위트(`supabase/tests/user_admin/bootstrap.sh`)의 마이그레이션 적용 루프에서,
실패 로그가 정확히 `extension "pg_cron" is not available` 또는 `extension "pg_net" is not
available`일 때만 그 파일을 건너뛰고 계속 진행하도록 했습니다 — 그 외 이유로 실패하면
지금까지와 같이 즉시 멈춥니다. 이 스위트는 pg_cron 작업 자체를 검증하지 않으므로 건너뛰어도
이후 마이그레이션(0300 포함)의 스키마 상태에는 영향이 없습니다.

**예방.** `supabase/migrations/`에 확장 설치가 필요한 새 마이그레이션을 추가할 때는, 로컬
전체-마이그레이션 부트스트랩을 쓰는 다른 `supabase/tests/*` 스위트도 같은 오류를 만난다는 것을
염두에 둡니다. 이미 있는 스위트의 `bootstrap.sh`를 일괄 수정하는 대신, 새로 만드는 스위트마다
이 패턴(로그 문구로 좁혀 건너뛰기)을 반복하거나, 더 근본적으로는 pg_cron 의존 마이그레이션을
`do $$ ... exception when others then raise notice ... $$`로 감싸 확장이 없는 환경에서도
파일 자체가 통과하도록 만드는 방법이 있습니다(이번 작업 범위 밖이라 적용하지 않았습니다).

## #33 `invalid input syntax for type numeric: "1,000"` (콤마 섞인 텍스트 캐스트)

**증상.** STOCK_VIEW_ALL 등 재고 상세 권한을 가진 사용자가 `analytics.v_available_stock`을
전체 열로 조회하면(즉 `/inventory` 화면을 열면) 다음 오류로 화면 전체가 막혔습니다.

```text
22P02: invalid input syntax for type numeric: "1,000"
```

**원인.** `raw.purchase_order`에 출처 없는(batch_id·source_type 모두 null) 5회차 더미 한 줄이
`"발주수량"`에 천단위 콤마가 섞인 텍스트 `'1,000'`을 갖고 있었습니다. `core.v_open_po_qty`가
`raw.purchase_order."발주수량"`·`raw.goods_receipt."입고수량"`을 곧바로
`nullif(..., '')::numeric`으로 캐스트했는데, PostgreSQL의 numeric 입력 파서는 콤마를 허용하지
않습니다. 이 한 줄이 뷰 전체 집계(`group by`)를 실패시켰고, `analytics.v_available_stock`이
그 뷰를 매 조회마다 참조하므로 화면 전체가 막혔습니다. 92행 중 이 한 줄만 문제였는데도, 집계
쿼리는 한 줄이라도 캐스트가 실패하면 결과 전체가 아니라 쿼리 자체가 실패합니다.

**해결.** `supabase/migrations/20260912000800_fix_open_po_qty_cast.sql`이 세 가지를 더합니다.

1. `core.parse_lenient_numeric(text)`(읽기 경로 전용) — 앞뒤 공백·천단위 콤마를 뗀 뒤에도
   숫자가 아니면 예외 대신 null을 돌려줍니다. 콤마는 정상 복원 가능한 값이라 `'1,000'` →
   `1000`으로 계산에 들어가며 값을 잃지 않습니다. 그래도(콤마를 떼도) 정말 숫자가 아닌 값이
   하나라도 있는 품목은 부분합을 보여주지 않고 `open_po_qty` 전체를 null로 냅니다.
2. **출처 게이트** — 파싱만 고치는 것으로는 부족했습니다. `raw.purchase_order`·
   `raw.goods_receipt`는 배포 DB에서 **전부**(92행·81행) `batch_id`가 null인 출처 없는
   5회차 더미입니다. 파싱만 관대하게 하면 이 더미 20개 품목의 발주 텍스트가 전부 숫자로
   읽혀 Open PO 열에 실제 발주량처럼(더미 합계 28,800) 보입니다 — 죽는 화면보다 나쁜
   결과입니다("지어낸 숫자가 실데이터처럼 보이면 안 된다" 원칙 위반). 그래서
   `core.v_open_po_qty`는 발주수량·입고수량에 기여하는 행 중 `batch_id`가 없는 행이
   하나라도 있으면(파싱 가능 여부와 무관하게) 그 품목을 null로 냅니다. 지금 배포 DB는 두
   raw 표 전부 출처가 없으므로, 이 마이그레이션을 적용해도 **어떤 품목의 Open PO도 숫자로
   보이지 않습니다** — 실제 발주 데이터가 정식 업로드 경로(batch_id가 채워짐)로 들어올
   때까지는 그것이 맞는 값입니다.
3. **적재 경로는 다르게 판단합니다** — `core.apply_stock_balance_from_batch` ·
   `core.apply_month_end_inventory_snapshot_from_batch` · `core.apply_stock_receipts_from_batch`
   (raw.inventory."현재고" · raw.goods_receipt."입고수량"도 같은 무방비 캐스트였습니다)는
   `core.require_lenient_numeric(text, label)`을 씁니다 — 콤마는 받아들이지만, 그래도
   파싱 불가면 명확한 한국어 예외를 던져 배치 커밋 전체를 거부합니다. 읽기 경로는 과거에
   쌓인 raw 전체를 매번 다시 읽으므로 옛 더미 행 하나 때문에 죽으면 안 되지만, 적재 경로는
   "지금 이 배치"만 다루므로 조용히 통과시키면 틀린 값이 정본 표에 그대로 들어앉습니다.

**`analytics.v_available_stock`·`core.v_open_po_qty`에는 사유 열을 더하지 않았습니다.**
1차 수정안은 `open_po_reason_code` 열을 추가했으나, 그렇게 뷰를 넓히면 "전체를 파일명
순서로 다시 적용"하는 표준 복구 절차의 재실행 확인 단계가 `cannot drop columns from view`
로 멈춥니다(#24와 같은 현상 — 전용 스위트 `supabase/tests/migration_rerun`이 이 경로를
직접 확인합니다 — `docs/stage1-판정기록.md` Task 16 판정으로 되돌렸습니다). 사유는 새 열
대신 **새 객체**(`analytics.v_stock_reference_source_status`, 화면 배너 전용 요약 한 줄)
+ `StockReferenceStatusBanner` 컴포넌트로 안내합니다 — 이 저장소가 practice-data에 이미
쓰는 패턴과 같습니다. `analytics.v_available_stock` 자체는 이 보정에서 **전혀 재정의하지
않았습니다** — `core.v_open_po_qty`만 고쳐도 그 뷰가 참조하는 값이 쿼리 시점에 자동으로
바뀝니다.

**바로 옆 참고 열(이동 중)에도 같은 결함이 있었습니다.** `core.v_inbound_qty`(←
`core.v_fact_shipment` ← `raw.shipment_log`)는 캐스트 크래시는 없지만(`qty`가 이미 numeric
타입), `raw.shipment_log` 2,864행이 배포 DB에서 **전부** `batch_id` null이라 IN_TRANSIT
117행·수량 합 12,137이 그대로 `in_transit_qty`에 나갔습니다 — Open PO와 같은 "지어낸
숫자가 실적처럼 보이는" 결함입니다. 같은 출처 게이트를 적용했고, `raw.shipment_log.batch_id`
를 채우는 적재 경로 자체가 없어(`core.commit_import_batch`에 shipment 분기가 없습니다)
지금은 이 열이 구조적으로 항상 비어 있습니다(`docs/stage1-supabase-수동적용.md` §12에
적재 경로를 만드는 방법을 남겼습니다). `core.v_fact_shipment`·`core.v_inbound_qty`의
정본은 `supabase/realdata/03b-missing-objects.sql`이고(저장소 안에 있습니다 — 배포
전용이 아닙니다, 2026-09-11 `docs/db-저장소-대조`가 이미 편입했습니다), 이 보정이
처음으로 저장소 **마이그레이션**에도 같은 내용을 정의합니다. **메커니즘 정정**(1차
서술이 틀렸습니다): `03b`의 원래 정의는 평범한 `CREATE VIEW`라, 그 파일을 단독
재실행하면 "relation already exists" 오류로 멈출 뿐 게이트를 조용히 되돌리지
못합니다. 오히려 이번에 재실행 안전성을 위해 `CREATE VIEW`를 `CREATE OR REPLACE
VIEW`로 바꾼 것이 "조용한 되돌림" 위험을 **새로 만듭니다** — 그래서 `03b` 쪽
정의에도 같은 게이트를 반드시 함께 넣어야 했습니다(그러지 않았다면 `CREATE OR
REPLACE VIEW`로 바꾸는 순간 단독 재실행이 게이트 없는 옛 정의로 조용히 되돌아가는
새 결함을 만들 뻔했습니다). 결론(정본에도 게이트가 필요하다)은 맞았고 메커니즘
설명이 달랐습니다. **근거 추가 정정**(리뷰 라운드 3 addendum, 일곱 번째 틀린 전제):
"`03b` 단독 재실행이 문서화된 복구 절차"라는 표현도 근거가 없었습니다 —
`supabase/realdata/00-README.md`는 "`04`·`05`만 다시 실행하는 것은 안전합니다"라고만
하고(25번 줄) `03b`는 언급하지 않으며, 수동적용·README 어디에도 `03b` 단독 재실행
절차가 없습니다. 두 정의를 맞춰야 하는 진짜 이유는 "문서화된 절차"가 아니라 **두
계층의 정본 일치**입니다 — 저장소만으로 새 환경을 재구성할 때(또는 마이그레이션을
아직 적용하지 않은 시점) `realdata` 계층이 적용되는 동안은 `03b`의 정의가 그대로
유효한 상태로 남고, 그 창에서 게이트가 없으면 무방비 상태입니다. 결론(두 정의를
함께 고친다)은 여전히 맞고 근거만 바뀌었습니다.

**커밋 메시지 자체의 서술 정정**(리뷰 라운드 3 addendum) — 커밋 `7f8a00a`는
"라운드 2 리뷰가 이전 커밋(`f49e619`)을 본 오해였다"고 적었습니다. 이 서술은
사실이 아닙니다: 재리뷰어가 실측한 결과 `f49e619`에는 출처 게이트 줄이 **0개**였고,
`bbe160c`가 그 라운드 2 지적에 대한 정당한 응답으로 게이트를 추가한 것입니다 —
리뷰는 오해가 아니라 맞는 지적이었습니다. 커밋 히스토리는 다시 쓰지 않고(리베이스
위험이 메시지 한 줄을 고치는 이득보다 큽니다), 정정을 다음 커밋(`9eb6f77`) 메시지
본문과 여기에 남깁니다 — 우리 자신의 기록에도 "틀린 것을 사실처럼 남기지 않기"
원칙을 그대로 적용합니다.

같은 패턴(raw 텍스트를 곧바로 `::numeric`, 출처 게이트 없음)의 세 번째 지점
(`core.v_stock_on_hand` → `analytics.v_stockout_risk`, `/analysis` 재고 소진 위험 화면)도
저장소 전체 참조 조사 중 발견했습니다. **이쪽은 살아 있는 크래시가 아니라 잠재 결함을
선제 차단한 것입니다** — 배포 DB에서 직접 확인한 값으로 `raw.inventory."현재고"`에
파싱 불가 행이 0건이고 `core.v_stock_on_hand`·`analytics.v_stockout_risk` 모두 지금
정상 조회되며, 그 화면 자체가 지금 앱에서 아예 쿼리를 부르지 않아 도달 불가능합니다.
그래도 같은 무방비 캐스트 패턴이라 재발을 막기 위해 같은 방식으로 고쳤습니다(이 뷰도
열은 바꾸지 않았습니다).

**테스트는 컬럼 프루닝을 이기는 형태로 써야 합니다.** `count(*)`·필터된 count·품목별 열
하나만 읽는 쿼리는 고치기 전 정의에서도 플래너가 문제의 캐스트 표현식 자체를 실행 계획에서
제거해 통과할 수 있습니다 — `select *`(또는 `select count(*) from (select * from 뷰) t`,
plpgsql `for r in select * from 뷰 loop`)만 실제로 22P02를 재현합니다. 첫 테스트 초안은
이 함정에 걸려 "고치기 전엔 실패한다"는 증거가 사실은 무관한 스키마 차이(없는 열 참조)
때문이었습니다 — 실패할 수 없는 테스트였습니다.

**예방.** `raw.*` 텍스트 열을 `::numeric`으로 캐스트하는 새 뷰·함수를 추가할 때는 항상
`core.parse_lenient_numeric`(읽기)·`core.require_lenient_numeric`(적재)을 거칩니다 — 직접
캐스트하지 않습니다. 파싱을 관대하게 만드는 것만으로는 부족하다는 점도 기억합니다 — 출처
없는(batch_id null) 더미 데이터가 섞인 raw 표를 그대로 집계하면, 파싱 성공이 곧 "지어낸
숫자가 실제 값처럼 보이는" 새로운 문제를 만듭니다. 배치 필터가 없는 "전체 raw를 그룹핑하는"
읽기 경로 뷰를 새로 만들 때는 항상 출처(batch_id) 게이트가 필요한지부터 검토합니다. 사유를
화면에 알려야 할 때는 기존 analytics 뷰에 열을 더하기 전에, `core` 쪽 뷰 재정의만으로
해결되는지(값은 하위 뷰에서 자동 전파됩니다) 먼저 확인하고, 그래도 부족하면 새 열보다
새 객체(+배너 컴포넌트)를 먼저 검토합니다. 테스트는 컬럼 프루닝을 이기는 형태(`select *`
또는 plpgsql `for ... in select * from ... loop`)로 씁니다 — `count(*)`·필터된 count·
품목별 열 하나만 읽는 쿼리는 플래너가 문제의 계산식 자체를 가지치기해 고치기 전 정의에서도
통과할 수 있습니다.

이 사고를 고치는 과정에서 검증 방식 자체의 구멍도 하나 드러났습니다 — `npm test` 통과를
`npm run build` 통과의 근거로 쓰지 않습니다. 커밋 하나가 실제로는 컴포넌트 파일에 오래된
내용(`lib/inventory/model.ts`가 이미 지운 이름을 import)을 커밋했는데도 `npm test`는
423/423 통과였습니다 — Node 테스트 러너는 `.tsx`를 타입체크하지 않기 때문입니다. 작업
디렉터리에는 처음부터 올바른 내용이 있어 그 시점의 모든 로컬 검증(테스트·빌드 둘 다)이
디스크 기준으로 통과했지만, 그 통과가 "커밋된 내용도 정상"이라는 뜻은 아니었습니다.
커밋 직후에는 `git stash` 또는 클린 워크트리에서 `npm run build`를 다시 돌려 **커밋된
내용 자체**를 검증합니다.
