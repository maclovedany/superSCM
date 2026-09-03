# STEP 11 구현 지시서 — 가상 운영 결과 ★ (도입 판단의 근거)

> 먼저 `docs/prompts/_공통규칙.md`. STEP 9·10 산출물(`sql/15` · `sql/16` · `lib/inventory.ts` · `lib/recommendation.ts` · `components/chart/projection-chart.tsx`)을 전제로 합니다. 두 보고서의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 11** 입니다. renew.prd 2장: *"오차율만으로는 '그래서 도입하면 뭐가 나아지나'에 답할 수 없다. 16번(가상 운영 결과)이 도입 판단의 근거가 된다."*

검증 구간(`core.forecast_setting.test_start ~ test_end`) 시작 시점으로 돌아가, **시스템이 STEP 10 로직으로 추천했을 발주**를 매달 내고, 그대로 발주했을 때의 재고 추이를 시뮬레이션합니다. 이를 **실제 발주·입고 실적**과 나란히 놓고 결품 횟수 · 평균 재고 · 과잉 발주 · 회전율을 비교하고, 문장을 만듭니다.

읽을 PRD 장: **13.2(가상 운영 결과) · 22.1(추천 공식) · 2장(성공 기준 16)**.

## 데이터 전제 (확인된 사실)

- 실제 입고: `raw.goods_receipt` — 컬럼이 한글입니다: `"입고번호" · "발주번호" · "품목코드" · "입고수량" · "입고일" · "입고창고"` (전부 text). `core.v_goods_receipt` 뷰를 만들어 정규화합니다 (item_id 정규화는 `core.v_item_master` 와 같은 `upper(regexp_replace(...,'[\s\-_]','','g'))`, 날짜는 `::date`, 수량 `nullif(...,'')::numeric`).
- 실제 발주: `raw.purchase_order` — `"발주번호" · "발주일" · "공급업체" · "품목코드" · "발주수량" · "단가" · "납기예정일" · "발주담당"`. `core.v_purchase_order` 뷰로 정규화 (공급업체 표기는 `core.supplier_alias` 로 매핑, 없으면 그대로).
- 실제 수요(검증 구간): `core.v_test_actual`.
- **검증 구간 시작 시점의 재고는 기록이 없습니다.** 현재고(`core.v_stock_on_hand`)에서 역산합니다:
  `opening(test_start) = current_stock − Σ입고(test_start..오늘) + Σ사용(test_start..오늘)`
  사용은 `raw.usage_history` 를 읽는 `core` 뷰(`core.v_usage_since(item_id, from_date)` 같은 함수형 뷰 대신, `core.v_usage_monthly` 전 기간 월별 합계 뷰)로. 이 역산은 추정이며, 화면에 "기초 재고는 현재고에서 역산한 추정치" 를 명시합니다.
- 실제 결품: 실제 재고 추이(역산 기초 + 실제 입고 − 실제 수요)가 월말에 0 이하가 된 달 수.

## 만들 것

### 1. `sql/17-virtual-operation.sql`

