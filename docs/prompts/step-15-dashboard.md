# STEP 15 구현 지시서 — Dashboard

> 먼저 `docs/prompts/_공통규칙.md`. STEP 7 · 9 · 10 · 12 · 13 · 14 의 뷰를 조합만 합니다. 각 보고서의 인터페이스 절을 읽으세요. **새 계산 로직을 만들지 않습니다** — 있는 뷰를 모아 KPI 뷰 하나를 만들고 화면에서 조립합니다.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 15** 입니다. renew.prd 28장 — 상단 KPI 12종 + 하단 위젯 7종. 로그인 후 첫 화면입니다.

읽을 PRD 장: **28(Dashboard) · 31.4(AI 는 부가 계층)**.

## 만들 것

### 1. `sql/21-dashboard.sql`

```
analytics.v_dashboard_kpi     1행 · renew.prd 28.1 의 12종
  forecast_accuracy       = 1 − avg(champion wape)  (v_backtest_kpi.avg_wape) · null 가능
  forecast_bias           = v_backtest_kpi 의 평균 bias 부호 포함 → v_backtest_kpi 에 avg_bias 가 없으면 core.champion_model 에서 avg(bias)
  n_risk_items            v_stockout_kpi.n_critical + n_warning
  n_stockout_30d          n_within_30d
  n_stockout_60d          n_within_60d
  n_excess_inventory      v_alert 의 EXCESS_INVENTORY 미해결 수 (또는 v_stockout_risk 에서 months_of_supply > EXCESS_STOCK_MONTHS)
  n_delayed_open_po       v_alert OPEN_PO_DELAY 미해결 수
  n_recommendations       v_purchase_recommendation_kpi.n_order_needed
  n_urgent_orders         n_urgent
  total_recommended_qty
  total_recommended_amount
  n_pending_approval      v_approval_kpi.pending
  + 보조: n_open_alerts · n_unacknowledged_alerts · last_forecast_run_at · forecast_is_stale · data_end(v_data_coverage.data_end) · last_scan_at

analytics.v_dashboard_purchase_priority   상위 10 · v_purchase_recommendation (final>0) 를 required_order_date 순
analytics.v_dashboard_accuracy_ranking    v_champion_model 을 wape 순 (좋은 5 · 나쁜 5 를 화면에서 자름 — 정렬만 SQL)
analytics.v_dashboard_open_po_risk        core.v_fact_shipment IN_TRANSIT 중 due_date 경과 또는 7일 이내 · item_name · supplier_name · days_late
analytics.v_dashboard_recent_approvals    v_approval 최근 10
analytics.v_dashboard_sparkline           품목별 최근 12개월 실적 (core.v_usage_monthly) + 향후 3개월 consensus → 위험 품목 스파크라인용
                                          item_id · period · kind('ACTUAL'|'FORECAST') · qty
```

### 2. `lib/dashboard.ts`

각 뷰의 조회 함수. `getDashboardKpi()` 는 `{ data, error }`.

### 3. `components/chart/sparkline.tsx` (신규 · 'use client')

step.md §4.1 목록의 마지막 차트. 축·범례 없는 소형 `LineChart` (높이 36px, 실적 잉크 블랙 실선, 예측 파선). props `data: { period; qty; kind }[]`.

### 4. 화면 `app/(user)/dashboard/page.tsx` — `Planned` 교체

design.md §5.1 의 레이아웃(`grid-rail` — 주 패널 + 우측 레일 320px).

```
PageHeader   대시보드 · meta: 데이터 기준일 · 예측 run · [stale 배너 if forecast_is_stale]
KPI 12장     grid-kpi 3줄. 각 카드는 누르면 해당 화면으로 가는 링크여야 하는데 KpiCard 의 filter 는 현재 경로 쿼리만 만듭니다.
             → KpiCard 에 `href?: string` prop 을 추가합니다 (filter 와 배타. href 가 있으면 Link 로 감싸고 hover 만). 기존 사용처 영향 없음.
             링크: 정확도·Bias → /model-evaluation · 위험 SKU/30일/60일 → /analysis/stockout?filter=… · 과잉 → /alerts?filter=info ·
                   지연 PO → /alerts · 추천/긴급/수량/금액 → /purchase-recommendation(?filter=urgent) · 승인 대기 → /purchase-recommendation?filter=pending
             null 은 EmptyValue + reason (정확도는 백테스트 전이면 INSUFFICIENT_SAMPLE)
주 패널 (왼쪽)
  ① 발주 우선순위 표 (10)  품목 · 판정 · 권고일 · 추천 수량 · 금액 · 스파크라인 열(`Sparkline`)
  ② 재고 소진 위험 요약   위험/주의 품목 칩 목록 → 각각 /inventory-projection?item=
  ③ 예측 정확도 랭킹      좋은 5 · 나쁜 5 두 열 (WAPE 막대는 CSS 폭으로 — 차트 아님. `--safe`/`--crit` 토큰)
  ④ Open PO 위험         표
우측 레일 (design.md §6.11 `.rail`)
  ✦ AI Insight            STEP 16 전이므로 정적 인사이트: v_dashboard_kpi 의 숫자로 문장 2개 조립 (가장 급한 품목 · 승인 대기 수). 수치는 뷰 값만
                          `.rail-note` 에 문장, `.rail-tiles` 에 타일 4개 (위험 SKU · 긴급 발주 · 승인 대기 · 미확인 알림)
                          버튼: [AI Agent 에게 묻기] → /agent (STEP 16 전이면 ready=false 라도 링크는 둡니다)
  알림 (Alerts)           v_alert 상위 5 → AlertRow, [전체 보기]
  최근 승인               5건
```

`// kpi-filter: 없음 — 카드는 다른 화면으로 가는 링크` 주석.

### 5. 테스트

`lib/dashboard.test.ts` 정규화.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] KPI 12종이 전부 뷰에서 오고, 화면에서 합계·평균을 내지 않는다
- [ ] LLM 없이 완전히 동작한다 (AI 레일은 정적)
- [ ] `KpiCard` 의 `href` 추가가 기존 화면을 깨지 않는다 (build)
- [ ] 반응형: `grid-rail` 이 1160px 아래에서 레일을 아래로 보낸다 (styles/shell.css 확인, 필요하면 보완)

## 보고서

`.superpowers/sdd/step/task-15-report.md`. 메뉴 `/dashboard` ready. `app/page.tsx` 가 `/dashboard` 로 리다이렉트하는지 확인하고 아니면 보고서에 적습니다 (컨트롤러가 처리).
