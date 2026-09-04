# 화면별 인터랙티브 차트 — Plan B (분석 · 예측 7화면) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan A 의 바탕 위에 수요 프로파일 · 리드타임 · 결품 위험 · 예측 · 모델 평가 · 모델 비교 · 예측 보정 7화면에 화면별 차트를 넣습니다.

**Architecture:** Plan A 와 같습니다 — `components/chart/<화면>-<차트>.tsx`(`'use client'`) + `ChartFrame` + `lib/chart-model.ts` 정규화(순수 · 테스트) + `lib/charts.ts` 조회. 행 단위 데이터는 이미 화면이 조회하는 것을 그대로 넘기고, 집계 둘(`v_chart_usage_heatmap` · `v_chart_champion_share`)만 새 조회 함수를 씁니다.

**Tech Stack:** Plan A 와 동일.

**Spec:** `docs/superpowers/specs/2026-09-04-screen-charts-design.md` §4.2

## Global Constraints

Plan A 의 Global Constraints 전부. 추가로:
- 정렬 · 걸러내기 · 피벗은 "모양 바꾸기" 로 허용합니다. 합계 · 평균 · 순위 · 비율은 만들지 않습니다.
- 히트맵의 칸 진하기는 그 품목의 최댓값 대비 상대 명도입니다 — 숫자를 만드는 것이 아니라 색을 고르는 것이며, 칸에는 실제 수량을 툴팁으로 냅니다.

## 스펙과 다른 점 (이유 포함)

