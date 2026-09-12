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
4. **주의(error.md #24)** — 뒤 마이그레이션이 뷰에 열을 덧붙인 뒤에는(예: `0900`이
   `analytics.v_item_policy`에 8열을 더함) 그 앞 마이그레이션(`0850`)만 단독으로 다시 실행하면
   `cannot drop columns from view`로 실패합니다. `0850`을 다시 실행해야 한다면 `0900`도 곧바로
   다시 실행하세요.

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

### 4-2. Stage 1 파일 — 아직 적용 안 됨, 이번에 순서대로 적용

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

- **`0850` 단독 재실행 실패** — `0900`이 `analytics.v_item_policy`를 넓힌 뒤에는 `0850`만 다시
  실행하면 `cannot drop columns from view`로 실패합니다. `0850`을 다시 실행했다면 `0900`도 바로
  이어서 다시 실행하세요(error.md #24).
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
