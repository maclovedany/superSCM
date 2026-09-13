# Stage 1 Supabase 수동 적용 순서

> 작성 Task 13(2026-09-11). 이 저장소의 SQL은 사용자가 Supabase SQL Editor에서 **직접, 순서대로**
> 실행합니다(AGENTS.md 없음 — refactor.md §5). 이 문서는 무엇을 어떤 순서로, 어떤 결과를
> 기대하며 적용하는지 정리합니다.
>
> **상태(2026-09-12 갱신):** 처음 작성 시점에는 stage1(Task 1~13) SQL이 배포 프로젝트에
> 하나도 적용되지 않은 상태였습니다. 그 뒤 사용자 요청으로 담당자(Claude)가 직접 적용했고,
> 지금은 stage1 전체와 이후 보정(`20260912000100`~`000800`)까지 **모두 적용되어 있습니다.**
> 적용 기록은 제목으로 찾으세요 — "적용 기록 — 2026-09-12"(stage1 본체) · "무료 플랜
> 스케줄러 적용 기록" · "관리자 계정 관리 적용 기록" · "실습 데이터 적재 기록" ·
> "가용재고 캐스트·출처 게이트 적용 기록".
>
> (이 문서는 절 **번호가 중복**돼 있습니다 — `## 6.` 과 `## 10.` 이 각각 두 번 쓰입니다.
> 문서 안의 §번호 상호참조가 이미 여럿 있어 재번호는 그 참조들을 깨뜨리므로 그대로 두고,
> 이 안내만 제목 기준으로 적었습니다.)

## 0. 적용 원칙

1. 파일 번호(타임스탬프) 순서를 반드시 지킵니다. 뒤 파일이 앞 파일이 만든 테이블·뷰를 전제합니다.
2. 한 파일을 실행한 뒤 그 파일의 "확인 쿼리"를 돌려 기대값과 맞는지 보고 다음 파일로 넘어갑니다.
3. 이미 적용한 파일은 절대 다시 고치지 않습니다. 문제가 있으면 다음 번호의 새 보정 마이그레이션을
   만듭니다(refactor.md §5-6).
