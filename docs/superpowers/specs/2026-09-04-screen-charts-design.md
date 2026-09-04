# 화면별 인터랙티브 차트 — 설계

> 작성 2026-09-04 · 대상 커밋 71b2350 이후 · 함께 읽을 문서 `design.md` §7 · `AGENTS.md` 규칙 2 · 11 · `SCHEMA.md`

## 1. 목적

지금 화면은 KPI 카드와 표뿐이라 "비교해서 보는" 경험이 없습니다. 사용자 화면 16개 전부에
그 화면의 질문에 맞춘 차트를 넣어, 숫자를 읽기 전에 모양으로 먼저 알아보게 합니다.
관리자 화면과 에이전트 화면은 제외합니다.

확정된 결정:

| 결정 | 선택 |
|---|---|
| 시각 방향 | design.md v2 라이트 뉴모피즘 유지. 다크 전환 없음. 원형·3D 없음 |
| 범위 | 사용자 화면 16개. 대시보드 → 분석·예측 → 운영 순 |
| 차트 구조 | **화면별 맞춤 차트.** 공통은 툴팁·축 포맷·범례 토글·프레임만 |
| 데이터 | 기존 뷰 재사용. 건수·합계 집계 10개만 `sql/31-chart-views.sql` |
| 상호작용 | 툴팁 + 범례 토글 + 클릭 이동 + 시계열 기간 브러시 |

## 2. 공통 바탕 (`components/chart/_base/`)

차트는 여기 없습니다. 화면 차트가 공유하는 것만 둡니다.

| 파일 | 역할 |
|---|---|
| `tooltip.tsx` | 기간 · 값 · 상태 글자를 함께 보여 주는 공통 툴팁. 색만으로 읽지 않게 합니다 |
| `format.ts` | 축 포맷터 — 월(`YY.MM`) · 수량(천 단위) · 금액(만 원) · 백분율 |
| `use-series-toggle.ts` | 범례 칩 클릭으로 시리즈를 숨기는 훅. 재조회하지 않습니다 |
| `chart-frame.tsx` | 제목 · 설명 · 범례 칩 · 빈 상태 · 오류 상태 · 영업 가림 문구를 감싸는 껍데기 |
| `period-brush.tsx` | recharts `Brush` 를 감싼 것. 점이 8개 미만이면 그리지 않습니다 |

`lib/chart-colors.ts` 에 `STATUS_COLORS` 를 더합니다. `globals.css` 의 `--crit` `#dc2626` ·
`--warn` `#f59e0b` · `--info` `#2563eb` 와 안전 `#16a34a` · 미판정 `#a1a1aa` 를 같은 값으로
둡니다. recharts 는 CSS 변수를 읽지 못하므로 값을 복제하되 주석으로 출처를 남깁니다.

`styles/chart.css` 에 `.grid-charts` 하나를 더합니다. 기본 2열, `data-cols="3"` 이면 3열,
900px 아래에서 1열. 차트 높이는 240px 고정, 대시보드 추이 차트만 280px.

## 3. 데이터

### 3.1 기존 뷰를 그대로 쓰는 것

`v_stockout_kpi` · `v_dashboard_accuracy_ranking` · `v_sku_demand_profile` · `v_leadtime_gap` ·
`v_stockout_risk` · `v_item_series` · `v_forecast_run_model` · `v_champion_model` ·
`v_model_performance` · `v_forecast_value_add` · `v_forecast_value_add_by_reason` ·
`v_purchase_recommendation_kpi` · `v_decision_history` · `v_sales_promise_risk` · `v_atp` ·
`v_simulation_totals` · `v_simulation_item`. 조회 함수는 이미 `lib/` 에 있으며 그대로 씁니다.

### 3.2 새 뷰 — `sql/31-chart-views.sql`

전부 `analytics` 스키마, `authenticated` 에 select. 화면은 계산하지 않으므로 합계·건수는 여기서 냅니다.

