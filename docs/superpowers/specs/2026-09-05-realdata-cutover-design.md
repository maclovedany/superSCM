# 실데이터 전환 — 설계

> 작성 2026-09-05 · 함께 읽을 문서 `AGENTS.md` · `SCHEMA.md` · `renew.prd` 12 · 13 · 14 · 16 · 31.4 · 외부 `6회차/03. DB적재_SQL/README.md`

## 1. 목적과 최종 상태

더미 데이터를 모두 지우고, 6회차 실데이터(부품 6,885 · 옵션 3,596 · 소모품 634 · 기종 137)로 시스템이 돌아가게 합니다. 최종 상태는 넷입니다.

1. 화면 어디에도 `ITEM001~020` 이 없습니다. 더미 raw 테이블 8개와 그 파생 결과는 삭제됩니다.
2. 부품 · 소모품 · 옵션 · 기종 **개별 항목마다** 예측이 있고(독립수요), 기종 예측 × BOM 구성수량으로 그 기종에 딸린 필수품 · 옵션의 **종속수요**도 있습니다.
3. 한 품목의 여러 예측 기법(SQL 5 + Python 8)을 **한 화면에서 겹쳐** 비교합니다. 기종은 영업 OL · SCM OL 도 함께 겹칩니다.
4. 재고 · 리드타임이 없어 못 내는 화면 7개는 열리되 "데이터 대기" 를 명시합니다.

### 확정된 결정

| 결정 | 선택 |
|---|---|
| 기기 예측 | 독립 예측 + 기종 종속수요 전개, 둘 다 |
| 모델 엔진 | Python 예측 서비스 사용. 먼저 로컬 Docker, 나중에 Railway |
| 대상 범위 | 전체 11,252 품목 |
| 기종 실적 | `fact_mc_plan_actual.act`. 영업 OL · SCM OL 은 비교 시리즈 |
| 재고 없는 화면 | 메뉴에 남기고 "데이터 대기" 배너 |
| 스키마 | **입력 계층 재설계**(더미 raw 삭제 · 표준 입력 뷰 · 읽는 자리 직접 수정). 결과 계층(예측 · 백테스트 · Champion · 승인 · 알림 · 시뮬레이션)은 유지 |

## 2. 계층

```
raw        6회차 실데이터 테이블 10개만. dim_item · dim_model · fact_shipment · fact_mc_plan_actual · bridge_*
           (외부 01-schema.sql · 02-data-*.sql 이 만듭니다. 이 저장소는 01 · 04 · 05 를 sql/ 로 가져옵니다)
   │
core       표준 입력 뷰 4개 (§3) + 기존 엔진 · 결과 테이블 + 실체화 테이블 2개 (§5)
   │
analytics  화면 · 차트 · 에이전트가 읽는 뷰. 무거운 것은 실체화 테이블을 읽습니다
```

## 3. 표준 입력 뷰 — `sql/34-realdata-input.sql`

엔진과 화면이 "수요" 와 "품목" 을 읽는 문은 이 넷뿐입니다. 다른 곳에서 `raw.*` 를 직접 읽지 않습니다.

| 뷰 | 한 행 | 컬럼 | 바탕 |
|---|---|---|---|
| `core.v_demand_monthly` | 품목 × 월 | `item_id, period(date, 그 달 1일), qty, item_type(PART/SUPPLY/OPTION/MACHINE), source('SHIPMENT'/'MC_ACT'), n_source_codes` | 부품은 `core.v_shipment_by_hoc`(XCN 합산) · 소모품 · 옵션은 자기 코드 · 기종은 `fact_mc_plan_actual` 의 `act` 를 `model_base` × `ym` 으로 합산(act null 제외) |
| `core.v_item_master` | 대표코드 1행 | `item_id, item_name, item_type, family, is_machine, is_active, supplier_id(null), unit(null)` | `core.v_item` 을 `hoc_code` 로 묶은 대표코드 + `core.v_model`(item_id = model_base) |
| `core.v_item_alias` | 구코드 1행 | `alias_id, item_id, alias_name` | `raw.bridge_xcn`(related_item → hoc_item) + 대표코드 자신 |
| `core.v_item_hierarchy` | 기종 × 구성품 1행 | `model_base, model_key, role(CAP/NEUTRAL/MUST_OPTION/SCC_LABEL/BOM), item_id, qty_per_unit, bom_group, is_common, n_models` | 외부 `analytics.v_bom_requirement_x` 와 같은 규칙. 품목코드는 `v_item_alias` 로 대표코드로 정규화 |