| 화면 | 스펙 | 계획 | 이유 |
|---|---|---|---|
| 예측 보정 | 기간별 실적·AI·컨센서스 선 | AI 오차 vs 컨센서스 오차 산점도 (대각선 = 같음) | `v_forecast_value_add` 는 품목×기간 행이라 기간별 한 선을 그리려면 화면이 합쳐야 합니다. 산점도는 행 그대로 "누가 더 맞았나" 를 보여 줍니다 |
| 결품 위험 | 결품 예상일 점 타임라인 | 판정 분포 스택(대시보드 ② 재사용, 카드 필터로 이동) | 타임라인은 재고 유지 일수 막대와 같은 값을 두 번 그립니다 |

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/chart-model.ts` (추가) | `toQuadrantPoints` · `demandTypeMixFromKpi` · `normalizeHeatmapCell` · `pivotHeatmap` · `toLeadtimeBars` · `toStockoutBars` · `toWapeBars` · `toImprovementBars` · `normalizeChampionShare` · `toMetricBars` · `toReasonBars` · `toErrorPoints` |
| `lib/chart-model.test.ts` (추가) | 위 함수마다 실제 컬럼명 fixture + null 처리 |
| `lib/charts.ts` (추가) | `getUsageHeatmap()` · `getChampionShare()` |
| `components/chart/demand-quadrant.tsx` | CV²×ADI 산점도, 경계선 0.49 · 1.32, 유형색, 점 클릭 → `?item=` |
| `components/chart/demand-type-mix.tsx` | 수요 유형 6구간 가로 스택, 클릭 → `?filter=` (smooth · croston · unclassified 만) |
| `components/chart/demand-heatmap.tsx` | 품목×월 CSS 그리드 히트맵 (recharts 없음), 셀 툴팁 · 클릭 → `?item=` |
| `components/chart/leadtime-gap-bars.tsx` | 공급처별 마스터 vs P80 그룹 막대 |
| `components/chart/leadtime-gap-rank.tsx` | 격차(P80 − 마스터) ± 가로 막대 |
| `components/chart/stockout-days-bar.tsx` | 품목별 재고 유지 일수 + 리드타임 그룹 가로 막대, 상태색, 클릭 → `/purchase-recommendation/<item>` |
| `components/chart/forecast-model-totals.tsx` | 실행의 모델별 예측 합계 막대, 클릭 → `?model=` |
| `components/chart/evaluation-wape-bars.tsx` | 품목별 Champion WAPE 가로 막대(내림차순), 수동 지정은 옅게 + "수동" |
| `components/chart/evaluation-champion-share.tsx` | 모델별 Champion 품목 수 가로 스택 |
| `components/chart/evaluation-improvement.tsx` | 베이스라인 대비 개선율 ± 가로 막대 |
| `components/chart/comparison-metric-bars.tsx` | 모델별 WAPE · Bias 그룹 막대, Champion 강조 |
| `components/chart/override-reason-bars.tsx` | 사유별 AI vs Consensus WAPE 그룹 막대 |
| `components/chart/override-error-scatter.tsx` | AI 오차 vs Consensus 오차 산점도 |
| 7개 `page.tsx` (수정) | 차트 띠 삽입, `?item=` → `selectedKey`, 예측 화면은 기존 오버레이 차트 사용 |

---

### Task 1: 정규화 함수 · 조회 함수

**Interfaces (Produces, `lib/chart-model.ts`):**
- `type QuadrantPoint = { itemId, label, adi: number, cv2: number, demandType: string | null }` · `toQuadrantPoints(rows: SkuDemandProfile[])` — adi · cvSquared 가 null 인 행은 뺍니다
- `type DemandTypeSlice = { key: 'SMOOTH'|'INTERMITTENT'|'ERRATIC'|'LUMPY'|'NO_DEMAND'|'UNCLASSIFIED', label, n }` · `demandTypeMixFromKpi(kpi: DemandProfileKpi)`
- `type HeatmapCell = { itemId, itemName, period: 'YYYY-MM', qty: number | null }` · `normalizeHeatmapCell(row)` · `type HeatmapRow = { itemId, label, cells: { period, qty }[], max: number | null }` · `pivotHeatmap(cells): { periods: string[]; rows: HeatmapRow[] }` — max 는 색 명도용
- `type LeadtimeBar = { supplier, master: number | null, p80: number | null, avg: number | null, gap: number | null, lowSample: boolean }` · `toLeadtimeBars(rows: LeadtimeGap[])`
- `type StockoutBar = { itemId, label, days: number | null, leadTime: number | null, status: RiskStatus }` · `toStockoutBars(rows: StockoutRisk[], limit = 20)` — stockoutDays null 은 뒤로, limit 까지
- `type WapeBar = { itemId, label, wape: number | null, improvement: number | null, manual: boolean, modelName: string | null }` · `toWapeBars(rows: ChampionModel[])` — wape 내림차순, null 뒤
- `type ChampionShareRow = { modelId, modelName, nItems, nManual, avgWape }` · `normalizeChampionShare(row)`
- `type MetricBar = { modelId, label, wape: number | null, bias: number | null, isChampion: boolean }` · `toMetricBars(rows: ModelPerformance[])`
- `type ReasonBar = { reasonCode, label, n, aiWape, consensusWape }` · `toReasonBars(rows: ValueAddByReason[], labelOf: (code: string) => string)`
- `type ErrorPoint = { itemId, period, aiError: number, consensusError: number, improved: boolean | null }` · `toErrorPoints(rows: ValueAddRow[])` — 두 오차 모두 있는 행만

**Interfaces (Produces, `lib/charts.ts`):** `getUsageHeatmap(): Promise<{ rows: HeatmapCell[]; error }>` (limit 600) · `getChampionShare(): Promise<{ rows: ChampionShareRow[]; error }>` (limit 50)

- [ ] 실패하는 테스트 → 구현 → `node --test lib/chart-model.test.ts` → `npx tsc --noEmit` → 커밋

### Task 2: 수요 프로파일 (3종)

- 페이지 `app/(user)/analysis/demand-profile/page.tsx`: `readFilter(params, 'item')` 로 `selectedItem`, `DataTable selectedKey={selectedItem ?? undefined}`. `getUsageHeatmap()` 를 `Promise.all` 에 추가. `<Panel title="분류 기준" >` 앞에 `grid-charts data-cols="3"` 띠: 산점도 · 유형 분포 · 히트맵.
- 산점도: `ScatterChart` x=`adi`(log 아님, 선형), y=`cv2`, `ReferenceLine x={1.32}` · `y={0.49}`, 사분면 라벨 4개(`Label` 로), `Cell` 색 = 유형별 `SERIES_COLORS`(SMOOTH 초록 · INTERMITTENT 파랑 · ERRATIC 앰버 · LUMPY 분홍), 점 클릭 → `router.push('?item=<id>')`. 툴팁: 품목 · ADI · CV² · 유형.
- 유형 분포: 가로 스택 한 줄 + 칩(대시보드 ② 와 같은 구조), `hrefFor`: SMOOTH→`?filter=smooth`, INTERMITTENT · LUMPY→`?filter=croston`, UNCLASSIFIED→`?filter=unclassified`, 나머지 null.
- 히트맵: `div.heatmap` CSS 그리드. 행 = 품목(최대 40), 열 = 12개월. 칸 배경 = `SERIES_COLORS[0]` 알파 `0.08 + 0.72 × qty/max`, null 은 빗금 없이 `--surface-3`. 칸 `title` 툴팁 + 커스텀 툴팁 없음(네이티브 title). 행 라벨 클릭 → `?item=`. `styles/chart.css` 에 `.heatmap` · `.heatmap-cell` 추가.
- 검증: tsc · npm test · 커밋

### Task 3: 리드타임 (2종)

- 페이지: `<Panel title="공급처별 리드타임"` 앞에 2열 띠. 데이터는 이미 있는 `rows`.
- 그룹 막대: x=공급처, Bar master(회색 `STATUS_COLORS.UNKNOWN`) · p80(파랑), 표본 30 미만은 `LabelList` "표본 n". 툴팁: 마스터 · 평균 · P80 · 표본.
- 격차 순위: 가로 ± 막대, gap>0 빨강, ≤0 초록, `ReferenceLine x={0}`. gap null 은 뺍니다.

### Task 4: 결품 위험 (2종)

- 페이지: `title="품목별 소진 위험"` 패널 앞에 2열 띠. `DashboardRiskMix` 를 `riskMixFromKpi(kpi)` 로 재사용, `hrefFor`: CRITICAL→`?filter=critical`, WARNING→`?filter=warning`, UNKNOWN→`?filter=unknown`, SAFE→null(그 화면에 safe 필터 없음).
- 재고 유지 일수: 가로 그룹 막대 — `days`(상태색) · `leadTime`(회색 얇게). 위험은 days < leadTime 이라는 뜻이 눈에 보입니다. 상위 20 품목(뷰 정렬 = stockout_days 오름차순). 클릭 → `/purchase-recommendation/<item>`.

### Task 5: 예측 (오버레이 + 1종)

- 페이지: `getItemSeries(activeItem)` (`lib/backtest`) 를 detail 과 함께 조회. `activeItem` 패널 안 표 위에 `ForecastOverlayChart`(기존) — 데이터 조립은 model-comparison page.tsx 118~156행과 같은 병합(복사). `bandModelId = activeModel`.
- 모델별 예측 합계: `<InsightBanner eyebrow="FORECAST">` 앞에 1열 띠(`grid-charts` 기본 2열 중 하나만 채우지 말고 `data-cols="1"` 은 없으므로 `Panel` 대신 `ChartFrame` 단독). 세로 막대 `totalQty` per model, active 모델 강조, 클릭 → `?model=<id>&item=…`. `rows`(행 수) 툴팁.

### Task 6: 모델 평가 (3종)

- 페이지: `getChampionShare()` 를 `Promise.all` 에 추가. `title="품목별 Champion"` 패널 앞에 3열 띠.
- WAPE 막대(가로, 내림차순, 상위 20): 수동 지정은 `fillOpacity 0.45` + `LabelList` "수동". 클릭 → `/model-comparison?item=`.
- Champion 점유: 가로 스택 한 줄, 모델별 `colorMap`, 칩에 `n_items` 와 수동 수.
- 개선율: ± 가로 막대, `ReferenceLine x=0`, 양수 초록 · 음수 빨강. null 제외.

### Task 7: 모델 비교 (1종)

- 페이지: `title="성능 비교"` 패널 앞에 `ChartFrame` 단독. `toMetricBars(performance)`.
- 그룹 세로 막대 WAPE · Bias(부호 유지) per model, Champion 은 굵은 테두리(`stroke` 잉크). 툴팁에 MAPE 없음(값 두 개만).

### Task 8: 예측 보정 (2종)

- 페이지: `title="Forecast Value Add"` 패널 앞에 2열 띠. `byReason.rows` · `valueAdd.rows` 사용(변수명은 파일 338행 구조분해 그대로). 사유 라벨은 `reasonLabel` (`lib/override-model`).
- 사유별 막대: 그룹 세로 막대 aiWape · consensusWape per 사유, y 축 `pctTick`.
- 오차 산점도: x=aiError, y=consensusError, 대각선 `ReferenceLine segment=[{x:0,y:0},{x:max,y:max}]`, improved true 초록 · false 빨강 · null 회색. 툴팁: 품목 · 기간 · 두 오차.

### Task 9: 마무리

- `npx tsc --noEmit && npm test && npm run build`
- 스크린샷은 사용자가 확인. Plan C 로.
