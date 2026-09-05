# 실데이터 전환 — Plan 1 (SQL 입력 계층 · 종속수요 · 실체화 · 하네스)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. 스펙 `docs/superpowers/specs/2026-09-05-realdata-cutover-design.md` §2~§5 · §9-①.

**Goal:** 더미 raw 8개를 지우고 실데이터 위에 표준 입력 뷰 4개를 세워 기존 엔진 · 화면 사슬이 실데이터로 돌게 하고, 종속수요 · 실체화 표를 더한 뒤 하네스로 검증합니다.

## 파일

| 파일 | 일 |
|---|---|
| `sql/32-realdata-schema.sql` (신규) | 6회차 01 사본, drop 없이 `create table if not exists` |
| `sql/33-realdata-views.sql` (신규) | 6회차 04 + 05 사본 그대로 |
| `sql/34-realdata-input.sql` (신규) | 더미 raw 8개 + `core.usage_profile` drop cascade · `core.norm_code()` · `core.realdata_load` · `v_item_alias` · `v_item_master` · `v_demand_monthly` · `v_item_hierarchy` · 재고 계열 0행 스텁 6개(`v_supplier_master` · `v_fact_shipment` · `v_shipment_valid` · `v_leadtime_stat` · `v_leadtime_effective` · `v_stock_on_hand` · `v_inbound_qty` · `analytics.v_leadtime_gap`) · `analytics.v_data_availability` · `forecast_setting` 경계 재설정 |
| `sql/06` | `forecast_setting` 초기 insert 를 `raw.usage_history` 존재 시에만 |
| `sql/07` | `v_train_demand` · `v_test_actual` · `v_data_coverage` → `core.v_demand_monthly` |
| `sql/11` · `sql/25` | `v_data_loaded_at` · `v_data_snapshot` → `core.realdata_load` |
| `sql/15` · `20` · `21` | `raw.supplier_master` 조인 → `core.v_supplier_master` |
| `sql/17` | `v_goods_receipt` · `v_purchase_order` 0행 스텁 · `v_usage_monthly` → `v_demand_monthly` |
| `sql/18` | `v_actual_demand` → `v_demand_monthly` |
| `sql/27` | `production_train_end` 기본값 · `v_forecast_run.is_stale` · `v_production_grid` · `v_stale_summary.data_end` · `v_outlier_exclusion.excluded_qty` |
| `sql/30` | 더미 raw 인덱스 삭제 |
| `sql/35-dependent-demand.sql` (신규) | `core.forecast_current` · `core.dependent_demand` · `refresh_forecast_current()` · `build_dependent_demand()` · `core.v_ai_forecast` 재정의 · `analytics.v_demand_compare` · `v_machine_bom_forecast` |
| `sql/27` · `13` | `run_baseline_forecast` · `run_backtest` · `set_champion_manual` 끝에서 refresh 호출 |
| `scripts/sql-verify/run.sh` | `REALDATA_SQL_DIR`(기본: 6회차 폴더) → 32 → 02-data-* 적재 → 통과 목록에 32·33·34·35 |
| `sql/README.md` · `SCHEMA.md` · `step.md` | 순서 · 계층 · 안내 |

## 순서 (하네스 파일 목록)
`01 03 04 06 32 33 34 07 08 09 10 11 12 13 25 15 16 17 18 19 20 21 22 23 24 26 27 35 31 29 28`

## 검증
- 하네스 pass 1 · 2 전부 통과, seed(운영 실행 · 백테스트 · 알림 스캔)가 실데이터에서 끝남.
- `select item_id, avg_12m` 대조: 우리 `core.v_demand_monthly` 로 `602K02693` 최근 12개월 합 ÷ 12 = 772.3.
- `analytics.v_sku_demand_profile` 의 PART 유형 분포가 외부 `v_item_demand_kpi` 와 근사(경계 정의 차이는 문서화).
- `v_item_master` 에 `ITEM0%` 없음 · 기종 137행 · `v_item_hierarchy` 행수 = 외부 `v_bom_requirement_x` 행수.