규칙:
- `item_id` 는 어디서나 `upper(regexp_replace(code, '[\s\-_]', '', 'g'))` 로 정규화한 **대표코드**입니다. 기존 뷰들의 정규화식과 같습니다.
- 0 인 달은 행이 없습니다(원본이 희소). 격자를 채우는 일은 지금처럼 `core.v_demand_grid` 가 합니다.
- 기종의 단위는 대(臺), 부품은 개입니다. 같은 표에 있지만 `item_type` 으로 구분하고 합산하지 않습니다.

### 3.1 읽는 자리를 고칩니다 — `raw.usage_history` · `raw.item_master` 참조 전부

| 파일 | 자리 | 바꿀 것 |
|---|---|---|
| `sql/07-train-isolation.sql` | `v_train_demand` · `v_production_grid` 등 3곳 | `raw.usage_history u(use_date, qty)` → `core.v_demand_monthly d(period, qty)` |
| `sql/06-core-extend.sql` | MOQ · pack_size 를 `raw.item_master` 에서 끌어오는 do 블록, 263행 | 블록 삭제(실데이터에 없음 · 관리자 입력) · `v_demand_monthly` |
| `sql/11-forecast-engine.sql` | 172행 `max(loaded_at)` | `core.v_data_loaded_at`(§3.2) |
| `sql/17-virtual-operation.sql` | `v_usage_monthly`(209) · `v_inbound_qty`(174 · 190) | `v_usage_monthly` 는 `v_demand_monthly` 의 별칭 뷰로 유지 · `v_inbound_qty` 는 §3.3 빈 정의 |
| `sql/18-forecast-override.sql` | 82 · 95행 | `v_demand_monthly` |
| `sql/25-python-models.sql` · `sql/27-admin-ops.sql` | `max(loaded_at)` · `max(use_date)` 5곳 | `core.v_data_loaded_at` · `max(period)` |
| `sql/15` · `20` · `21` | `raw.supplier_master` 조인 4곳 | `core.v_supplier_master`(§3.3 빈 정의) |
| 덤프에만 있는 뷰 6개 (`core.v_item_master` · `v_fact_shipment` · `v_leadtime_stat` · `v_stock_on_hand` · `v_usage_effective` · `analytics.v_usage_anomaly` 등) | 정의를 `sql/34` 로 옮겨 소스를 한 곳으로 |
| `sql/26-api.sql` | 적재 대상 표 6종 | DEMAND · ITEM_MASTER 는 `retired`(실데이터는 6회차 경로), 재고 4종은 `pending`(형식 확정 뒤) |
| `sql/30-indexes.sql` | 더미 raw 인덱스 8개 | 삭제. `fact_shipment` 인덱스는 외부 01 이 이미 만듭니다 |

### 3.2 데이터 시각 — `core.v_data_loaded_at`

`raw.usage_history.loaded_at` 이 없어지므로, stale 판정의 기준은 `max(fact_shipment.ym)` 과 6회차 적재 시각(`raw.dim_item` 의 `loaded_at` 이 없으니 `pg_stat_user_tables.n_live_tup` 변화가 아니라 **적재 배치 기록 테이블** `core.realdata_load(loaded_at, n_rows, note)` 한 줄)으로 합니다. 외부 `03-verify.sql` 이 끝날 때 한 행을 넣는 문장을 이 저장소 사본에 추가합니다.

### 3.3 재고 · 리드타임 · 발주 · 입고 — 아직 없는 데이터

테이블을 만들지 않습니다. 실제 파일이 오면 그 형식으로 설계합니다. 그때까지 아래 core 뷰는 **같은 컬럼으로 0행**을 내는 정의로 두고, 주석에 `[DATA_PENDING: INVENTORY]` 처럼 기다리는 데이터를 적습니다.

`core.v_stock_on_hand` · `core.v_inbound_qty` · `core.v_fact_shipment` · `core.v_leadtime_stat` · `core.v_supplier_master`

아래 화면은 이 뷰들 때문에 규칙대로 "산출 불가" 가 됩니다 — 재고 전개 · 재고 소진 위험 · 리드타임 격차 · 발주 추천(+상세) · 영업 수급 · 가상 운영 · What-If. `analytics.v_data_availability`(§7) 가 그 사실을 한 줄로 냅니다.

## 4. 종속수요 — `sql/35-dependent-demand.sql`

- `core.dependent_demand(run_id, model_base, item_id, period, qty_per_unit, machine_qty, qty)` 물리 테이블. 운영 실행이 끝날 때 `core.build_dependent_demand(p_run_id)` 가 채웁니다: 기종 Champion 예측(`core.forecast_current` 의 `item_type = 'MACHINE'`) × `core.v_item_hierarchy` 의 `qty_per_unit`(CAP 역할 제외).
- 공용 옵션은 기종별 행이 여럿이고 `analytics.v_demand_compare` 가 품목 단위로 합칩니다. 공용 여부(`is_common`)를 함께 내어 화면이 "n 기종 공용" 을 표시합니다.
- `analytics.v_demand_compare(item_id, period, actual_qty, independent_qty, dependent_qty, n_models)` — 실적 · 독립 예측 · 종속수요 한 행.
- `analytics.v_machine_bom_forecast(model_base, role, item_id, item_name, qty_per_unit, machine_12m, dependent_12m, independent_12m, is_common)` — 기종 화면의 표.

