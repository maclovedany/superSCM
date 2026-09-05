# sql/ 적용 순서 — 여기가 기준입니다

Supabase → SQL Editor 에 **파일 하나를 통째로** 붙여넣고 실행합니다.
아래 순서 그대로 위에서 아래로 한 번씩 실행하면 전체가 설치됩니다.

## 1. 적용 순서

| # | 파일 | 하는 일 |
|---|---|---|
| 1 | `01-grants.sql` | anon · authenticated 롤에 core · analytics 읽기 권한 |
| 2 | `03-auth.sql` | 인증 (1/2) — `core.app_user` · `core.audit_log` · `core.is_admin()` · 가입 트리거 |
| 3 | `04-rls.sql` | 인증 (2/2) — `02-policies.sql` 의 위험한 정책을 지우고 RLS 를 다시 깝니다 |
| 4 | `06-core-extend.sql` | 데이터 모델 확장 (1/2) — 정책값 · 품목 정책 · 이상치 · 가예약 · `forecast_setting` |
| 5 | `32-realdata-schema.sql` | ★ 실데이터 raw 테이블 10개 (6회차 `01-schema.sql` 사본 · drop 없음). 데이터는 6회차 `02-data-*.sql` 로 |
| 6 | `33-realdata-views.sql` | ★ 실데이터 core · analytics 뷰 (6회차 `04` + `05` 사본) — XCN 합산 · 기종 · BOM 전개 |
| 7 | `34-realdata-input.sql` | ★ 더미 raw 8개 **삭제** · 표준 입력(mv_item_master · mv_demand_monthly · mv_item_alias · v_item_hierarchy) · 재고 계열 0행 스텁 · `v_data_availability`. **다시 돌리면 뒤 파일 전부 다시** |
| 8 | `07-train-isolation.sql` | 데이터 모델 확장 (2/2) — 학습/검증 구간 격리 |
| 9 | `08-import.sql` | 적재 파이프라인 — 업로드 배치 · 스테이징 · 검증 |
| 10 | `09-import-commit.sql` | 적재 확정을 SQL 함수로 (`core.import_commit` · `core.rollback_batch`) |
| 11 | `10-demand-profile.sql` | 수요 패턴 분석 (SKU Demand Profile) |
| 12 | `11-forecast-engine.sql` | Forecast Engine — SQL Baseline 모델. `analytics.v_forecast_run` 을 **drop 후 create** 하므로 다시 실행하면 뒤 파일을 전부 이어서 실행해야 합니다 |
| 13 | `12-forecast-summary.sql` | 예측 결과 조회 뷰 |
| 14 | `13-backtest.sql` | Backtest Engine + Champion Model |
| 15 | `25-python-models.sql` | ★ Python 예측 서비스 등록 + `core.is_admin()` 확장 — **번호보다 여기서 실행하세요** |
| 16 | `15-inventory-projection.sql` | 리드타임 정책화 + Inventory Projection + Stockout Risk |
| 17 | `16-safety-stock-recommendation.sql` | Safety Stock + Purchase Recommendation + SKU Detail |
| 18 | `17-virtual-operation.sql` | 가상 운영 시뮬레이션 |
| 19 | `18-forecast-override.sql` | Forecast Override · Consensus · Forecast Value Add |
| 20 | `19-approval.sql` | 승인 워크플로 + 근거 Snapshot + Decision History |
| 21 | `20-alert.sql` | Alert Center + 백그라운드 스캔 |
| 22 | `21-dashboard.sql` | Dashboard |
| 23 | `22-agent.sql` | AI Agent 대화 기록 |
| 24 | `23-atp-sales.sql` | 판매 가능 수량(ATP) · 수주 · 가예약 |
| 25 | `24-what-if.sql` | What-If 시뮬레이션 — 읽기 전용. `15` · `16` 의 계산식을 그대로 비추고 `23` 의 `core.is_sales()` 로 영업을 막습니다 |
| 26 | `26-api.sql` | 외부 연동 API — API 키 · 호출 로그 · 멱등성. 조회(GET) 라우트가 쓰는 `service_role` 권한(뷰 9 · 함수 1)도 여기서 줍니다 |
| 27 | `27-admin-ops.sql` | ★ Admin 강화 · 운영 모니터링 — 실행 모드(검증/운영) · stale 요약 · 통합 로그 |
| 28 | `35-dependent-demand.sql` | ★ 실체화 — `forecast_current` · `dependent_demand`(기종 예측 × BOM) · `v_ai_forecast` 재정의 · `v_demand_compare` · `v_machine_bom_forecast` · `v_machine_plan_actual` · **저장 다이어트**(`make_room_for_run` · `prune_production_models` · `prune_forecast_runs` · `finalize_run_storage`, error.md #35) |
| 29 | `31-chart-views.sql` | 차트 집계 뷰 10개 — 기간 · 공급처 · 유형별 합계와 건수. 새 계산 없음. 앞 파일(15 · 16 · 19 · 20 · 21 · 23)을 다시 실행했으면 이 파일도 다시 |
| 30 | `29-sales-column-guard.sql` | ★ 영업 정보 접근 범위를 DB 에서 닫습니다 — 조달 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 · 예측 정확도를 `core.is_sales()` 로 null 처리 (renew.prd 4.4 · 4.5) |
| 31 | `28-anon-lockdown.sql` | ★ 항상 마지막 — anon(로그인 전) 권한 회수. 함수를 추가하는 파일을 적용했으면 이 파일을 다시 실행하세요 |
| (선택) | `30-indexes.sql` | 조인·필터 키 인덱스. **지금은 안 돌려도 됩니다** — 품목 20개 기준 효과가 측정되지 않았습니다. 실데이터를 대량 적재한 뒤에 한 번 돌리세요. 권한·뷰를 건드리지 않으므로 `28` 뒤에 실행해도 안전합니다 |

### `28-anon-lockdown.sql` 은 선택이 아닙니다

브라우저에 그대로 실려 나가는 publishable 키만으로 **로그인 없이 `core` · `analytics` 전체가
읽혔습니다.** 운영 DB 에서 실제로 확인된 문제입니다. `28` 이 그 권한을 거두고, 로그인 없이
도는 두 경로(Vercel Cron · External API Inbound)에 필요한 함수 실행 8개만 되돌려줍니다.

`01-grants.sql` 의 default privileges 가 **새로 만든 객체에 자동으로 다시 권한을 뿌리므로**,
`28` 은 반드시 맨 마지막이어야 하고 앞 파일을 다시 실행할 때마다 함께 다시 실행해야 합니다.

`28` 이 거두는 대상은 **`anon` 과 `PUBLIC` 뿐입니다.** 다른 롤에 직접 준 권한은 건드리지
않습니다 — ACL 에서 별개의 항목이기 때문입니다. 그래서 `26-api.sql` 이 `service_role` 에 준
조회 권한(External API 의 GET 라우트가 씁니다)은 `28` 을 나중에 실행해도 그대로 남습니다.
**`26` 을 `28` 뒤에 다시 실행할 필요가 없습니다.** 순서는 이 표 그대로입니다.

### `25-python-models.sql` 이 12번에 있는 이유

파일 번호는 25 지만 내용은 STEP 8 이고, 필요한 것은 `13-backtest.sql` 까지뿐입니다.
그리고 이 파일이 `core.is_admin()` 을 **JWT 없는 postgres 접속도 관리자로 인정하도록**
확장합니다. SQL Editor 가 바로 그 경우입니다. 먼저 깔아 두면 뒤 파일에서 관리자 전용
함수를 손으로 실행해 볼 수 있습니다. 맨 뒤에 실행해도 설치 자체는 됩니다.

### 순서에서 빠진 파일 (일부러)

| 파일 | 왜 |
|---|---|
| `02-policies.sql` | **폐기.** anon 에게 쓰기를 열어 줍니다. 실행하지 마세요. 이미 실행했다면 `04-rls.sql` 이 지웁니다 |
| `05-first-admin.sql` | 일회성. Supabase 대시보드에서 계정을 만든 **뒤**, 그 계정을 관리자로 올릴 때 한 번 |
| `14-reload-real-data.sql` | 일회성. 실데이터 3년치를 올리기 전/후 처리. 3부는 데이터를 지우므로 읽고 주석을 푸세요 |

## 2. 다시 실행할 때 (★ 가장 중요)

`11` · `15` · `16` · `17` · `18` · `19` · `20` · `21` 의 `drop view` 는 전부 **cascade** 입니다.
cascade 가 없으면 뒤 번호 파일이 그 뷰 위에 뷰를 만든 순간부터
`cannot drop … because other objects depend on it` 으로 **재실행 자체가 막힙니다.**

cascade 는 그 대신 **뒤 파일이 만든 뷰까지 말없이 함께 지웁니다.**
실제로 `15` 를 다시 실행하면 이만큼 사라집니다.

```
analytics.v_stockout_kpi  → analytics.v_dashboard_kpi                     (sql/21)
analytics.v_stockout_risk → analytics.v_purchase_recommendation           (sql/16)
                            analytics.v_purchase_recommendation_kpi       (sql/16)
                            analytics.v_purchase_recommendation_with_approval (sql/19)
                            analytics.v_approval_kpi                      (sql/19)
                            analytics.v_sku_detail                        (sql/19)
                            analytics.v_dashboard_purchase_priority       (sql/21)
```

그래서 규칙은 하나입니다.

> **N 번 파일을 다시 실행했으면, N 보다 뒤에 있는 파일을 위 순서대로 전부 다시 실행하세요.**

예: `18-forecast-override.sql` 만 고쳤어도 `19` → `20` → `21` → `22` → `23` → `26` →
`27` → `29` → `28` 을 이어서 실행합니다. 빠뜨리면 오류는 나지 않습니다. 화면만 조용히 비어
보이고, `28` 을 빠뜨리면 **로그인 전에도 데이터가 읽히는 상태로 되돌아갑니다.**

### `27-admin-ops.sql` → `29-sales-column-guard.sql` → `28-anon-lockdown.sql` 순서입니다

이 파일은 앞 파일의 함수와 뷰 넷을 `create or replace` 로 **덮어씁니다.**

| 덮어쓰는 것 | 원래 만든 파일 | 무엇이 달라지나 |
|---|---|---|
| `core.run_baseline_forecast(p_note, p_mode)` | `11` | 인자가 둘로 늘고 검증/운영 모드가 갈립니다 |
| `core.run_backtest(...)` | `13` | 검증 실행만 채점하고, 실패해도 이력 행이 남습니다 |
| `core.v_ai_forecast` | `15` | 운영(PRODUCTION) 실행을 먼저 고릅니다 |
| `core.run_virtual_operation(...)` | `17` | 실패해도 이력 행이 남습니다 |

`11` 은 **`27` 이 쓰는 두 가지를 먼저 만듭니다** — `core.forecast_run.mode` 컬럼과
`core.v_data_loaded_at` 뷰입니다. `21-dashboard.sql` 이 `mode` 로 실행을 고르고 `21` 은
`27` 보다 먼저 실행되므로, 컬럼 선언이 `11` 에 있어야 새로 까는 DB 가 막히지 않습니다.

그래서 **`11` · `13` · `15` · `17` 중 하나라도 다시 실행했으면 `27` 을 반드시 이어서
실행하세요.** 특히 `11` 은 인자 하나짜리 옛 `run_baseline_forecast(text)` 를 되살리므로,
`27` 을 다시 돌리지 않으면 인자 하나로 부를 때 `function is not unique` 로 막힙니다
(`27` 이 그 옛 함수를 다시 지웁니다).

`27` 자체는 `drop view … cascade` 를 쓰지 않아 혼자 다시 실행해도 됩니다. 다만 `27` 은
함수를 새로 만들므로, **돌린 뒤에는 `29` → `28` 을 이어서 실행하세요** (아래).

### `29-sales-column-guard.sql` 은 앞 파일의 뷰를 덮어씁니다

renew.prd 4.4 는 "Role 은 화면 표시만 제어하지 않는다. Backend API 와 Database(RLS)
양쪽에 적용한다" 고 씁니다. 영업 사용자의 토큰도 그 자체로 `authenticated` 라, 앱을
거치지 않고 PostgREST 로 뷰를 직접 부르면 단가 · 발주 금액 · 공급처 상세 · 리드타임
통계 · 예측 정확도가 그대로 나왔습니다. `29` 가 그 컬럼들을
`case when core.is_sales() then null … end` 로 감쌉니다.

**컬럼을 빼지 않습니다.** 응답 모양이 바뀌면 STEP 19 의 `/api/v1/*` 와 기존 화면이
함께 깨집니다. 값만 null 이 됩니다.

가릴 때 지금 정의를 `<뷰>_src` 로 그대로 떠 두고(권한은 전부 회수합니다) 그 위에 얇은
select 를 얹습니다. 정의를 손으로 옮겨 적지 않으므로 `15` · `16` 과 `29` 에 정의가 두 벌
생기지 않습니다. 대신 **`13` · `15` · `16` · `17` · `18` · `19` · `20` · `21` · `23`
중 하나라도 다시 실행했으면 `29` 를 반드시 이어서 실행하세요.** 빠뜨리면 오류는 나지
않습니다. 영업에게 가려 두었던 값이 조용히 다시 보일 뿐입니다.

`29` 는 멱등입니다 — 이미 가려져 있으면 원본을 다시 뜨지 않고 가림막만 다시 만듭니다.
`29` 는 `core.is_sales()` 도 `create or replace` 로 덮어씁니다 (`23` 이 만든 함수에
ADMIN 예외를 더해 `lib/agent/redact.ts` 의 `isSalesActor` 와 규칙을 맞춥니다).

`28-anon-lockdown.sql` 은 권한만 정합니다. 앞 파일이 anon 에게 준 것을 모두 거두고,
로그인 없이 도는 두 경로(Vercel Cron · External API Inbound)에 필요한 함수 실행
8개만 되돌려줍니다. 함수를 추가하는 파일을 다시 적용했다면 이 파일도 다시 실행하세요.

혼자 다시 실행해도 되는 파일이 셋 있습니다. 뒤 파일이 이들의 뷰 위에 뷰를 만들지
않기 때문입니다.

| 파일 | 왜 혼자 돌려도 되나 |
|---|---|
| `17-virtual-operation.sql` | `core.v_supplier_alias` 의 유일한 의존 뷰가 **같은 파일 안**의 `core.v_purchase_order` 라 곧바로 다시 만들어집니다 |
| `21-dashboard.sql` | 대시보드 뷰 위에 뷰를 만드는 파일이 없습니다. 다만 **반대는 성립하지 않습니다** — `15` · `16` · `19` · `20` 을 다시 돌리면 `v_dashboard_*` 가 함께 지워지므로 이 파일을 마지막에 다시 실행하세요 |
| `22-agent.sql` | `drop view` 가 한 줄도 없고 `sql/03` 말고는 의존이 없습니다. 앞 파일을 다시 돌려도 영향이 없습니다 |

## 3. 한 번만 해 둘 설정

**Cron 비밀값 (STEP 14 · `20-alert.sql`).** 스케줄러(`/api/cron/scan-alerts`)에는 로그인
세션이 없어 `core.is_admin()` 이 false 입니다. 비밀값으로 통과시킵니다.

```sql
alter database postgres set app.cron_secret = '충분히-긴-무작위-문자열';
```

같은 값을 Vercel 환경변수 `CRON_SECRET` 에 넣습니다. 두 값이 다르면 스캔이
`알림 스캔 권한이 없습니다` 로 멈춥니다.

**Exposed schemas.** Supabase → Settings → API 의 Exposed schemas 에 `core` 와
`analytics` 를 넣습니다. `raw` 는 넣지 않습니다.

**첫 관리자.** 대시보드에서 계정을 만든 뒤 `05-first-admin.sql` 을 한 번 실행합니다.

## 4. 알림 스캔은 파일 안에서 실행하지 않습니다

`20-alert.sql` 은 DDL 만 합니다. 스캔은 파일을 적용한 **뒤** 따로 돌리세요.

- `/alerts` 화면의 관리자 **[지금 스캔]** 버튼, 또는
- `25-python-models.sql` 을 적용한 상태에서 SQL Editor 에 `select * from core.scan_alerts();` 한 줄만 따로

관리자 전용 함수 호출을 파일 끝에 붙이지 마세요. SQL Editor 는 붙여넣은 스크립트 전체를
하나의 트랜잭션으로 실행하므로, 그 한 줄이 실패하면 **파일 전체가 롤백**되어 아무것도
설치되지 않습니다 (`error.md` #22).

## 5. 적용 전에 로컬에서 확인하는 법

`scripts/sql-verify/run.sh` 가 임시 PostgreSQL 클러스터를 띄워 이 파일들을(`27` · `29` · `28` 포함) 순서대로
두 번(처음 · 재실행) 실행해 봅니다. 운영 DB 에 붙지 않습니다. 자세한 내용은
`scripts/sql-verify/README.md`.

### 실데이터 전환 (sql/32 ~ 35 · 36)

`docs/superpowers/specs/2026-09-05-realdata-cutover-design.md` 가 기준입니다.

- **`34` 는 더미 raw 테이블 8개를 `drop … cascade` 합니다.** 그 위 뷰 사슬이 함께 지워지므로 `34` 를 돌렸으면
  `07` 부터 `28` 까지 전부 순서대로 다시 돌립니다. 운영 DB 에 6회차 데이터가 이미 있으면 `32` 는 아무것도 바꾸지 않습니다.
- 수요 · 품목의 문은 넷뿐입니다 — `core.v_demand_monthly` · `v_item_master` · `v_item_alias` · `v_item_hierarchy`.
  앞 셋은 materialized view 위의 얇은 뷰입니다. **6회차 데이터를 다시 적재했으면**
  `select * from core.refresh_realdata_inputs('재적재 메모');` 를 돌려 갱신하세요.
- 재고 · 리드타임 · 발주 · 입고 · 단가는 실데이터에 없습니다. `34 §8` 의 0행 스텁이 그 자리를 지키고, 화면은 "데이터 대기" 배너를
  띄웁니다. 파일이 오면 그 형식으로 raw 표를 만들고 스텁을 그 위로 다시 정의합니다.
- `35` 의 `core.forecast_current` · `dependent_demand` 는 실행 함수가 끝에서 다시 씁니다. 손으로 갱신하려면
  `select core.refresh_forecast_current(), core.build_dependent_demand();`.
- `36` 은 **전환 검증 뒤 한 번** 더미 시절 파생 결과(ITEM0… 예측 · Champion · 승인 · 알림)를 비우는 스크립트입니다. 주석을 풀어야 실행됩니다.
- 예측 실행은 **Python 예측 서비스**의 `POST /pipeline/run` 이 맡습니다 (SQL 모델 → Python 모델 → 실체화 → 백테스트).
  PostgREST RPC 는 문장 시간 제한(30초)에 걸리므로 11,000 품목에는 서비스 경로가 기본입니다 (`forecast-service/README.md`).