```
core.v_goods_receipt        receipt_no · po_no · item_id · qty · receipt_date · warehouse
core.v_purchase_order       po_no · order_date · supplier_id · item_id · qty · unit_price · due_date
core.v_usage_monthly        item_id · period(월초) · quantity (qty > 0 만, 전 기간. 학습 격리와 무관한 운영 뷰. 주석으로 용도 명시)

core.simulation_run
  simulation_id text PK · forecast_run_id · backtest_run_id(있으면) · sim_start date · sim_end date ·
  status · n_items · params jsonb(정책값 스냅샷: 리드타임 정책 · 서비스 수준 · 검토주기) ·
  kpis jsonb · sentence text · started_at · finished_at · duration_ms · triggered_by · triggered_email · note · message

core.simulation_result
  simulation_id · item_id · period ·
  actual_opening · actual_receipt · actual_demand · actual_closing · actual_stockout boolean
  sim_opening · sim_order_qty(그 달 초 발주) · sim_receipt(도착) · sim_demand(=actual_demand) · sim_closing · sim_stockout boolean ·
  sim_safety_stock · sim_forecast_window   PK (simulation_id, item_id, period)

core.run_virtual_operation(p_forecast_run_id text default null, p_note text default null)
  returns table (simulation_id text, n_items int, message text) · security definer · 관리자
  · 대상 run: 지정 없으면 최근 SUCCESS run. 그 run 의 예측이 검증 구간을 덮어야 합니다 (예측 시작 = train_end 다음 달이므로 덮습니다)
  · 품목별로 sim_start 부터 sim_end 까지 월 단위 루프 (plpgsql 루프 허용. 품목 수십 × 12개월이라 문제 없음)
      매달 초:
        forecast_window = 그 달부터 ceil((L + REVIEW_PERIOD_DAYS)/30.4) 개월의 run 예측 합 (Champion 모델, 없으면 기본 모델 — v_ai_forecast 와 같은 규칙이지만 run 을 고정)
        pipeline = 아직 도착하지 않은 sim 발주 합
        safety_stock = STEP 10 과 같은 공식. σ_d 는 core.model_performance(그 run 의 백테스트) rmse → 없으면 forecast_result.sigma
        need = forecast_window + safety_stock − opening − pipeline
        need > 0 이면 MOQ·Pack 반영해 발주. 도착 = 발주월 + ceil(L/30.4) 개월 (그 달 입고에 더함)
      그 달: closing = opening + receipt − actual_demand. closing < 0 이면 stockout=true 이고 closing 을 0 으로 (미충족 수요는 유실. 이월하지 않음)
      실제 쪽: actual_closing = actual_opening + actual_receipt − actual_demand, 같은 규칙
  · 정책값·리드타임은 실행 시점의 현재값을 씁니다 (과거 정책 이력이 없으므로). params 에 스냅샷
  · kpis jsonb:
      actual_stockout_months · sim_stockout_months · prevented(= actual − sim, 음수면 0) ·
      actual_avg_inventory · sim_avg_inventory · inventory_change_pct ·
      actual_orders · sim_orders · excess_orders_actual · excess_orders_sim (발주 시점 months_of_supply > EXCESS_STOCK_MONTHS 인 건) ·
      actual_turnover · sim_turnover (= 기간 수요 합 ÷ 평균 재고)
  · sentence: 'AI 추천대로 발주했다면 {sim_start~sim_end} 실제 결품 {A}회 중 {B}회를 막을 수 있었고, 평균 재고는 {P}% {낮게|높게} 유지됐을 것이다.'
      결품이 실제 0회면 '실제 결품은 없었고, 평균 재고는 …' 로 분기. 비교 불가(품목 0)면 '비교할 데이터가 없습니다'

analytics.v_simulation_run           run 목록 (kpis 펼침: 위 kpi 들을 컬럼으로)
analytics.v_simulation_item          simulation_id · item_id · item_name · actual_stockouts · sim_stockouts · actual_avg_inv · sim_avg_inv · actual_orders · sim_orders
analytics.v_simulation_series        simulation_id · item_id · period · actual_closing · sim_closing · actual_receipt · sim_receipt · demand · actual_stockout · sim_stockout
analytics.v_simulation_totals        simulation_id · period · actual_total_inventory · sim_total_inventory · actual_stockout_items · sim_stockout_items   (전 품목 합 — 차트용)
```

권한: 공통 패턴. 함수 `grant execute to authenticated`.

### 2. `lib/simulation.ts`

`getSimulationRuns()` · `getLatestSimulation()` · `getSimulationItems(id)` · `getSimulationSeries(id, itemId)` · `getSimulationTotals(id)`.

### 3. `components/chart/comparison-chart.tsx` (신규 · 'use client')

design.md §7 · step.md §4.1 의 "Base vs 시나리오" 차트. 두 시리즈(실제 = 잉크 블랙 실선, 시뮬레이션 = 시리즈 색 1번 실선) + 0선 crit 파선 + 결품 달에 `ReferenceDot` 또는 세로 음영. props: `data: { period; actual: number|null; simulated: number|null; actualStockout?: boolean; simStockout?: boolean }[]`, `actualLabel` · `simulatedLabel`. STEP 18(What-If)이 같은 컴포넌트를 재사용합니다.

### 4. 화면 `app/(user)/virtual-operation/page.tsx` (신규. 메뉴 등록은 컨트롤러 — 보고서에 "USER 메뉴 예측 절 · `/virtual-operation` · 라벨 '가상 운영 결과'")

- 최신 시뮬레이션 기준. 관리자에게만 실행 폼 (`run-form.tsx` · `actions.ts` · `state.ts`, 본보기 `app/(user)/model-evaluation/`)
- 상단 InsightBanner ★: `sentence` 그대로 (이 화면의 주인공)
- KPI 4쌍을 `grid-2` 두 줄로: 결품 횟수(실제 vs 시뮬) · 평균 재고 · 과잉 발주 · 재고 회전율 — 각 카드 value 는 시뮬 값, delta 에 "실제 대비" (design.md §6.4 delta). `// kpi-filter: 없음`
- 차트: 전 품목 합 재고 추이 실제 vs 시뮬 (`ComparisonChart`) · 품목 칩(`?item=`)으로 한 품목 보기
- 표: 품목별 실제/시뮬 결품 · 평균 재고 · 발주 횟수. 결품이 줄어든 품목 · 늘어난 품목 KPI 필터
- 하단 안내(`t-sm text-3`): "기초 재고는 현재고에서 입고·사용 실적으로 역산한 추정치입니다. 리드타임·정책값은 실행 시점 값입니다."
- 실행 이력 표

### 5. 테스트

`lib/simulation.test.ts` 정규화 함수만.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] 실제 vs 시뮬 4개 지표가 나란히 제시된다 (뷰 + 화면)
- [ ] 문장이 SQL 에서 만들어져 `sentence` 에 저장된다
- [ ] 시뮬레이션이 `raw` 나 `core` 원본 데이터를 바꾸지 않는다 (insert 는 simulation_* 두 테이블뿐)
- [ ] `sql/17` 을 처음부터 끝까지 다시 읽었다 (plpgsql 루프의 변수 이름과 컬럼 이름 충돌 — error.md #11)

## 보고서

`.superpowers/sdd/step/task-11-report.md`.