## 5. 실체화 — 11,252 품목에서 화면이 즉시 뜨게

요청마다 `forecast_result`(실행당 최대 11k × 13 × 12 = 170만 행)를 훑지 않습니다. 실행이 끝날 때 두 표를 씁니다.

| 표 | 한 행 | 채우는 때 |
|---|---|---|
| `core.forecast_current(item_id, item_type, period, champion_model_id, qty, p80, p90, sigma, run_id, mode)` | 품목 × 기간, Champion 모델 값 | 운영 실행 끝 · Champion 수동 변경 시 그 품목만 |
| `core.dependent_demand` | §4 | 운영 실행 끝 |

`core.v_ai_forecast` · `v_consensus_forecast` · 대시보드 · 수요 프로파일 KPI · 차트 집계 뷰는 이 표를 읽도록 정의를 바꿉니다. 모델 비교(품목 하나, 모델 전부)와 백테스트는 지금처럼 `forecast_result` 를 읽습니다 — 한 품목 조회는 인덱스로 빠릅니다.

## 6. 엔진 실행 — Python 서비스가 전체를 맡습니다

- `POST /forecast/run {mode, note}` 하나가 순서대로 합니다: ① `core.run_baseline_forecast`(SQL 5종) 를 **직접 DB 접속으로** 호출(문장 시간 제한 없음) → ② Python 8종을 품목 500개 단위로 계산 · 저장 → ③ `core.forecast_current` · `dependent_demand` 갱신 → ④ 검증 모드면 `core.run_backtest` 까지. 진행률은 `forecast_run.models` jsonb 의 `progress` 에 쓰고 `GET /forecast/run/{id}` 로 봅니다. 중단되면 저장된 청크부터 재개합니다.
- 모델은 `core.model_config.applicable_demand_type` 으로 가릅니다. 간헐 · 덩어리: CROSTON · SBA · TSB(+기준 5종). 평활 · 불규칙: ETS · HOLT_WINTERS · SARIMA · LIGHTGBM(+기준 5종). 24개월 미만 품목은 HOLT_WINTERS · SARIMA 계절 차수를 건너뜁니다(서비스가 이미 그렇게 합니다).
- 관리자 화면의 실행 버튼은 RPC 대신 서비스를 부르고, 서비스가 없으면 지금처럼 RPC 로 SQL 5종만 돌리되 화면에 "Python 서비스 미연결 — 기준 모델만" 을 표시합니다.
- 성능 목표: 이 Mac 의 Docker 에서 **전체 운영 실행 30분 이내**. 첫 실행에서 모델별 소요를 재어 `docs/` 에 남기고, 넘으면 SARIMA 를 평활 품목 중 상위 N 으로 제한하는 것을 첫 조정으로 둡니다.
- 로컬 Docker: `forecast-service/Dockerfile` 로 빌드, `DATABASE_URL`(Supabase 직접 접속 문자열) · `SERVICE_TOKEN` 을 컨테이너 환경변수로, 앱 `.env.local` 에 `FORECAST_SERVICE_URL=http://localhost:8000` · `FORECAST_SERVICE_TOKEN`. 접속 문자열과 토큰은 사용자가 넣습니다.

## 7. 화면

| 화면 | 바뀌는 것 |
|---|---|
| **`/machine-forecast` 신설** | 기종 선택(검색) → 차트: 실적(act) 잉크 실선 · 영업 OL · SCM OL 회색 실선 · 모델 예측 파선 · Champion 밴드 → 표: `v_machine_bom_forecast`(역할 · 구성품 · 구성수량 · 독립 12개월 · 종속 12개월 · 차이 · 공용) → 행 클릭 시 `/model-comparison?item=` |
| 모델 비교 · 수요 예측 · 재고 전개 · What-If 의 품목 선택 | 칩 나열 → **검색형 선택**(`?q=` 서버 검색, `v_item_master` + `v_item_alias` 로 구코드도 찾음, 상위 50) |
| 모델 비교 오버레이 | "종속수요" 회색 파선 시리즈 추가(`v_demand_compare`). 기종이면 OL 두 선 추가 |
| 수요 예측 목록 | 11k 행 → 검색 + `?page=` 페이지(200행) |
| 재고 없는 7화면 | 상단 `DataWaitBanner`: `analytics.v_data_availability(kind, n_rows, needed_files)` 한 줄을 문장으로. 데이터가 오면 저절로 사라짐 |
| 대시보드 | 수요 추이 · 정확도 랭킹 · 월별 결정은 실데이터로. 재고 KPI 카드는 EmptyValue(0 아님) · 관련 차트는 EmptyState |
| 메뉴 | `/machine-forecast` 추가. 7화면은 그대로 |

