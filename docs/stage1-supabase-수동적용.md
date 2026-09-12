# Stage 1 Supabase 수동 적용 순서

> 작성 Task 13(2026-09-11). 이 저장소의 SQL은 사용자가 Supabase SQL Editor에서 **직접, 순서대로**
> 실행합니다(AGENTS.md 없음 — refactor.md §5). 오늘 기준 배포 Supabase 프로젝트에는 이번
> stage1(Task 1~13) SQL이 **하나도 적용되지 않았습니다.** 이 문서는 무엇을 어떤 순서로,
> 어떤 결과를 기대하며 적용하는지 정리합니다.

## 0. 적용 원칙

1. 파일 번호(타임스탬프) 순서를 반드시 지킵니다. 뒤 파일이 앞 파일이 만든 테이블·뷰를 전제합니다.
2. 한 파일을 실행한 뒤 그 파일의 "확인 쿼리"를 돌려 기대값과 맞는지 보고 다음 파일로 넘어갑니다.
3. 이미 적용한 파일은 절대 다시 고치지 않습니다. 문제가 있으면 다음 번호의 새 보정 마이그레이션을
   만듭니다(refactor.md §5-6).
4. **전체를 순서대로 다시 적용해도 안전합니다(2026-09-12 최종 fix, error.md #29).** 뒤
   마이그레이션이 뷰에 열을 덧붙인 경우(예: `0900`이 `analytics.v_item_policy`에 8열을 더함),
   앞 마이그레이션(`0100`·`0850`·STEP 6)은 **이미 넓혀진 뷰를 다시 만들지 않고 건너뜁니다**
   (`raise notice`만 남깁니다). STEP 4·STEP 7의 RLS 정책도 `drop policy if exists` 뒤에 다시
   만듭니다. 그래서 문제가 생기면 **전체를 파일명 순서로 다시 적용**하는 것이 표준 복구
   절차입니다. `bash supabase/tests/migration_rerun/run-all.sh`가 이 경로를 검증합니다.
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

`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`는 기존 그대로입니다
(AGENTS.md).

## 2. Vercel Cron 설정 (`vercel.json`, 이미 저장소에 있음)

```json
"/api/cron/notifications"       */10 * * * *
"/api/cron/allocations"         */10 * * * *
"/api/cron/demand-submissions"  */10 * * * *
```

**10분 주기는 Vercel Hobby 플랜에서 지원되지 않습니다.** Vercel Pro 이상이거나, 같은 주기를
보장하는 Supabase Cron 등 외부 스케줄러로 대신 호출해야 합니다(`docs/notification-operations.md`).
외부 스케줄러를 쓸 때도 위 `CRON_SECRET` 헤더를 반드시 붙입니다.

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
  다시 실행하세요. 표준 복구 절차는 지금도 "**전체를 파일명 순서로 다시 적용**"입니다(§0-4).

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

`supabase/functions/notify/index.ts` 하나만 있으면 됩니다(npm 의존성 없음, `jsr:@supabase/supabase-js@2`만
사용). `--no-verify-jwt`를 붙이지 않습니다 — 이 함수는 Supabase Auth JWT 검증이 아니라 자체
`CRON_SECRET` 비교로 인증합니다(둘은 별개의 문 — pg_net이 호출할 때 Authorization 헤더를
Supabase Auth JWT가 아니라 이 CRON_SECRET로 채웁니다).

### 7-2. Edge Function 시크릿 설정

```bash
supabase secrets set CRON_SECRET='<임의의 긴 무작위 값>' --project-ref <project-ref>
# 이메일을 아직 안 쓰면 이 둘은 생략해도 됩니다(IN_APP 알림은 그대로 동작).
supabase secrets set RESEND_API_KEY='<Resend API 키>' --project-ref <project-ref>
supabase secrets set RESEND_FROM_EMAIL='<발신 주소>' --project-ref <project-ref>
```

`SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`는 플랫폼이 자동으로 주입하므로 직접 설정하지
않습니다.

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

`status_code = 401`이면 7-2의 `CRON_SECRET`과 7-3의 `stage1_notify_secret` 값이 다른 것입니다.
자세한 디버깅 순서는 `docs/notification-operations.md`를 참고하세요.

### 7-6. 로컬에서 검증하지 못한 것

pg_cron·pg_net·Vault(`supabase_vault`)는 로컬 스크래치 PostgreSQL에 설치할 수 없어(확장
자체가 없음), 이 저장소의 자동 테스트는 SQL 문법·가드·멱등성만 확인했습니다(스텁 스키마로
직접 실행해 확인, `lib/notifications/pg-cron-migration.test.ts`). 실제 확장 설치 ·
스케줄 등록 · Edge Function까지의 HTTP 왕복은 배포 후 위 7-5 확인 쿼리로 컨트롤러가
직접 검증해야 합니다.