| 뷰 | 행 | 컬럼 | 바탕 |
|---|---|---|---|
| `v_chart_demand_trend` | 기간 15행 | `period, kind('ACTUAL'/'FORECAST'), qty, n_items` | `v_dashboard_sparkline` 을 period·kind 로 합계 |
| `v_chart_recommendation_by_supplier` | 공급처별 | `supplier_id, supplier_name, n_items, n_urgent, total_qty, total_amount, n_missing_price` | `v_purchase_recommendation` 에서 `final_recommended_qty > 0` 만, 금액 내림차순 |
| `v_chart_alert_by_type` | 유형×심각도 | `type, type_label, severity, n_open, n_unacknowledged` | `v_alert`(열린 알림) |
| `v_chart_alert_daily` | 최근 30일 | `day, n_detected, n_resolved` | `core.alert` 의 `detected_at` · `resolved_at` 을 날짜로 |
| `v_chart_approval_monthly` | 최근 6개월×결정 | `month, decision, n` | `core.approval` |
| `v_chart_champion_share` | 모델별 | `model_id, model_name, n_items, n_manual, avg_wape` | `core.champion_model` |
| `v_chart_order_calendar` | 주별 | `week_start, n_items, n_urgent, total_qty, total_amount` | `v_purchase_recommendation` 의 `required_order_date` 를 주 단위로 |
| `v_chart_projection_total` | 기간별 | `period, total_closing, total_receipt, total_demand, n_stockout_items` | `v_inventory_projection` 합계 |
| `v_chart_usage_heatmap` | 품목×월 | `item_id, item_name, period, qty` | `core.v_usage_monthly` 최근 12개월, 총량 상위 40품목 |
| `v_chart_sales_status` | 상태별 | `status, n_items` | `v_sales_supply_status` |