## 8. 삭제 — 순서와 확인

1. `sql/34` 가 더미 raw 테이블 8개를 `drop … cascade` 합니다(뷰 사슬은 이어지는 파일이 다시 만듭니다). 운영 DB 에 돌리기 전에 **사용자 확인**을 받습니다.
2. 전환이 검증된 뒤(§9 ④까지 통과) 더미 파생 결과를 비웁니다: `core.forecast_run`(cascade 로 result · backtest · champion) · `approval` · `alert` · `forecast_override` · `simulation_run` · `what_if_log` · `upload_batch` · `import_staging`. 이때도 **사용자 확인**을 받습니다. 사용자 · 정책 · 모델 설정 · API 키 · 에이전트 대화는 남깁니다.
3. 6회차 `07` 이 "폐기" 표시한 옛 뷰(`v_usage_profile` · `v_usage_anomaly` 등)는 화면이 읽지 않으면 삭제, 읽으면 §3 로 재정의합니다(계획에서 확인).

## 9. 검증

| 단계 | 어떻게 | 통과 기준 |
|---|---|---|
| ① SQL | 하네스에 `REALDATA_SQL_DIR` 을 주어 외부 01 · 02-data-* · 04 · 05 를 먼저 적재한 뒤 프로젝트 파일 전체 | pass 1 · 2 전부 통과. `602K02693` 12개월 평균 772.3, `v_ol_accuracy_fy` FY26 0.701/0.657, PART 간헐 3,166 · 덩어리 454 가 **우리 뷰**(`v_sku_demand_profile` · `v_demand_compare`)에서도 같음 |
| ② 서비스 | Docker 기동 → `/health` 200 · 모델 목록 → 검증 실행 1회 | 30분 이내 · `forecast_result` 행수 = 모델 × 품목 × 12 근사 · skipped 사유가 정책과 일치 |
| ③ 앱 | `tsc` · `npm test`(정규화 · 정적 검사) · `build` | 전부 통과 |
| ④ 화면 | 사용자가 `/machine-forecast` · `/model-comparison` · `/forecast` · `/analysis/demand-profile` · `/dashboard` 확인 | `ITEM0` 이 어디에도 없음 · 기종 차트에 OL 두 선 · 구성품 표에 종속수요 |
| ⑤ 삭제 후 | §6 ① 재실행 | 결과 표들이 실데이터 실행 하나만 가리킴 |

## 10. 하지 않는 것

재고 · 리드타임 테이블 설계(파일이 온 뒤) · 결과 계층 스키마 변경 · 다크 테마 · 새 모델 추가 · Railway 배포(URL 만 바꾸면 되도록 준비만) · 6회차 외부 뷰(`v_shipment_trend` 등)의 삭제(에이전트 Tool 이 읽습니다. 그대로 둡니다).

## 11. 순서

1. 저장소에 외부 01 · 04 · 05 사본(`sql/32` · `33`) + `sql/34` 입력 뷰 + 읽는 자리 수정 + `sql/35` 종속수요 · 실체화 + 하네스 실데이터 모드 → ①
2. Python 서비스: 전체 실행 오케스트레이션 · 청크 · 진행률 · Docker 기동 → ②
3. 화면: 검색형 선택 · `/machine-forecast` · 오버레이 시리즈 · DataWaitBanner · 페이지 → ③
4. 운영 DB 적용(확인 후) → 검증 실행 → 백테스트 → 운영 실행 → ④
5. 더미 파생 결과 삭제(확인 후) → ⑤ · 문서(`SCHEMA.md` · `sql/README.md` · `step.md` · `error.md`)

## 12. 구현 결과 (2026-09-05)

- 하네스(실데이터 9,772 품목)에서 SQL 31 파일 pass 1 · 2 전부 통과, seed(운영 실행 · 백테스트 · 알림 스캔) 완료, `602K02693` 12개월 평균 772.3 일치.
- 전체 파이프라인 6분 44초 (목표 30분). Champion 이 12개 모델 전부에 분포 — ETS 697 · TSB 664 · MA_6M 628 · … · SARIMA 2.
- 스펙과 다른 점은 `docs/superpowers/plans/2026-09-05-realdata-2-service.md` · `-3-screens.md` 의 "스펙과 다른 점" 절.
- 성능 세 원인과 처방은 `error.md` #34.

