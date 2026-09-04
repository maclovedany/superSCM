# 화면별 인터랙티브 차트 — Plan C (운영 8화면) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 발주 추천 · 발주 상세 · 재고 전개 · 알림 · 결정 이력 · 판매(ATP) · 가상 운영 · What-If 8화면에 화면별 차트를 넣고, 기존 시계열 차트 3종에 기간 브러시를 붙입니다.

**Architecture:** Plan A · B 와 같습니다. 집계 넷(`v_chart_order_calendar` · `v_chart_projection_total` · `v_chart_alert_daily` · `v_chart_sales_status`)만 새 조회 함수를 쓰고, 나머지는 화면이 이미 가진 행을 정규화합니다. 대시보드의 공급처별 금액 · 알림 유형 · 월별 결정 차트를 재사용합니다.

**Spec:** `docs/superpowers/specs/2026-09-04-screen-charts-design.md` §4.3 · §5

## Global Constraints

Plan A 의 Global Constraints 전부.

## 스펙과 다른 점 (이유 포함)

| 화면 | 스펙 | 계획 | 이유 |
|---|---|---|---|
| 발주 추천 | 위험 분포 스택 | 생략 | `v_purchase_recommendation_kpi` 에 안전 건수가 없어 화면이 빼기를 해야 합니다 |
| 결정 이력 | 추천 vs 승인 수량 산점도 | 조정량 ± 막대 (승인만, 절댓값 큰 순 20) | `v_decision_history` 에는 조정량만 있고 추천·승인 수량이 없습니다 |
| 판매 | 품목별 ATP 버킷 막대 | 생략 | 화면이 `v_atp` 를 조회하지 않고, 품목마다 따로 조회해야 합니다 |

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/chart-model.ts` (추가) | `normalizeOrderCalendar` · `normalizeProjectionTotal` · `normalizeAlertDaily` · `normalizeSalesStatus` · `toAdjustmentBars` · `toShortfallBars` · `toSimulationTotalPoints` · `toSimulationItemBars` · `toWhatIfCompare` |
| `lib/charts.ts` (추가) | `getOrderCalendar` · `getProjectionTotal` · `getAlertDaily` · `getSalesStatus` |
| `components/chart/recommendation-calendar.tsx` | 발주 권고일 주별 건수 막대 + 금액 선 |
| `components/chart/projection-total.tsx` | 전체 재고 합계 면적 + 결품 품목 수 막대, 브러시 |
| `components/chart/alerts-daily.tsx` | 30일 일별 발생 막대 · 해결 선, 브러시 |
| `components/chart/decision-adjustment.tsx` | 승인 조정량 ± 가로 막대, 클릭 → 결정 상세 |
| `components/chart/sales-status-mix.tsx` | 공급 상태별 품목 수 가로 스택, 클릭 → 카드 필터 |
| `components/chart/sales-shortfall.tsx` | 납기 위험 수주의 부족 수량 막대(납기 순) |
| `components/chart/simulation-totals.tsx` | 전 품목 재고 합 실제 vs 시뮬 선 + 결품 품목 수 막대 |
| `components/chart/simulation-item-bars.tsx` | 품목별 결품 월 실제 vs 시뮬 그룹 막대, 클릭 → `?item=` |
| `components/chart/whatif-compare.tsx` | 기준 vs 시나리오 지표 4종 그룹 막대 |
| `forecast-overlay-chart.tsx` · `projection-chart.tsx` · `comparison-chart.tsx` (수정) | `brushProps` 로 브러시 |
| 8개 `page.tsx` (수정) | 차트 띠 삽입 |

### Task 1: 정규화 · 조회 — 테스트 → 구현 → 커밋
### Task 2: 기존 차트 3종 브러시
### Task 3: 발주 추천 (캘린더 + 공급처별 금액 재사용, 영업 가림) · 발주 상세(브러시만)
### Task 4: 재고 전개 (전체 합계) · 알림 (유형 재사용 + 일별)
### Task 5: 결정 이력 (월별 재사용 + 조정량) · 판매 (상태 분포 + 부족 수량)
### Task 6: 가상 운영 (합계 + 품목별) · What-If (지표 비교)
### Task 7: `tsc` · `npm test` · `npm run build` · 커밋 · step.md 안내