각 뷰는 `limit` 을 명시합니다(PostgREST 1,000행 상한). 파일 끝의 확인 쿼리는 `count(*)` 만 둡니다(error.md #28).

### 3.3 가림막 (`sql/29`)

`v_chart_recommendation_by_supplier` 의 `supplier_name` · `total_amount`, `v_chart_order_calendar` 의
`total_amount` 를 `core.__sales_guard` 로 가립니다. 적용 순서 `31 → 29 → 28`. `sql/README.md`
표에 31 을 29 앞에 넣고, `scripts/sql-verify/run.sh` 의 파일 목록에도 같은 자리에 넣습니다.

### 3.4 정규화 — `lib/chart-model.ts`

뷰 행 → 차트 데이터 변환은 전부 이 파일의 순수 함수입니다. 변환은 "모양 바꾸기" 까지만
허용합니다. 합계·평균·순위는 만들지 않습니다. 함수마다 `lib/chart-model.test.ts` 에 실제
컬럼명으로 테스트를 둡니다. 조회 함수는 `lib/charts.ts` 에 모으고 서버 전용입니다.

## 4. 화면별 차트

모든 화면은 `KPI 행 → 차트 띠 → 표` 순서입니다. 시계열에는 브러시가 붙습니다.
차트 파일 이름은 `components/chart/<화면>-<차트>.tsx` 입니다.

### 4.1 대시보드 (3×2)

| # | 차트 | 파일 | 출처 | 클릭 |
|---|---|---|---|---|
| ① | 수요 추이 — 12개월 실적 합계(면적) + 3개월 컨센서스(파선). 280px | `dashboard-demand-trend` | `v_chart_demand_trend` | 없음 |
| ② | 결품 위험 분포 — 위험·주의·안전·미판정 가로 스택 | `dashboard-risk-mix` | `v_stockout_kpi` | `/analysis/stockout?filter=risk` (위험+주의) |
| ③ | 공급처별 추천 금액 상위 8 가로 막대, 긴급 건수 표기 | `dashboard-supplier-amount` | `v_chart_recommendation_by_supplier` | `/purchase-recommendation?supplier=` |
| ④ | 정확도 랭킹 — 상위 5 · 하위 5 양방향 막대 | `dashboard-accuracy-ranking` | `v_dashboard_accuracy_ranking` | `/model-comparison?item=` |
| ⑤ | 알림 유형×심각도 스택 막대 | `alerts-type-mix` (알림 화면과 공유) | `v_chart_alert_by_type` | `/alerts?filter=<type>` |
| ⑥ | 월별 결정 건수 6개월 스택 | `decision-monthly` (결정 이력과 공유) | `v_chart_approval_monthly` | `/decision-history` |

기존 패널(발주 우선순위 · 재고 소진 위험 · Open PO · 알림 · 최근 승인)과 스파크라인은 유지합니다.
정확도 랭킹 표는 ④ 로 대체합니다(같은 뷰, 같은 숫자).

### 4.2 분석 · 예측

| 화면 | 차트 | 파일 | 출처 | 클릭 |
|---|---|---|---|---|
| 수요 프로파일 | CV²×ADI 산점도. 경계선 CV² 0.49 · ADI 1.32, 사분면 라벨 Smooth/Intermittent/Erratic/Lumpy | `demand-quadrant` | `v_sku_demand_profile` | 점 → 표 행 강조(`?item=`) |
| | 수요 유형 분포 막대 | `demand-type-mix` | `v_demand_profile_kpi` | 표 필터 `?filter=<type>` |
| | 품목×월 히트맵 12개월 | `demand-heatmap` | `v_chart_usage_heatmap` | 셀 → `?item=` |
| 리드타임 | 공급처별 마스터 vs 실측 그룹 막대 | `leadtime-gap-bars` | `v_leadtime_gap` | 없음 |
| | 격차 순위 가로 막대(±) | `leadtime-gap-rank` | 같은 행 | 없음 |
| 결품 위험 | 품목별 재고 유지 일수 막대. 상태색, 리드타임 기준선 | `stockout-days-bar` | `v_stockout_risk` | `/purchase-recommendation/<item>` |
| | 결품 예상일 점 타임라인(오늘 기준선) | `stockout-timeline` | 같은 행 | 같음 |
| 예측 | 품목 선택 셀렉트 + 예측 오버레이(기존 `forecast-overlay-chart`) | 기존 | `v_item_series` · `getForecastDetail` | 없음 |
| | 모델별 예측 합계 막대 | `forecast-model-totals` | `v_forecast_run_model` | 없음 |
| 모델 평가 | 품목별 Champion WAPE 막대(내림차순, 수동 지정은 빗금) | `evaluation-wape-bars` | `v_champion_model` | `/model-comparison?item=` |
| | 모델별 Champion 점유 가로 스택 | `evaluation-champion-share` | `v_chart_champion_share` | 없음 |
| | 베이스라인 대비 개선율 ± 막대 | `evaluation-improvement` | `v_champion_model` | 같음 |
| 모델 비교 | (기존 오버레이 + 브러시) 모델별 WAPE·Bias 그룹 막대 | `comparison-metric-bars` | `v_model_performance` | 없음 |
| 오버라이드 | 기간별 실적·AI·컨센서스 선 | `override-value-lines` | `v_forecast_value_add` | 없음 |
| | 사유별 AI vs 컨센서스 WAPE 그룹 막대 | `override-reason-bars` | `v_forecast_value_add_by_reason` | 없음 |

### 4.3 운영

| 화면 | 차트 | 파일 | 출처 | 클릭 |
|---|---|---|---|---|
| 발주 추천 | 발주 권고일 주별 캘린더 막대(건수 막대 + 금액 선) | `recommendation-calendar` | `v_chart_order_calendar` | 없음 |
| | 공급처별 금액 (대시보드 ③ 공유) | `dashboard-supplier-amount` | 같은 뷰 | 표 필터 `?supplier=` |
| | 위험 분포 스택 | `dashboard-risk-mix` 재사용 | `v_purchase_recommendation_kpi` | 표 필터 |
| 발주 상세 | 기존 2종에 브러시만 | 기존 | | |
| 재고 전개 | (기존 유지) 전체 재고 합계 추이 + 결품 품목 수(막대) | `projection-total` | `v_chart_projection_total` | 없음 |
| 알림 | 유형×심각도 스택(공유) | `alerts-type-mix` | `v_chart_alert_by_type` | `?filter=` |
| | 30일 일별 발생·해결 | `alerts-daily` | `v_chart_alert_daily` | 없음 |
| 결정 이력 | 월별 결정 스택(공유) | `decision-monthly` | `v_chart_approval_monthly` | 없음 |
| | 추천 vs 승인 수량 산점도(대각선 = 그대로 승인) | `decision-adjustment` | `v_decision_history` | `/decision-history/<id>` |
| 판매(ATP) | 공급 상태 분포 스택 | `sales-status-mix` | `v_chart_sales_status` | 표 필터 |
| | 납기별 부족 수량 막대 | `sales-shortfall` | `v_sales_promise_risk` | 없음 |
| | 품목별 ATP 버킷 그룹 막대 | `sales-atp-buckets` | `v_atp` | 없음 |
| 가상 운영 | (기존 비교 유지) 전체 재고 실제 vs 시뮬 선 + 결품 품목 수 | `simulation-totals` | `v_simulation_totals` | 없음 |
| | 품목별 결품 월 실제 vs 시뮬 그룹 막대 | `simulation-item-bars` | `v_simulation_item` | 없음 |
| What-If | (기존 유지) 전/후 지표 비교 막대(결품 일수 · 안전재고 · 발주량 · 리드타임) | `whatif-compare` | `WhatIfSide` 쌍 | 없음 |

## 5. 상호작용

- **툴팁** — 공통 하나. 기간 · 시리즈 이름 · 값 · 상태 글자.
- **범례 토글** — 기존 알약 칩(`chart.css .chart-legend-item`). 숨긴 시리즈는 축 범위에서도 뺍니다.
- **브러시** — `period-brush` 를 시계열 차트 아래에. 브러시는 그 차트만 바꾸고 표는 바꾸지 않습니다.
- **클릭 이동** — 서버 컴포넌트가 `hrefFor(row)` 로 만든 문자열을 넘기고, 차트는 `router.push` 만 합니다.
  `?filter=` 는 그 화면 `FilterSpec` 과 조건이 정확히 같을 때만 씁니다(대시보드 page.tsx 의 규칙).
  맞는 필터가 없으면 그 화면의 `FilterSpec` 에 만듭니다(예: 발주 추천의 `supplier`, 알림의 유형별). 필터 정의는 언제나 그 화면 한 곳입니다.
- **표 행 강조** — `?item=` 이 있으면 표의 그 행에 `selected` 를 붙이고 스크롤합니다(`DataTable` 의 `selectedKey`).

## 6. 오류 · 빈 값 · 권한

- 조회 실패는 `ErrorState`, 행 없음은 `EmptyState`. 차트 띠 하나가 실패해도 다른 차트와 표는 그립니다.
- null 은 0 으로 그리지 않고 선을 끊습니다(`connectNulls={false}`).
- 영업 권한으로 가려진 컬럼(금액 · 공급처명 · 정확도)은 값이 null 로 옵니다. 그 차트는 빈 차트 대신
  "영업 권한에서 볼 수 없습니다 (renew.prd 4.5)" 문구를 `ChartFrame` 이 냅니다. 판정은 `isSalesUser(user)` 로 서버에서 합니다.
- 1,000행 상한 — 모든 조회에 `limit` 을 적습니다.

## 7. 테스트 · 검증

| 무엇 | 어떻게 |
|---|---|
| 정규화 | `lib/chart-model.test.ts` — 함수마다 실제 컬럼명 fixture 1개 이상, null 처리 1개 |
| 새 뷰 | `scripts/sql-verify/run.sh 31 29 28` — pass 1·2 통과, 파일 끝 `count(*)` 확인 |
| 타입 | `npx tsc --noEmit` |
| 전체 | `npm test` |
| 화면 | dev 서버 로그인 후 16개 화면 스크린샷. 계정은 사용자가 제공 |

## 8. 적용 순서

1. 공통 바탕 + `STATUS_COLORS` + `.grid-charts`
2. `sql/31` + `sql/29` 가림 + README · 하네스 목록 + `lib/charts.ts` · `lib/chart-model.ts`
3. 대시보드 6종
4. 분석 · 예측 6화면
5. 운영 8화면
6. 문서 — `AGENTS.md` 규칙 11 의 차트 목록 갱신, `step.md` 에 `31 → 29 → 28` 적용 안내

## 9. 하지 않는 것

다크 테마 · 지도 · 원형 그래프 · 관리자 화면 · 에이전트 화면 · 브러시로 표 필터 · 실시간 갱신.