4. **전체를 순서대로 다시 적용해도 안전합니다(2026-09-12 최종 fix, error.md #29).** 뒤
   마이그레이션이 뷰에 열을 덧붙인 경우(예: `0900`이 `analytics.v_item_policy`에 8열을 더함),
   앞 마이그레이션(`0100`·`0850`·STEP 6)은 **이미 넓혀진 뷰를 다시 만들지 않고 건너뜁니다**
   (`raise notice`만 남깁니다). STEP 4·STEP 7의 RLS 정책도 `drop policy if exists` 뒤에 다시
   만듭니다. 그래서 문제가 생기면 **`supabase/migrations` 전체를 파일명 순서로 다시 적용**하는
   것이 표준 복구 절차입니다. `bash supabase/tests/migration_rerun/run-all.sh`가 이 경로를
   검증합니다.
   - **주의(2026-09-12 정정):** 이 절차는 **마이그레이션 계층만** 재건합니다. 배포 DB 의
     `core`/`analytics` 객체 230개 중 27개는 `supabase/migrations` 가 아니라
     `supabase/realdata/03b-missing-objects.sql` 등 realdata 계층이 만듭니다
     (`core.v_item_master`·`core.v_fact_shipment`·`core.v_inbound_qty` 등. 경위는
     `docs/db-저장소-대조-2026-09-11.md`). **빈 DB 에서 완전히 재구성하려면
     `realdata`(01→07) 를 먼저 적용한 뒤 `migrations` 를 적용합니다.** 두 계층에 같은 뷰
     정의가 있을 때는 나중에 적용되는 마이그레이션 정의가 최종입니다.
   - `realdata` 파일을 **단독으로** 다시 실행하는 것은 `04`·`05` 만 안전합니다
     (`supabase/realdata/00-README.md`). `03b` 재실행은 이미 있는 객체 때문에 오류를 냅니다.
   - 단, `0850`처럼 뒤 파일이 넓힌 뷰를 가진 파일을 **단독으로** 다시 실행하면 그 뷰는 건너뛴
     상태 그대로입니다(넓은 정의가 유지되므로 화면에는 문제가 없습니다).
   - 이 재실행 안전 보강을 위해 **이미 적용된 5개 파일도 수정**되었습니다(아래 §5 참고).

## 1. 서버 환경변수 (Vercel 프로젝트 설정)

| 변수 | 용도 | 주의 |
|---|---|---|
| `SUPABASE_SECRET_KEY` | 서버 전용 Supabase 접속 키 | `NEXT_PUBLIC_` 접두어 금지 |
| `CRON_SECRET` | `/api/cron/*` 3개 라우트 인증 | `Authorization: Bearer <값>` 또는 `x-cron-secret` 헤더로 외부 스케줄러가 전달 |
| `RESEND_API_KEY` | 이메일 발송 | `NEXT_PUBLIC_` 접두어 금지 |
| `RESEND_FROM_EMAIL` | 발신 주소 | |
| `RESEND_REPLY_TO` | 답장 수신 주소(선택) | 발신 주소가 수신함 없는 발송 전용 하위 도메인일 때만 필요 |

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`는 기존 그대로입니다
(AGENTS.md).

## 2. 반복 작업 스케줄 — 기본은 Supabase pg_cron(`vercel.json`에는 없음)

기본 경로는 Supabase pg_cron/pg_net입니다(`docs/notification-operations.md`). `vercel.json`에는
더 이상 아래 세 라우트의 Cron 설정이 없습니다 — 관리자 계정 관리 작업에서 제거했습니다(둘 다
남겨 두면 Vercel 프로젝트가 유료 플랜으로 바뀔 때 두 경로가 동시에 켜집니다).

```json
"/api/cron/notifications"       */10 * * * *
"/api/cron/allocations"         */10 * * * *
"/api/cron/demand-submissions"  */10 * * * *
```

**10분 주기는 Vercel Hobby 플랜에서 지원되지 않습니다.** Vercel Cron 경로로 되돌리려면
`vercel.json`에 위 세 항목을 `crons` 배열로 다시 추가하고 Supabase pg_cron의 동일 작업 세
개는 꺼야 합니다 — 자세한 내용과 되돌리는 방법은 `docs/notification-operations.md`를
참고하세요. 외부 스케줄러를 쓸 때도 위 `CRON_SECRET` 헤더를 반드시 붙입니다.

## 3. Supabase 대시보드 설정

```
Project Settings → API → Data API → Exposed schemas
    public, core, analytics
```

이 설정이 없으면 화면 조회가 **에러 없이 빈 배열**로 나와 원인을 못 찾습니다(SCHEMA.md).

## 4. 마이그레이션 적용 순서

### 4-1. STEP 파일 — 이미 적용됐다고 가정(재확인 권장)

이 저장소를 넘겨받은 시점에 다음 STEP 파일들은 이미 배포 DB에 적용된 것으로 통보받았습니다.
그래도 적용 여부가 불확실하면 각 확인 쿼리를 먼저 돌려 실제 상태를 점검하세요 — 확인 쿼리가
`relation does not exist` 오류를 내면 그 파일부터(그 앞 파일 포함) 순서대로 적용해야 합니다.

| 순서 | 파일 | 내용 | 확인 쿼리 |
|---|---|---|---|
| 1 | `20260828000100_step2_auth_rbac.sql` | 인증·RBAC 스키마(`core`/`analytics` 생성, RLS 기반) | `select schema_name from information_schema.schemata where schema_name in ('core','analytics');` → 2행 |
| 2 | `20260828000200_step3_data_isolation.sql` | `raw.business_event`·`sales_order`·`item_substitute`, `core.policy_config` 등, train/test 격리 뷰 | `select count(*) from information_schema.tables where table_schema='raw' and table_name in ('business_event','sales_order','item_substitute');` → 3 |
| 3 | `20260828000300_step4_import_pipeline.sql` | 파일 적재 파이프라인(`core.upload_batch` 등) | `select count(*) from core.upload_batch;` → 오류 없이 실행되면 통과(행수는 무관) |
| 4 | `20260828000400_step5_sku_demand_profile.sql` | SKU 수요 프로파일(`analytics.v_sku_demand_profile`) | `select count(*) from analytics.v_sku_demand_profile;` → 오류 없음(19행 기대, SCHEMA.md) |
| 5 | `20260828000500_step6_baseline_forecast.sql` | SQL Baseline Forecast(`core.run_baseline_forecast` 등) | `select count(*) from core.model_config;` → 등록된 모델 행 존재 |
| 6 | `20260828000600_step7_backtest_champion.sql` | Backtest·Champion 이력 | `select count(*) from core.model_performance;` → 오류 없음(0이어도 정상, 아직 Backtest 미실행 가능) |
| 7 | `20260909000100_step16_agent_conversation.sql` | AI Agent 대화 저장(`core.agent_conversation`) | `select count(*) from core.agent_conversation;` → 오류 없음 |
| 8 | `20260911000100_step18_master.sql` | 해외법인·공급처·출항일·영업일 달력 마스터 | `select entity_id from core.supply_entity where active order by entity_id;` → JP, CN, VN, SG, NL 5행 |
| 9 | `20260911000200_step19_permission.sql` | 부서·직책 업무 권한(`core.permission`, `core.role_permission`) | `select job_role, count(*) from core.role_permission group by job_role;` → 정의된 모든 직책에 1개 이상 |

> `20260813000100_create_procurement_demand_core.sql`(레거시 `public` 프로토타입 테이블 6개)는
> **적용하지 않아도 됩니다.** `/workflow` 레거시 화면은 브라우저 로컬 상태로만 동작해 이 테이블
> 없이도 그대로 동작합니다. Task 13의 `20260911001200`은 이 테이블이 없어도(`to_regclass` 가드)
> 안전하게 통과합니다.

### 4-2. Stage 1 파일 — 2026-09-12 적용 완료 (아래 §6 기록 참고)

| 순서 | 파일 | Task | 내용 | 확인 쿼리(파일 하단에 전체 있음) |
|---|---|---|---|---|
| 10 | `20260911000300_stage1_foundation_hardening.sql` | 1 | 현재 기반 고정, 상충 정의 차단 | `select entity_id from core.supply_entity where active order by entity_id;` → 5행. `select job_role, count(*) from core.role_permission group by job_role;` → 모든 직책 1개 이상 |
| 11 | `20260911000400_stage1_approval_notification.sql` | 2·3 | 공통 승인·감사 이력·알림 엔진 | `select approval_type, status, requested_by, decided_by from core.approval_request order by requested_at desc;` — 오류 없이 실행(초기엔 0행) |
| 12 | `20260911000500_stage1_inventory_availability.sql` | 4 | 정상 창고재고·가용재고 기준(Open PO·이동중 제외) | `select item_id, reason_code from analytics.v_available_stock;` → 오늘은 전 품목 `INVENTORY_SCOPE_UNCLASSIFIED`(재고 스냅샷 없음) |
| 13 | `20260911000600_stage1_sales_order_allocation.sql` | 5 | 영업 주문·임시/확정 배정 트랜잭션 | `select n.nspname, c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname,c.relname) in (('analytics','v_available_stock'),('analytics','v_order_available_stock'));` → `security_invoker=true` |
| 14 | `20260911000610_stage1_allocation_jobs.sql` | 6 | 30일 자동 만료, 입고 후 후속 배정 | `select * from core.expire_temporary_allocations();` → 오류 없이 실행(대상 없으면 0행) |
| 15 | `20260911000700_stage1_demand_submission.sql` | 7 | 부서별 월간 수요 제출·마감 | `select core.submission_deadline('2026-04-01');` → `2026-03-30` |
| 16 | `20260911000800_stage1_approved_demand.sql` | 8 | 확정 수요·이벤트 추가 수요 승인 | `select count(*) from analytics.v_approved_demand_detail where source_code='CONFIRMED_ORDER';` → 오류 없이 실행 |
| 17 | `20260911000850_stage1_item_policy_revision.sql` | 9a | 품목 정책 변경 요청·SCM팀장 승인 | `select item_id, target_dos_approved, order_blocked from analytics.v_item_policy order by item_id;` → 승인 이력 없는 품목은 전부 `order_blocked=true` |
| 18 | `20260911000900_stage1_procurement_plan.sql` | 9b | 목표 DoS·최종 발주량 계산 | `select r.run_id, core.procurement_forecast_source_status(r.run_id) from core.forecast_run r order by r.started_at desc limit 5;` → 기존 Run은 전부 `FORECAST_INPUT_UNTRACED` (아래 §5 참고) |
| 19 | `20260911000950_stage1_master_edit.sql` | 10a | 관리자 마스터 편집(해외법인·공급처·출항일·달력) | `select * from analytics.v_master_readiness;` → `n_calendar_months_ready` 열 포함 |
| 20 | `20260911001000_stage1_procurement_schedule.sql` | 10b | 발주일·출항일·입고 차이 | `select * from analytics.v_procurement_schedule where plan_id='<승인된 plan_id>' order by item_id;` |
| 21 | `20260911001100_stage1_department_screens.sql` | 11 | 부서별 운영 화면·권한 범위 | `select * from analytics.v_urgent_order;` → SCM/서비스부 권한에 따라 행 수 다름, 마케팅부는 0행 |
| 22 | `20260911001150_stage1_inventory_kpi.sql` | 12 | 월말 재고 성과·동적 기준월 | `select * from analytics.v_current_planning_cycle;` → 취합 주기 없으면 1행, `plan_month` null, `PLANNING_CYCLE_NOT_OPEN` |
| 23 | `20260911001200_stage1_legacy_cutover.sql` | 13 | 레거시 `public` 테이블 권한 회수·폐기 표시 | `select table_name, grantee from information_schema.role_table_grants where table_schema='public' and table_name in ('planning_runs','ol_demand','sfdc_pipeline','bulk_deals','historical_actuals','demand_confirmations') and grantee in ('authenticated','anon');` → 0행 |

각 파일 하단의 "확인 쿼리" 주석 블록에 더 자세한 검증이 있습니다 — 위 표는 "이거 하나만 봐도
방향이 맞는지 안다" 수준의 대표 쿼리입니다.

## 5. 알아둬야 할 운영상 주의 (이미 문서화된 것들)

- **이미 적용된 파일 5개가 재실행 안전성 때문에 수정되었습니다(2026-09-12 최종 fix).** 내용상
  동작은 그대로이고, "다시 실행했을 때 멈추지 않게" 하는 보강만 들어갔습니다(error.md #29).
  이미 적용한 DB에 **다시 적용할 필요는 없습니다.**

  ⚠️ **"멈추지 않는다"가 "혼자 다시 실행해도 된다"는 뜻은 아닙니다.** 한 파일만 다시 실행하면,
  그 뒤 파일이 같은 함수를 다시 정의해 두었을 때 **옛 정의로 조용히 되돌아갑니다**(오류도
  `notice`도 나오지 않습니다). 실측으로 확인된 사례:

  - `20260828000300_step4_import_pipeline.sql`을 완전히 적용된 DB에서 **혼자** 다시 실행하면
    `core.commit_import_batch`가 STEP 4 원본으로 되돌아가면서 Task 4의 재고·입고 원장 반영,
    Task 12의 월말 스냅샷 반영, 다품목 upsert 삭제 키 수정이 **한꺼번에 사라집니다.**
  - `20260911000500_stage1_inventory_availability.sql`도 같은 이유로 단독 재실행 대상이 아닙니다
    (그 뒤 `20260911001150`이 같은 함수의 최종 정의를 갖고 있습니다).

  **규칙** — 어떤 파일이든 하나를 다시 실행했다면 **그 뒤 파일을 파일명 순서로 이어서 끝까지**
  다시 실행하세요. 표준 복구 절차는 지금도 "**`supabase/migrations` 전체를 파일명 순서로 다시
  적용**"입니다(§0-4). 단, 그 절차는 **마이그레이션 계층만** 재건합니다 — 빈 DB 에서 완전히
  재구성하려면 `realdata`(01→07) 를 먼저 적용해야 합니다(§0-4 주의 참고).

  | 파일 | 보강 내용 | 단독 재실행 |
  |---|---|---|
  | `20260828000300_step4_import_pipeline.sql` | RLS 정책 생성 앞에 `drop policy if exists` | ❌ **금지** — `commit_import_batch`가 원본으로 되돌아감. 반드시 뒤 파일까지 이어서 적용 |
  | `20260828000500_step6_baseline_forecast.sql` | `0900`이 `core.forecast_run`에 열을 추가한 뒤면 `analytics.v_forecast_run` 재정의를 건너뜀 | ⭕ 안전(뷰만 건너뜀) |
  | `20260828000600_step7_backtest_champion.sql` | RLS 정책 생성 앞에 `drop policy if exists` | ⭕ 안전 |
  | `20260911000100_step18_master.sql` | 뒤 파일이 넓힌 뷰 3개(`v_supplier_departure`·`v_item_policy`·`v_master_readiness`) 재정의를 건너뜀 | ⭕ 안전 |
  | `20260911000850_stage1_item_policy_revision.sql` | `0900`이 넓힌 `analytics.v_item_policy` 재정의를 건너뜀 | ⭕ 안전 |

- **`0850` 단독 재실행** — `0900`이 `analytics.v_item_policy`를 넓힌 뒤에 `0850`만 다시 실행하면,
  이제 오류 없이 그 뷰만 건너뜁니다(`raise notice`). 예전에는 `cannot drop columns from view`로
  실패했습니다(error.md #24 → #29).

- **`goods_receipt`·`purchase_order`의 `upsert` 적재 규칙이 바뀌었습니다(2026-09-12).** 덮어쓰기
  삭제 키가 문서번호(`source_record_id`) 하나에서 **(문서번호, 품목코드)**로 바뀌었습니다. 그래서
  한 입고번호·발주번호에 품목이 여러 줄이어도 모두 남습니다(예전에는 마지막 품목만 남았습니다).
  ⚠️ 뒤집어 말하면, **품목 줄을 뺀 정정본을 같은 문서번호로 다시 올려도 빠진 줄은 지워지지 않고
  그대로 남습니다.** 줄 자체를 없애야 한다면 그 배치를 `rollback`하고 다시 올리거나, 전체를 바꾸는
  `replace` 모드를 쓰세요. 다른 적재 유형(재고·품목·공급처 등)은 규칙이 바뀌지 않았습니다.
- **10분 반복 알림은 Vercel Pro 필요** — Hobby 플랜은 10분 주기 Cron을 지원하지 않습니다. 동등한
  외부 스케줄러로 대체하세요(docs/notification-operations.md).
- **`raw.usage_history`를 수동으로 바꾼 뒤에는 Forecast·Backtest를 다시 실행해야 합니다** —
  Task 9b의 입력 지문(`train_input_md5`/`test_input_md5`) 검사 때문에, 사용 이력을 바꾸고 다시
  실행하지 않으면 발주계획 계산이 "입력이 바뀜"으로 막힙니다.
- **기존 모든 Forecast Run은 `FORECAST_INPUT_UNTRACED`입니다** — Task 9b 적용 이전에 끝난 Run은
  입력 지문이 없어서, 원천 자체는 검증돼도(더미 데이터라 `FORECAST_SOURCE_UNVERIFIED`일 수도
  있음) 추적 정보가 없다는 별도 사유로 표시됩니다. 오늘 배포 DB로 Forecast를 다시 돌리기 전까지는
  발주계획 화면이 이 사유로 계산을 막는 것이 정상입니다.

## 6. 참고 — 과거 실데이터 적재 조사

`docs/db-저장소-대조-2026-09-11.md`에 이전 조사(저장소 SQL만으로 배포 DB와 같은 객체가
나오는지, `supabase/realdata/*`로 채운 6회차 실데이터 뷰 24개 등)가 정리되어 있습니다. 이번
Task 13 적용과는 별개의 이력이며, 이 문서가 다루는 stage1(Task 1~13) 순서에는 영향을 주지
않습니다.

## 6. 적용 기록 — 2026-09-12

Claude 가 세션 풀러(5432)로 직접 적용했습니다. 적용 전후 정의는 저장소에 남겼습니다.

- 적용 전: `supabase/schema-dump/pre-apply-2026-09-12-1058.sql` (5,470줄 · CREATE 226)
- 적용 후: `supabase/schema-dump/2026-09-12.sql` (17,976줄 · CREATE 520)

### 적용 중 발견한 것 — STEP 19 가 빠져 있었습니다

§4-1 은 STEP 파일이 모두 적용됐다고 가정했지만, 실제 배포 DB 에는
`20260911000200_step19_permission.sql` 이 적용돼 있지 않았습니다 (`core.role_permission`
자체가 없었습니다). stage1 전 파일이 `core.has_permission()` 에 의존하므로 선행 점검에서
중단했고, STEP 19 를 맨 앞에 넣어 함께 적용했습니다.

### 적용한 파일 (15개, 파일명 순서, 파일당 트랜잭션 1개)

`20260911000200` → `000300` → `000400` → `000500` → `000600` → `000610` → `000700` →
`000800` → `000850` → `000900` → `000950` → `001000` → `001100` → `001150` → `001200`

### 적용 후 확인 결과

| 항목 | 값 |
|---|---|
| 직책 / 권한 매핑 / 권한 코드 | 6 / 26 / 20 |
| 활성 해외법인 | CN, JP, NL, SG, VN |
| core 테이블 · analytics 뷰 · core 함수 | 62 · 62 · 125 |
| `security_invoker` 적용 뷰 | 29 |
| `core.submission_deadline('2026-04-01')` | `2026-03-30` (stage1 §3 예시와 일치) |
| 기준월 | `PLANNING_CYCLE_NOT_OPEN` (주기 미개설, 정상) |
| 레거시 public 테이블의 authenticated·anon 권한 | 0건 (회수 완료) |

### 아직 비어 있는 업무 마스터 (화면이 사유 코드만 보이는 이유)

`core.item_policy` 0행 · `core.stock_balance` 0행 · `core.supplier` 0행 ·
`core.business_calendar` 0행 · `core.forecast_run` 0행 · `core.app_user` 1행.
실데이터(`raw.dim_item` 93,868행)는 그대로이며, `raw.inventory` 43행은 5회차 더미입니다.

### SQL 로 할 수 없어 남은 일

1. Vercel 환경변수 4개(`SUPABASE_SECRET_KEY`·`CRON_SECRET`·`RESEND_API_KEY`·`RESEND_FROM_EMAIL`)와
   10분 Cron(Pro 이상 또는 동등 스케줄러) — **또는 아래 §7의 Supabase pg_cron 경로(무료 플랜).**
2. 직책·부서가 지정된 사용자 계정 생성 — 현재 `core.app_user` 1행이라 직책별 검수 불가
3. 업무 마스터 입력: 공급처, 법인 출항 준비기간, 출항일 규칙, 한국 공휴일, 품목 정책 승인
4. 취합 주기 열기(SCM 품목담당자) — 이후 기준월이 화면에 표시됨

## 7. Task 14 추가 — Supabase pg_cron 알림 스케줄러 (무료 플랜, 2026-09-12)

> §6 까지의 stage1(Task 1~13)은 이미 배포 DB 에 적용 완료된 상태입니다. 이번 절은 그 위에
> **추가**하는 것이며, 기존 마이그레이션을 다시 적용할 필요는 없습니다.

10분마다 도는 세 반복 작업(알림 발송 · 임시배정 자동 만료 · 수요 미제출 알림)을 Vercel Pro
없이 Supabase 무료 플랜 안에서 돌리기 위한 절차입니다. 배경과 동작 방식은
`docs/notification-operations.md`의 "실행 주기와 배포 조건 — 기본: Supabase pg_cron"을
먼저 읽으세요.

### 7-1. Edge Function 배포

```bash
supabase functions deploy notify --project-ref <project-ref>
```

`supabase/functions/notify/index.ts`·`core.ts` 두 파일만 있으면 됩니다(npm 의존성 없음,
`jsr:@supabase/supabase-js`를 정확한 버전으로 고정해 사용). 이 함수는 Supabase Auth JWT 검증이
아니라 자체 `CRON_SECRET` 비교로 인증합니다 — pg_net이 호출할 때 Authorization 헤더를
Supabase Auth JWT가 아니라 이 CRON_SECRET로 채우기 때문입니다.

**필수 — `supabase/config.toml`에 다음이 있어야 합니다(이미 저장소에 반영되어 있음, 확인만
하세요):**

```toml
[functions.notify]
verify_jwt = false
```

이게 없거나 `true`면 배포 즉시 Supabase 게이트웨이가 JWT부터 요구합니다. pg_net이 보내는
`Authorization: Bearer <stage1_notify_secret>`는 JWT가 아니므로 함수 코드가 실행되기도 전에
게이트웨이 단계에서 401로 막히고, `isAuthorizedRequest`의 `CRON_SECRET` 비교는 아예 호출되지
않습니다(fix round 1 · C1). `--no-verify-jwt` CLI 플래그로 매번 넘기는 대신 `config.toml`에
고정해 두어, 배포 명령을 누가 어떻게 실행해도 같은 설정이 적용되게 했습니다.

### 7-2. Edge Function 시크릿 설정

```bash
supabase secrets set CRON_SECRET='<임의의 긴 무작위 값>' --project-ref <project-ref>
# 이메일을 아직 안 쓰면 이 셋은 생략해도 됩니다(IN_APP 알림은 그대로 동작).
supabase secrets set RESEND_API_KEY='<Resend API 키>' --project-ref <project-ref>
supabase secrets set RESEND_FROM_EMAIL='<발신 주소>' --project-ref <project-ref>
# 발신 주소가 alert@send.example.com처럼 수신함 없는 발송 전용 하위 도메인이면, 답장이
# 반송되지 않도록 실제 수신 가능한 주소를 설정합니다(비우면 이전과 동일하게 동작).
supabase secrets set RESEND_REPLY_TO='<실제 수신 가능한 주소, 예: contact@example.com>' --project-ref <project-ref>
```

`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 플랫폼이 자동으로 주입하므로 직접 설정하지
않습니다.

### 7-2.5. 배포 직후 스모크 테스트 (Vault 시크릿·스케줄을 걸기 전에)

`supabase/migrations/20260912000100_stage1_pg_cron_jobs.sql`을 적용해 10분마다 자동으로
돌게 하기 **전에**, 지금까지 설정한 `CRON_SECRET`으로 먼저 수동 호출해 봅니다. pg_net은
비동기라 스케줄을 걸어 두면 실패해도 화면에 아무 것도 뜨지 않으므로, 이 단계를 건너뛰지
마세요.

```bash
# 1) 정상 CRON_SECRET(7-2에서 설정한 값)으로 200을 확인합니다(claimed 0건이어도 200이 정상).
curl -i -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<project-ref>.supabase.co/functions/v1/notify"

# 2) 일부러 틀린 값으로 401을 확인합니다(인증이 실제로 걸려 있는지 확인).
curl -i -X POST \
  -H "Authorization: Bearer wrong-value" \
  "https://<project-ref>.supabase.co/functions/v1/notify"
```

- 1번이 **401**이면 `verify_jwt`가 아직 `true`로 배포된 것입니다(위 7-1 참고) — Vault
  시크릿이나 `CRON_SECRET` 값을 고치기 전에 `config.toml`과 배포 로그부터 확인하세요.
- 1번이 200이고 2번도 200이면 인증이 아예 걸려 있지 않은 것입니다(`CRON_SECRET`이 빈
  문자열이거나 함수 시크릿이 설정되지 않음).
- 1번이 200, 2번이 401이면 정상입니다 — 이제 7-3의 Vault 시크릿을 만들고 7-4의 마이그레이션을
  적용해 스케줄을 걸어도 됩니다.

### 7-3. Vault 시크릿 생성 (SQL Editor, `postgres` 역할)

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1/notify',
  'stage1_notify_url',
  'Task 14 · 알림 Edge Function 호출 주소'
);
select vault.create_secret(
  '<7-2에서 설정한 CRON_SECRET과 같은 값>',
  'stage1_notify_secret',
  'Task 14 · 알림 Edge Function 인증 비밀값(CRON_SECRET)'
);
```

값을 나중에 바꿀 때는 새로 만들지 말고 `vault.update_secret(id, secret)`으로 교체합니다(id는
`select id from vault.secrets where name = '...'`로 조회).

### 7-4. 마이그레이션 적용

```
20260912000100_stage1_pg_cron_jobs.sql
```

pg_cron·pg_net 확장 설치(`if not exists`, 재적용 안전) 후 세 작업(`stage1-notify` ·
`stage1-expire-allocations` · `stage1-demand-reminders`)을 10분 주기로 등록합니다. 이름으로
먼저 `cron.unschedule`한 뒤 다시 `cron.schedule`하므로, 이 파일만 몇 번을 다시 적용해도
작업이 중복 등록되지 않습니다(파일 하단 확인 쿼리 참고).

### 7-5. 확인 쿼리

```sql
-- 세 작업이 모두 활성 상태인지
select jobname, schedule, active from cron.job
where jobname like 'stage1-%' order by jobname;
-- 기대: 3행, active = true

-- 최근 회차가 실제로 200을 받았는지 (claimed 0건이어도 200이 정상)
select status_code, content::text, error_msg, created
from net._http_response order by created desc limit 5;
```

`status_code = 401`이면 **먼저 7-1의 `verify_jwt = false` 배포부터 의심**하세요 — 이게
원인인 경우가 훨씬 흔합니다(fix round 1 · C1). 그게 아니면 7-2의 `CRON_SECRET`과 7-3의
`stage1_notify_secret` 값이 다른 것입니다. 자세한 디버깅 순서는
`docs/notification-operations.md`를 참고하세요.

### 7-6. 로컬에서 검증하지 못한 것

pg_cron·pg_net·Vault(`supabase_vault`)는 로컬 스크래치 PostgreSQL에 설치할 수 없어(확장
자체가 없음), 이 저장소의 자동 테스트는 SQL 문법·가드·멱등성만 확인했습니다(스텁 스키마로
직접 실행해 확인, `lib/notifications/pg-cron-migration.test.ts`).

Edge Function의 claim → 발송 직전 재검증 → 발송 → finish 루프 자체(순서, `p_retryable` 매핑,
`p_external_message_id` 전달, `skipped`/`failed` 집계)는 `supabase/functions/notify/core.ts`로
분리해 `lib/notifications/edge-notify.test.ts`가 Node에서 **실제로 실행**해 검증합니다(fix
round 1 · I6). 검증되지 않은 것은 그 루프를 감싸는 Deno/Supabase 인프라 쪽입니다 — 실제
`verify_jwt` 게이트 동작, `jsr:@supabase/supabase-js` 임포트, `Deno.serve`/`Deno.env`,
pg_cron·pg_net·Vault 확장 자체입니다. 이건 로컬에 Deno·해당 확장이 없어 실행해 볼 수
없었고, 위 7-2.5 스모크 테스트와 7-5 확인 쿼리로 컨트롤러가 배포 후 직접 검증해야 합니다.

## 8. 무료 플랜 스케줄러 적용 기록 — 2026-09-12

Vercel 유료 플랜 없이 10분 주기 작업을 돌리기 위해 Supabase 안에서 처리하도록 바꿨고,
Claude 가 배포까지 직접 수행했습니다.

### 적용한 것

| 순서 | 작업 | 결과 |
|---|---|---|
| 1 | `supabase secrets set` — `CRON_SECRET`·`RESEND_API_KEY`·`RESEND_FROM_EMAIL`·`RESEND_REPLY_TO` | 완료 |
| 2 | `supabase functions deploy notify` | `index.ts`·`core.ts` 업로드 완료 |
| 3 | 스모크 테스트 | 올바른 비밀값 200, 틀린 값 401, 헤더 없음 401 |
| 4 | Vault 비밀값 `stage1_notify_url`·`stage1_notify_secret` | 생성 완료 |
| 5 | `20260912000100_stage1_pg_cron_jobs.sql` | 적용 완료, 예약 3건 등록 |
| 6 | 확장 `pg_cron`·`pg_net` | 설치 완료 |

등록된 예약(모두 `*/10 * * * *`, active):
`stage1-notify` · `stage1-expire-allocations` · `stage1-demand-reminders`

### 배포 중 발견해 고친 결함

**`service_role` 에 `core` 스키마 USAGE 가 없었습니다.** 함수별 `grant execute ... to service_role`
은 있었지만 스키마 USAGE 가 없어, service key 로 `core` RPC 를 호출하면
`permission denied for schema core` (HTTP 500) 로 실패했습니다. Vercel Cron 경로도 같은
키·같은 호출이므로 동일하게 실패했을 것이며, 이 경로를 실제로 호출한 적이 없어 드러나지
않았을 뿐입니다. 보정: `20260912000200_service_role_schema_usage.sql` (core USAGE 만 부여,
테이블·뷰 권한은 추가하지 않음).

### 이메일 발송 확인

Resend 도메인 `send.upflash.co.kr` verified (리전 ap-northeast-1). DKIM 은
`resend._domainkey.send.upflash.co.kr`, 반송·SPF 는 `send.send.upflash.co.kr` 에 있습니다.
루트 도메인 MX 는 구글 워크스페이스 그대로라 회사 메일에 영향이 없습니다.
테스트 메일 1 통을 `insightdany@naver.com` 으로 보내 `delivered` 확인했습니다
(발신 `alert@send.upflash.co.kr`, 답장 `contact@upflash.co.kr`).

### 운영 시 주의

- Vercel Cron 경로로 되돌린 경우 그 3건과 **동시에 켜 두지 마세요**(`vercel.json`에는
  기본적으로 없습니다 — 위 §2 참고). 같은 조건을 한쪽은 영구 실패, 다른 쪽은 재시도로
  기록해 알림 이력이 모순됩니다.
- 예약이 안 도는 것 같으면 `cron.job_run_details` 를 **먼저** 보고, 그다음
  `net._http_response` 를 보세요. Vault 비밀값이 없으면 not-null 위반으로 job_run_details
  에만 남습니다.
- 함수를 다시 배포할 때는 저장소 루트에서 실행해야 `supabase/config.toml` 의
  `[functions.notify] verify_jwt = false` 가 적용됩니다. 이 설정이 빠지면 게이트웨이가
  pg_net 요청을 401 로 막고, 함수 코드는 실행조차 되지 않습니다.

### 첫 자동 실행 확인 (2026-09-12 KST 12:20)

예약 3건이 10분 경계에 모두 실행됐습니다.

| 작업 | 결과 | 비고 |
|---|---|---|
| `stage1-notify` | succeeded | pg_net 응답 HTTP 200, 본문 `{"claimed":0,"succeeded":0,"failed":0,"skipped":0,"finishErrors":[]}` |
| `stage1-demand-reminders` | succeeded | 처리 대상 없음(취합 주기 미개설) |
| `stage1-expire-allocations` | succeeded | 처리 대상 없음(임시배정 없음) |

pg_cron → pg_net → Edge Function → DB 전 구간이 연결된 것을 확인했습니다.
업무 데이터가 쌓이면 같은 경로로 앱 내 알림과 이메일이 발송됩니다.

## 9. 실습 계정 — 2026-09-12 생성

직책별 화면과 승인 흐름을 눌러 보려면 직책·부서가 지정된 계정이 필요합니다.
Auth 사용자와 `core.app_user` 프로필을 함께 만들었고, 로그인까지 확인했습니다.

| 직책 | 부서 | 이메일 | 시스템 권한 | 업무 권한 수 |
|---|---|---|---|---|
| SCM 품목담당자 | SCM | insightdany@naver.com | ADMIN | 9 |
| SCM팀장 | SCM | upflash@naver.com | USER | 7 |
| 영업담당자 | SALES | insightcha0624@gmail.com | USER | 3 |
| 서비스부 | SERVICE | imagineworld@kakao.com | USER | 3 |
| 사업강화부 | BIZ_DEV | pro-worker@daum.net | USER | 2 |
| 마케팅부 | MARKETING | alltest@nate.com | USER | 2 |

- 공통 비밀번호는 저장소에 적지 않습니다. 담당자에게 별도로 전달했으며, 관리자 화면에서
  변경할 수 있습니다. 수업 전에 바꾸기를 권합니다.
- `insightdany@naver.com` 은 기존 ADMIN 계정이라 새로 만들지 않고 직책·부서만 부여했습니다.
  ADMIN 을 유지한 이유는, 이 계정까지 USER 로 낮추면 관리자 화면에 아무도 못 들어가기
  때문입니다.
- `auth.users` 의 `on_auth_user_created` 트리거가 프로필 행을 자동 생성하므로, 새 계정을
  만들 때는 프로필을 새로 넣지 말고 **직책·부서만 갱신**하면 됩니다.
- 직책별 권한 개수는 STEP 19 의 `core.role_permission` 정의와 일치하는지 확인했습니다.

## 10. Task 15 추가 — 실습용 데이터 (2026-09-12)

수업에서 수요 제출 → 승인 → 배정 → 발주계획 → 팀장 승인 → 일정 생성까지 눌러 볼 수 있도록
실습용 데이터를 넣습니다. §6 의 "아직 비어 있는 업무 마스터"와 "SQL 로 할 수 없어 남은 일"
3·4 번을 이 절차가 채웁니다.

### 10-1. 마이그레이션 적용

| 순서 | 파일 | 내용 | 확인 쿼리 |
|---|---|---|---|
| 24 | `20260912000400_stage1_practice_dataset.sql` | 실습 데이터 표식·등기부·제거 절차 | `select * from analytics.v_practice_data_status;` → 1행, `reason_code = 'NO_PRACTICE_DATA'` |
| 25 | `20260912000500_fix_backtest_rmse_filter.sql` | ★ **STEP 7 보정** — Backtest 가 항상 실패하던 것을 고칩니다 | 아래 참고 |
| 26 | `20260912000600_practice_retire_legacy_usage.sql` | 5회차 더미 사용 이력 정리·복구 + 제거 표식 보강 | `select * from analytics.v_practice_retired_usage;` → 오류 없이 실행(정리 전이면 0행) |

> ⚠️ **순서 25 는 실습 데이터와 무관하게 반드시 적용해야 합니다.** `core.run_backtest` 가
> `FILTER specified, but sqrt is not an aggregate function` 으로 **항상 실패**하고 있었습니다
> (STEP 7 의 RMSE 식에서 FILTER 가 집계가 아니라 `sqrt()` 에 붙어 있었습니다 — error.md #32).
> 함수가 예외를 삼키고 `backtest_run.status='FAILED'` 로만 적기 때문에 호출한 쪽에서는 성공처럼
> 보였습니다. Backtest 가 실패하면 Champion 이 선정되지 않고, 발주계획의 모든 라인이
> `CHAMPION_UNAVAILABLE` 이 됩니다 — **실데이터로 돌려도 똑같이 실패합니다.**
>
> 적용 후 확인:
> ```sql
> select backtest_run_id, status, message from core.backtest_run order by started_at desc limit 1;
> -- 보정 전: FAILED · 'FILTER specified, but sqrt is not an aggregate function'
> -- 보정 후 재실행: SUCCESS · 'Backtest scoring 완료'
> ```

이 파일은 **장치만** 만들고 데이터를 넣지 않습니다. 운영 배포가 스키마를 적용하는 것만으로
더미 행이 설치되면 안 되기 때문입니다.

### 10-2. 실습 데이터 적재 — `supabase/practice-data/`

마이그레이션이 아니라 별도 폴더의 SQL 을 **의도적으로 실행할 때만** 들어갑니다. 순서와 각
파일의 확인 쿼리는 `supabase/practice-data/README.md` 에 있습니다.

```
00-open-dataset.sql → 00b-retire-legacy-usage.sql → 01-master.sql → 02-items.sql
→ 03-item-policies.sql → 04-usage-history.sql → 05-inventory.sql → 06-forecast.sql
→ 07-planning-cycle.sql
→ 08-verify.sql   ★ 여기서 확인하고 수업에 들어갑니다 (조회만 합니다)
→ 09-build-plan.sql   선택 · ⚠️ 실행하면 완전 제거가 불가능해집니다
```

**`00b-retire-legacy-usage.sql` — 5회차 더미 사용 이력 정리(되돌릴 수 있습니다).**
`raw.usage_history` 의 출처 없는 행 7,038건을 `core.retired_usage_history` 보관소로 옮깁니다.
지우지 않으며, 실습 묶음을 제거하면 `core.remove_practice_dataset` 이 자동으로 되돌립니다.
출처가 있는 행은 한 줄도 건드리지 않습니다. **실행 전에 백업을 받으세요.**

이 정리를 하면 학습 기간이 실제 달력에 맞춰집니다 — **기준월 = 실행 시점의 다음 달**
(학습 = 이번달−11개월 ~ 이번달−3개월, 검증 = 이번달−2개월 ~ 이번달). 이번 달로 잡지 않는 이유는
제출 마감일(대상월 1일 − 2일)이 이미 지나 미제출 반복 알림이 즉시 쌓이기 때문입니다.
`00b` 를 건너뛰면 기간이 더미 뒤로 밀리며, `04` 가 그 사실을 `notice` 로 알려 줍니다.

**⚠️ 정리하면 5회차 화면 일부가 빕니다.** `core.v_usage_effective` 가 `raw.usage_history` 를 기간
제한 없이 전역 집계해 `analytics.v_stockout_risk`(재고 소진 위험) · `analytics.v_usage_anomaly`
(사용량 이상)로 들어갑니다. **정리 시점부터 `99-remove.sql` 로 되돌리기 전까지** `/analysis` 의
재고 소진 위험 패널이 5회차 더미 19품목에 대해 `NO_USAGE`(계산 불가)로, 사용량 이상 패널이 빈
상태로 보이고 `/dashboard` 관련 패널과 `v_data_coverage` 기간도 줄어듭니다. 복구하면 그대로
돌아옵니다 — 그 화면을 수업에서 쓸 계획이면 이 정리를 하지 마세요(대신 실습 기준월이 미래가 됩니다).

**★ 라벨은 재사용할 수 없습니다.** 제거한 라벨(`PRACTICE-2026-09`)은 다시 열 수 없습니다.
다음 기수 실습을 준비할 때는 **실행되는 값(`supabase/practice-data/*.sql`)과 이 문서의 안내 문구를
함께** 바꿔야 합니다.

```bash
sed -i '' 's/PRACTICE-2026-09/<새 라벨>/g' \
  supabase/practice-data/*.sql 'docs/stage1-supabase-수동적용.md'
grep -rn 'PRACTICE-2026-09' supabase/ docs/ app/ lib/   # 마이그레이션 주석에만 남으면 정상
```

마이그레이션(`20260912000400`·`000600`)에도 라벨이 보이지만 **확인 쿼리 예시 주석**일 뿐 동작과
무관합니다. 화면(`/admin/practice-data`)은 등기부에서 라벨을 읽습니다. 자세한 내용은
`supabase/practice-data/README.md`.

⚠️ **`09-build-plan.sql`은 되돌릴 수 없습니다.** `core.procurement_plan`은 Task 9b 트리거가
**DRAFT 를 포함한 모든 상태에서** DELETE 를 막습니다(승인본만이 아닙니다). 계획을 만들면
계획·라인·이력과 그 계획이 참조하는 Forecast 실행·Backtest·Champion, 계획 라인이 참조하는
품목·정책·적재 원본까지 전부 남습니다. 수업에서 발주계획 단계를 보여 줄 때만 실행하고,
그 전에 `08-verify.sql` 3절의 `source_status` 가 `VERIFIED` 인지 반드시 확인하세요.

제거는 `99-remove.sql` (또는 아래 한 줄) 입니다.

```sql
select jsonb_pretty(core.remove_practice_dataset('PRACTICE-2026-09', p_confirm => true));
```

### 10-3. 반드시 알아야 할 것 세 가지

1. **원천 게이트를 완화하지 않았습니다.** Task 9b 의 게이트는 학습·검증 기간의 사용 이력이
   전부 `IMPORTED` 상태의 `usage_history` 적재 배치에서 왔을 때만 발주량을 계산합니다. 실습
   데이터는 STEP 4 적재 경로를 그대로 거쳐 그 조건을 **진짜로 만족**합니다.
   - 그래서 `04-usage-history.sql` 은 학습 기간을 **기존 미검증 행(5회차 더미 7,038행,
     `batch_id` 가 null)의 마지막 날짜 다음 달부터** 잡습니다. 날짜를 하드코딩하지 않고 실행
     시점에 계산하며, 고른 기간을 `notice` 로 출력합니다.
   - ⚠️ 그 결과 **실습 기준월이 실제 달력보다 미래일 수 있습니다.** 더미 데이터가 어디까지
     있는지에 따라 달라지며, 이상해 보여도 정상입니다.
2. **품목코드를 지어내지 않습니다.** `raw.dim_item`(실데이터 93,868행)에서 조회해서 씁니다.
   `raw.dim_item` 자체는 한 줄도 바꾸지 않습니다.
3. **화면이 실습임을 말합니다.** 재고·발주계획·월말 재고 성과·대시보드 상단에
   "이 화면의 숫자는 실습용 데이터 기반입니다" 배너가 뜨고, 적재 이력과 계획 목록에는
   `실습용` 배지가 붙습니다. 현황은 `/admin/practice-data` 에서 봅니다.

### 10-4. 제거가 지우지 못하는 것

등기부(`core.practice_object`)에 올라 있는 것만 지웁니다 — 실데이터는 등기부에 없어
**구조적으로** 지워질 수 없고, 적재 원본은 `batch_id` 로만 지우므로 `batch_id` 가 null 인
행은 어떤 경우에도 걸리지 않습니다. 다만 아래는 남으며 사유와 함께 보고됩니다.

| 남는 것 | 사유 코드 |
|---|---|
| 발주계획·라인·이력 (Task 9b 가 **모든 상태에서** 삭제를 금지) | `PLAN_IMMUTABLE_HISTORY` |
| 그 계획이 참조하는 Forecast 실행·Backtest·Champion | `PLAN_IMMUTABLE_HISTORY` |
| 계획 라인이 참조하는 품목과 그 정책 | `PLAN_REFERENCES_ITEM` |
| 학생이 실습 품목으로 만든 주문·배정·긴급발주·수급회의·이벤트 수요 | `ACTED_ON_BY_USER` |
| 실제 입고일이 입력된 발주 일정의 공급처 | `SCHEDULE_ACTUAL_RECORDED` |
| 위 품목의 행이 남은 적재 배치 | `RETAINED_FOR_BLOCKED_ITEM` |

`09-build-plan.sql` 을 실행하지 않았다면 앞 세 줄은 생기지 않고 거의 완전히 지워집니다.

**남은 객체의 등기는 일부러 지우지 않습니다.** 그래야 살아남은 실습 발주계획이 화면에서 계속
"실습용" 으로 표시됩니다 — 제거했다는 이유로 실습 숫자가 실적처럼 보이면 안 됩니다.

법인 출항 준비기간과 실습 전 활성 Forecast 설정은 `00-open-dataset.sql` 이 기록해 둔 값으로
자동 복원됩니다.

### 10-5. 검증 범위

`bash supabase/tests/practice_data/run-all.sh` 가 표식·제거·실데이터 보존을 로컬 임시 DB 에서
검증합니다(시나리오 12건). **다만 `supabase/practice-data/*.sql` 본체가 배포 DB 에서 원천
게이트를 통과하는지는 로컬에서 재현할 수 없습니다** — `raw.dim_item` 실데이터와 더미 사용
이력의 실제 날짜 분포에 의존하기 때문입니다. `08-verify.sql` 의 확인 쿼리로 적용 직후 직접
확인하세요.

## 10. 관리자 계정 관리 적용 기록 — 2026-09-12

`supabase/migrations/20260912000300_stage1_user_admin.sql` 을 운영에 적용했습니다(커밋 `98fb577` 버전).
관리자 화면 `/admin/users` 에서 계정을 만들고, 직책·부서를 바꾸고, 비활성화하거나 완전 삭제할 수 있습니다.

### 적용 결과

| 확인 항목 | 결과 |
|---|---|
| 함수 | `admin_upsert_app_user_profile` · `admin_set_app_user_active` · `admin_delete_app_user_profile` · `admin_record_auth_delete_failure` · `app_user_blocking_tables` |
| CHECK 제약 | `app_user_job_role_chk` · `app_user_department_chk` (기존 `app_user_role_check` 유지) |
| 허용값 위반 행 | 0 건 (적용 전 사전 점검에서도 0) |
| `app_user_blocking_tables` 의 authenticated 실행 권한 | 없음(내부 전용) |
| 실습 계정 직책 유지 | 6 건 |

### 리뷰에서 잡아 고친 것 — 완전 삭제가 항상 거절되던 버그

참조 검사가 `auth.users(id)` 를 참조하는 **모든** FK 를 훑는 바람에, Supabase 가 계정마다
자동 생성하는 `auth.identities` 행이 "업무 이력" 으로 잡혔습니다. 그 결과 한 번도 쓰지 않은
새 계정조차 완전 삭제가 거절됐습니다. 운영 DB 에서도 `auth` 스키마에 8 개 FK 가 있고 실습
계정에 `auth.identities` 행이 1 개 있는 것을 확인했습니다. 검사 범위를 업무 스키마
(`core`·`public`·`analytics`) 로 한정해 고쳤습니다. 이 프로젝트의 사용자 참조 FK 49 개는
전부 `core` 에 있어 누락되는 것이 없습니다.

### 운영 시 알아둘 것

- **완전 삭제는 두 단계입니다.** 비활성화한 계정만 완전 삭제할 수 있습니다. 활성 계정에서
  버튼이 비활성인 것은 의도된 동작입니다. 참조 검사와 Auth 삭제가 서로 다른 트랜잭션이라,
  그 사이에 업무 행이 생기면 데이터가 함께 지워질 수 있어 정책으로 막았습니다.
- **본인 계정은 강등·비활성화·삭제할 수 없습니다.** 관리자가 스스로를 잠그는 것을 막습니다.
  그래서 활성 관리자가 최소 1 명 남는 것이 구조적으로 보장됩니다.
- **대시보드에서 사용자를 만들 때 주의하세요.** `handle_new_auth_user` 트리거가
  `user_metadata.department` 를 그대로 복사하므로, 허용값 밖 부서를 넣으면 `auth.users`
  INSERT 자체가 실패합니다. `/admin/users` 화면을 쓰거나 부서 메타데이터를 비워 두세요.
- **Vercel 에 `SUPABASE_SECRET_KEY` 가 필요합니다.** 없으면 생성·완전 삭제만 실패하고
  편집·비활성화는 동작합니다.
- Auth 삭제가 실패하면 `core.audit_log` 에 `USER_AUTH_DELETE_FAILED` 가 남고
  `before->>'email'` 로 남겨진 Auth 사용자를 찾을 수 있습니다.

### 아직 운영에서 실행해 보지 않은 경로

계정 **생성·완전 삭제** 는 Auth Admin API 를 거치는데, 실습 계정 6 개는 이 화면이 있기 전에
제가 직접 만들었습니다. 화면 배포 후 임시 계정 하나로 생성 → 비활성화 → 완전 삭제를 한 번
돌려 보시면 전 구간이 확인됩니다.

## 11. 실습 데이터 적재 기록 — 2026-09-12

5회차 더미 사용 이력을 되돌릴 수 있게 정리한 뒤, 실습용 데이터를 정식 경로로 적재했습니다.

### 실행한 순서

| 순서 | 파일 | 결과 |
|---|---|---|
| 1 | `20260912000500_fix_backtest_rmse_filter.sql` | 적용(실습과 무관한 운영 버그 수정) |
| 2 | `20260912000400_stage1_practice_dataset.sql` | 적용 |
| 3 | `20260912000600_practice_retire_legacy_usage.sql` | 적용 |
| 4 | `00-open-dataset.sql` | 묶음 `PRACTICE-2026-09` 열림 |
| 5 | `00b-retire-legacy-usage.sql` | 7,038행 보관·정리, 출처 없는 행 0 |
| 6 | `01` ~ `07` | 마스터·품목·정책·사용량·재고·Forecast·취합주기 |
| 7 | `08-verify.sql` | 읽기 전용 검증 통과 |

`09-build-plan.sql` 은 **실행하지 않았습니다.** 이 파일만 되돌릴 수 없고, 발주계획은 수업 중
SCM 품목담당자 계정으로 화면에서 직접 만드는 편이 교육 목적에 맞습니다.

### 적재 결과

| 항목 | 값 |
|---|---|
| 기준월 | **2026-10** (제출 마감 2026-09-29) |
| 학습 / 검증 구간 | 2025-10-01 ~ 2026-06-30 / 2026-07-01 ~ 2026-09-30 |
| 원천 검증 | `VERIFIED` — 발주량 계산 가능 |
| 공급처 · 품목 | 5곳(법인별 1) · 11개(정책 10 + 분류불가 시연 1) |
| 품목 정책 | 10건 승인 완료(요청→팀장 승인 정식 절차) |
| Champion | 10품목 선정(WMA_3M, WAPE 약 0.076) |
| 재고 | 10품목 정상재고 + 1품목 `INVENTORY_SCOPE_UNCLASSIFIED` 시연 |
| stage1 예시 재현 | 필요량 120 · MOQ 50 → **최종 발주량 150** |
| 보관된 5회차 더미 | 7,038행(복구 가능) |

실데이터는 손대지 않았습니다 — `raw.dim_item` 93,868행, `raw.fact_shipment` 103,795행 그대로.

### 지금부터 알아둘 것

- **앱을 다시 배포해야 합니다.** 실습 표시(배너·배지)와 `/admin/practice-data` 화면이 새로
  추가됐습니다. 환경변수 변경은 없습니다.
- **5회차 대시보드의 재고 소진 위험·사용량 이상 패널이 비어 보입니다.** 그 화면들이 정리된
  사용 이력을 읽기 때문이며, `99-remove.sql` 로 되돌리면 함께 복구됩니다.
- **제거 절차**: `supabase/practice-data/99-remove.sql` 한 파일. 실행하면 실습 데이터가 빠지고
  5회차 더미 7,038행이 자동 복구됩니다. 사용자가 수업 중 손댄 것(승인 이력·주문 등)은
  `blocked` 로 보고되며 남습니다.
- **다음 기수**에는 라벨 `PRACTICE-2026-09` 을 재사용할 수 없습니다. README 의 `sed` 안내대로
  새 라벨로 바꿔야 합니다.
- 별도 백업 `backups/usage_history-backup-20260912-1435.sql` 을 수업이 끝날 때까지 보관하세요.

## 12. 이동 중(참고) 열을 살리려면 — 적재 경로가 아직 없습니다 (2026-09-12 메모)

`20260912000800_fix_open_po_qty_cast.sql`이 `core.v_inbound_qty`(→ `/inventory`의 "이동 중
(참고)" 열)에 Open PO와 같은 출처 게이트를 걸었습니다. 지금 배포 DB는
`raw.shipment_log` 2,864행 **전부** `batch_id`가 null이라 이 열은 항상 비어 있습니다.

**Open PO와 다른 점** — 발주·입고는 화면 업로드로 `batch_id`를 채울 수 있는 정식 경로가 이미
있습니다(`core.commit_import_batch`의 `purchase_order`·`goods_receipt` 분기). **선적
(`raw.shipment_log`)에는 그런 경로가 아예 없습니다** — `core.commit_import_batch`의
`import_type` 분기에 shipment 종류가 없고, `lib/import/schema.ts`에도 없습니다. `batch_id`
열 자체는 STEP 3(`20260828000200_step3_data_isolation.sql`)이 만들었지만 채우는 쪽이
없습니다. 유일한 기입자는 4~5회차 강의 로더이고, 그 로더는 이 열을 채우지 않습니다(22열
표에 18개 값만 넣습니다).

**이동 중(참고) 열을 실제로 쓰려면** 다음이 먼저 필요합니다.

1. `lib/import/schema.ts`에 `shipment`(또는 유사) import 종류 추가 — 필드 매핑·별칭 정의.
2. `core.commit_import_batch`(현재 3곳에 정의 — STEP 4 원본 + Task 4·Task 12 확장, 최종본은
   `20260911001150`)에 shipment 분기 추가 — 다른 종류처럼 `payload`를
   `raw.shipment_log` 컬럼에 매핑하고 `batch_id`·`source_type`을 채웁니다.
3. 화면 업로드 UI(`/admin/data-management` 등, 확인 필요)에 shipment 종류를 노출.

이 작업 없이는 이동 중(참고) 열은 구조적으로 계속 비어 있습니다(출처 게이트가 걸려 있는 한
정상 동작입니다 — 지어낸 숫자를 보여주는 것보다 낫습니다). `docs/데이터-요청목록.md`에도
같은 요청을 남겼습니다.

## 13. 가용재고 캐스트·출처 게이트 적용 기록 — 2026-09-12

`20260912000800_fix_open_po_qty_cast.sql` **1개만** 적용했습니다
(`psql --single-transaction`, 오류 0건). `supabase/realdata/03b-missing-objects.sql` 도 같은
게이트로 함께 고쳤지만 **배포에는 다시 돌리지 않았습니다** — 이미 적용된 realdata 계층이고,
배포의 최종 정의는 마이그레이션이 줍니다. `03b` 수정은 빈 DB 재구성 때 두 계층이 어긋나지
않게 하기 위한 것입니다(§0-4 주의 참고).

### 고친 문제

재고 상세 권한 보유자의 `/inventory` 화면이 **죽어 있었습니다.**

```
22P02 invalid input syntax for type numeric: "1,000"
```

`core.v_open_po_qty` 가 `발주수량` 텍스트를 그대로 숫자로 바꾸는데, 5회차 더미 발주 1행
(`PO20261024`, ITEM007)의 값이 `'1,000'` 이라 쉼표에서 터졌습니다. 한 행이 화면 전체를
막고 있었습니다.

그리고 파싱만 고치면 **더 나빠질 상황**이었습니다. `raw.purchase_order` 92행 ·
`raw.goods_receipt` 81행 · `raw.shipment_log` 2,864행이 **전부 출처(`batch_id`) 없는 더미**라,
숫자로 읽히기만 하면 지어낸 발주량 29,000과 이동중 12,137 이 실적처럼 화면에 떴을 것입니다.

### 적용 결과 (적용 전 → 후)

| 확인 | 전 | 후 |
|---|---|---|
| `analytics.v_available_stock` 열 | 13 | **13**(유지) |
| `core.v_open_po_qty` 열 | 2 | **2**(유지) |
| `core.v_inbound_qty` 열 | 4 | **4**(유지) |
| `core.v_fact_shipment` 열 | 21 | **22**(게이트용 `batch_id` 추가) |
| `core.v_open_po_qty` 전체 조회 | **22P02 오류** | **정상** |
| Open PO 표시값 | 지어낸 29,000 | **전 품목 빈칸** |
| 이동 중 표시값 | 지어낸 12,137 | **전 품목 빈칸** |
| `core.stock_balance` | 10품목 · 2,850 | **10품목 · 2,850** |
| `raw.dim_item` / `raw.fact_shipment` | 93,868 / 103,795 | **동일** |
| 출처 있는 `usage_history` / 실습 등기 | 120행 / 1건 | **동일** |

즉 **지어낸 숫자만 사라지고 검증된 숫자는 하나도 바뀌지 않았습니다.**

### 실계정 확인 (앱과 같은 경로)

| 계정 | 재고 상세 | 주문 가능 | 참고열 상태 |
|---|---|---|---|
| `upflash@naver.com` (SCM팀장) | 200 · 32행 | 200 · 32행 | 200 · 1행 |
| `insightcha0624@gmail.com` (영업담당자) | 200 · **0행**(설계대로 차단) | 200 · 32행 | 200 · 0행 |

반환 예: `000259062AA` 창고재고 150 · 가용 150 · Open PO `null` · 이동중 `null`.

### 참고열이 왜 빈칸인지 화면이 설명합니다

새 뷰 `analytics.v_stock_reference_source_status` 가 사유를 냅니다.

```
open_po_sourced_rows 0 · unsourced 92 · OPEN_PO_SOURCE_UNVERIFIED
in_transit_sourced 0 · unsourced 117 · has_import_path false · IN_TRANSIT_NO_IMPORT_PATH
```

두 사유가 다른 뜻입니다. 발주는 **업로드 경로가 있으니** 정식으로 올리면 숫자가 살아납니다.
이동 중은 **적재 경로 자체가 없어서**(§12) 그 작업을 먼저 해야 합니다.

### 되돌리려면

`core.v_open_po_qty` · `core.v_inbound_qty` · `core.v_stock_on_hand` 에서 `batch_id` 게이트
조건을 빼면 이전 동작으로 돌아갑니다. 다만 그러면 22P02 가 다시 나거나(파서까지 되돌릴 경우)
지어낸 숫자가 화면에 다시 뜹니다. 데이터는 하나도 바꾸지 않았으므로 되돌릴 데이터는 없습니다.

## 14. 표시 없는 더미 품목 게이트 적용 기록 — 2026-09-12

**두 파일을 한 트랜잭션으로** 적용했습니다.

```
psql --single-transaction \
  -f supabase/migrations/20260912000600_practice_retire_legacy_usage.sql \
  -f supabase/migrations/20260912000900_gate_item_master_dummy_rows.sql
```

### 왜 두 파일을 함께 적용했나

`0900` 이 품목 게이트를 켜고, `0600` 이 실습 제거 함수의 존재 검사를 고칩니다. **게이트만
적용하면** 실습 제거 함수가 "게이트로 가려진 품목"을 존재하지 않는 것으로 판정해 그 품목의
실습 표식을 **조용히 삭제**하는 경로가 열립니다. 그래서 둘은 함께 적용되어야 하고, 한
트랜잭션으로 묶어 순서를 틀릴 수 없게 했습니다(두 번째 파일이 실패하면 첫 파일도 롤백되는
것을 별도로 실증했습니다).

적용 당시 그 경로는 **잠들어 있었습니다** — 게이트가 없어 발현되지 않았고, 실습 품목 11개가
모두 출처 있는 행으로 뒷받침되어 실제로 지워질 표식은 0개였으며, 이 함수를 자동으로 부르는
것도 없습니다(관리자가 `/admin/practice-data` 에서 SQL 을 직접 실행해야 합니다). 그래도
수정이 준비된 상태에서 무장된 손실 경로를 남길 이유가 없어 함께 적용했습니다.

### 고친 문제

재고 화면의 기준 목록(`core.v_item_master`)에 **출처 없는 5회차 더미 품목 21개가 아무 표시
없이** 실제 품목과 섞여 있었습니다. 재고·가용수량은 `null` 로 정직하게 나왔지만, 가짜 품목
정체가 목록에 앉아 있었습니다. 게이트는 `raw.item_master.batch_id` 가 있는 행만 통과시킵니다.

**원본 데이터는 지우지 않았습니다.** 화면에서만 사라지고 `raw.item_master` 행은 그대로 남아
나중에 수정·승격할 수 있습니다. 가시성을 되돌리는 실제 방법은 **정식 업로드 경로
(`core.commit_import_batch`)로 그 행의 `batch_id` 를 채우는 것**뿐입니다(실습 등재 함수는
가시성을 복원하지 않습니다 — 측정으로 확인했습니다).

### 적용 결과 (적용 전 → 후)

| 확인 | 전 | 후 |
|---|---|---|
| `core.v_item_master` 품목 | 32 | **11** |
| 실습 품목 생존 | 11 | **11 / 11**(하나도 잃지 않음) |
| `core.stock_balance` | 10품목 · 2,850 | **10품목 · 2,850**(불변) |
| 실습 제거 함수의 품목 존재 검사 | 게이트된 뷰 기준 | **원본 표 기준** |
| 같은 함수 `SECURITY DEFINER` · `search_path` | 있음 | **보존됨** |
| 실데이터 | 93,868 / 103,795행 | **동일** |
| Open PO · 이동 중(§13) | 빈칸 | **빈칸 유지**(회귀 없음) |

### 실계정 확인 (앱과 같은 경로)

| 계정 | 재고 상세 | 품목 출처 상태 | 참고열 상태 |
|---|---|---|---|
| `upflash@naver.com` (SCM팀장) | 200 · **11행**(적용 전 32) | 200 · 1행 | 200 · 1행 |
| `insightcha0624@gmail.com` (영업담당자) | 200 · **0행**(설계대로 차단) | 200 · 0행 | 200 · 0행 |

### 재적용 안전장치

`bash supabase/tests/migration_rerun/run-all.sh` 의 사후조건이 **18개**로 늘었습니다. 그중
셋이 실습 제거 함수를 고정합니다 — 존재 검사가 원본 표 기준인지, `prosecdef = true` 인지,
`proconfig` 에 `search_path` 가 살아 있는지. `CREATE OR REPLACE FUNCTION` 은 소유자·권한은
보존하지만 **`SECURITY DEFINER` 와 `SET search_path` 는 보존하지 않아 빠뜨리면 오류 없이
조용히 사라지기** 때문입니다.

### 되돌리려면

`core.v_item_master` 정의에서 `batch_id` 게이트 조건을 빼면 됩니다(마이그레이션과
`supabase/realdata/03b-missing-objects.sql` **양쪽** — 두 계층이 같은 정의를 가져야 합니다).
그러면 표시 없는 더미 품목 21개가 화면에 다시 나타납니다. 데이터는 바꾸지 않았으므로 되돌릴
데이터는 없습니다.

## 15. HOC 팬아웃 수정 적용 기록 — 2026-09-13

`20260912001100_hoc_fanout_fix.sql` **1개만** 적용했습니다
(`psql --single-transaction -v ON_ERROR_STOP=1`, 오류 0건 — `CREATE VIEW` · `COMMENT`).
`supabase/realdata/04-core-views.sql` 도 같은 정의로 고쳤지만 **배포에는 다시 돌리지
않았습니다** — §13 과 같은 이유입니다(이미 적용된 realdata 계층이고, 배포의 최종 정의는
마이그레이션이 줍니다). realdata 수정은 빈 DB 재구성 때 두 계층이 어긋나지 않게 하기
위한 것입니다.

### 고친 문제

`core.v_part_linkage` 가 `select distinct related_item, hoc_item` 이라, 같은
`related_item` 이 서로 다른 `hoc_item` 두 개를 가리키는 **454건**을 그대로 통과시켰습니다.
`core.v_shipment_by_hoc` 가 이 뷰를 `left join` 한 뒤 `sum(qty)` 를 내므로, 팬아웃된
품목의 출고 실적이 **두 대표코드 양쪽에 각각 통째로** 합산됐습니다.

총량으로는 0.02%(956 / 4,710,425)지만, **품목 단위로는 전액이 가짜인 유령 계열이 최대
454개** 생깁니다. 품목별 출고 차트가 정확히 그 단위를 씁니다.

### 해소 규칙

`related_item` 당 **완전성**(`family` · `related_desc` · `hoc_desc` 중 채워진 칸 수)
최댓값 행만 남깁니다. 최댓값을 유일한 `hoc_item` 하나가 차지하면 그 매핑을 쓰고,
최댓값이 서로 다른 `hoc_item` 에 걸리는 **진짜 모호 2건**(`285K38666` 둘 다 빈 서술 ·
`893K40191` 둘 다 채워졌으나 서로 다른 기종)은 **임의로 고르지 않고 뷰에서 뺍니다.**
`core.v_shipment_by_hoc` 의 `coalesce(x.hoc_item, f.item_code)` 가 그 2개를 XCN
미적용(자기 코드가 대표코드)으로 되돌릴 뿐이라 총량이 보존됩니다. 그 2건은 실측상
`fact_shipment` 행 0 · 수량 0 이라 **제외 비용이 정확히 0** 입니다.

### 적용 결과 (적용 전 → 후, 배포 DB 실측)

| 확인 | 전 | 후 |
|---|---|---|
| `raw.fact_shipment` sum | 4,710,425 | **4,710,425**(불변, 원본) |
| `core.v_shipment_by_hoc` sum | 4,711,381(+956) | **4,710,425** |
| `analytics.v_shipment_trend` sum | 4,711,381 | **4,710,425** |
| `analytics.v_shipment_monthly_item` sum | — | **4,710,425** |
| `core.v_part_linkage` 행 / 중복 | 20,760 / **454** | **20,304 / 0** |
| `core.v_shipment_by_hoc` 행 | 103,097 | **102,765**(−332) |
| `analytics.v_item_demand_profile` 행 | 10,228 | **10,198** |
| `raw.bridge_xcn` | 20,760 | **20,760**(불변) |

**세 화면 경로가 갈라지지 않고 함께 옳아졌습니다.** 행 수 감소(−332)는 결함이 아니라
팬아웃 제거의 산술적 결과입니다 — 사라진 조합 332개(합계 906) + 줄어든 조합 26개(합계 50)
= **956**, 초과분과 정확히 일치하고 **새로 생긴 조합은 0** 입니다.

### 적용 직후 단언 (전부 통과)

| 단언 | 결과 |
|---|---|
| A1 합계 불변식 — 세 경로가 `raw.fact_shipment` 와 일치 | PASS |
| A2 상수 4,710,425 확인(보조) | ok |
| B 구조 — 같은 `hoc_item` 이 `item_type` 둘로 갈리는 6조합이 전부 `n_types = 2` | PASS |
| C 매핑 — 중복 0, 행 수 예측(20,304) 일치 | PASS |
| D 행 수 — 예측(102,765)과 diff 0 | PASS |
| E 모호 2건 — 임의 선택 없이 제외됨 | ok |

A 절의 1차 판정은 **`by_hoc = raw`** 이고 상수 일치는 2차입니다 — 데이터가 재적재되면
상수 검사만 허위 실패하기 때문입니다.

### 남아 있는 것 — 1홉 기준입니다

이 수정은 **`raw.bridge_xcn` 한 단계(1홉)** 만 고칩니다. `hoc_item` 이 다시 다른 행의
`related_item` 으로 이어지는 **다단계 체인은 남아 있고**, 그 경우 품목이 최종 대표코드가
아니라 중간 코드로 귀속됩니다. 총량은 보존되므로 **순수 귀속 오류**입니다(실측: 출고
553행 · 1,636 수량 · 114 품목 = 전체의 0.0347%).

체인에는 **순환**이 있어 "끝까지 따라가기"가 종료하지 않습니다 — 정본 대표코드가 정의되지
않으므로, 해소하려면 정본을 정하는 **명시적 규칙**(제외 또는 결정적 선택)이 따로 필요합니다.
별도 과제로 남겼습니다. **품목별 HOC 시계열을 발주·계획 판단에 쓰기 전에는 이 과제가
먼저 들어가야 합니다.**

### 되돌리려면

`core.v_part_linkage` 를 `select distinct related_item, hoc_item from raw.bridge_xcn` 으로
되돌리면 이전 동작으로 돌아갑니다. 다만 그러면 이중 합산이 다시 시작됩니다. 데이터는
하나도 바꾸지 않았으므로 되돌릴 데이터는 없습니다.
