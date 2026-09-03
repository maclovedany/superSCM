# STEP 9 구현 지시서 — 리드타임 정책화 + Inventory Projection 재작성

> 먼저 `docs/prompts/_공통규칙.md` 를 읽으세요. 거기 있는 규칙·전제·본보기 파일은 여기 다시 적지 않습니다.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 9** 입니다. 두 가지를 만듭니다.

1. **리드타임 정책 화면** — 관리자가 SQL 없이 공급처별 계획 리드타임을 확정하고, 변경 이력이 남습니다.
2. **재고 전개(Inventory Projection) 재작성** — 지금 `analytics.v_stockout_risk` 는 `가용재고 ÷ 일평균` 한 줄 나눗셈입니다. 이를 `renew.prd` 19장 공식(기간별 전개)으로 바꾸고, 결품 위험을 4상태(SAFE · WARNING · CRITICAL · CALCULATION_UNAVAILABLE)로 확장합니다.

읽을 PRD 장: **18(Lead Time) · 19(Inventory Projection) · 20(Stockout Risk) · 17.1(Consensus 구조만)**.

## 만들 것

### 1. `sql/15-inventory-projection.sql`

머리말에 "sql/13-backtest.sql 까지 먼저 실행" 을 적습니다. 순서: 테이블 → 함수 → core 뷰 → analytics 뷰 → 권한 → 확인 select.

**1-1. 리드타임 정책 이력**

```
core.leadtime_plan_history
  id bigserial PK · supplier_id · lead_time_before int · lead_time_after int ·
  basis text · reason text not null · changed_by uuid · changed_email text · changed_at timestamptz default now()

core.set_leadtime_plan(p_supplier_id text, p_planned_lead_time int, p_reason text)
  returns table (ok boolean, message text) · security definer · 첫 줄 core.is_admin()
  · p_reason 이 비면 거부 (renew.prd 11.4 "변경 이력을 남긴다")
  · p_planned_lead_time 이 null 이면 확정값 해제 = core.leadtime_plan 행 삭제 (실적 P80 으로 되돌아감)
  · 아니면 core.leadtime_plan 에 upsert (basis='MANUAL', confirmed_reason=p_reason, confirmed_at=now())
  · 전/후 값을 history 에 insert
  · 0 이하 값은 거부

analytics.v_leadtime_policy
  supplier_id · supplier_name · country · std_lead_time(마스터) · n_samples · p50_days · p80_days · p90_days ·
  std_days · confidence · planned_lead_time · effective_lead_time · source('확정값'|'실적 P80') ·
  confirmed_reason · confirmed_at · last_changed_at
  ← core.v_leadtime_effective 를 기준으로 analytics.v_leadtime_gap(std_lead_time) 을 left join

analytics.v_leadtime_plan_history   history 에 supplier_name 을 붙인 것
```

**1-2. AI 예측 · Override · Consensus (스키마)**

```
core.v_ai_forecast
  가장 최근 SUCCESS 인 core.forecast_run 하나를 잡고, 품목마다
    · core.champion_model.champion_model_id 가 그 run 에 결과를 갖고 있으면 그 모델 (source='CHAMPION')
    · 아니면 core.model_config.is_default 모델 (source='DEFAULT')
  컬럼: run_id · model_id · model_version · item_id · period · predicted_qty · p50 · p80 · p90 · sigma ·
        data_snapshot_at · source

core.forecast_override          ★ STEP 12 가 화면을 만듭니다. 여기서는 테이블만 (STEP 3 의 soft_allocation 선례)
  id bigserial PK · item_id · period date · run_id · ai_forecast numeric · override_qty numeric(증감, 음수 가능) ·
  consensus_forecast numeric · reason_code text not null
    check (reason_code in ('NEW_CONTRACT','PROMOTION','NEW_PRODUCT','DISCONTINUED','PROJECT','MARKET_CHANGE','DATA_ERROR','OTHER')) ·
  reason_text text · created_by uuid · created_email text · created_at timestamptz default now() ·
  superseded_at timestamptz   (null = 현재 유효. 같은 item×period 에 새 Override 가 오면 이전 행의 superseded_at 을 채웁니다)
  partial unique index (item_id, period) where superseded_at is null
  RLS: 읽기 authenticated · insert authenticated (USER 도 Override 가능 — renew.prd 4.3) · update 는 본인 또는 관리자

core.v_consensus_forecast
  v_ai_forecast 에 유효한 Override 를 left join
  item_id · period · run_id · model_id · ai_qty · override_qty(없으면 null) ·
  consensus_qty = ai_qty + coalesce(override_qty, 0) · p80 · p90 · sigma · has_override boolean · data_snapshot_at
```

**1-3. 재고 전개 ★**

```
analytics.v_inventory_projection      품목 × 미래 기간 (오늘이 속한 달부터 forecast 가 있는 마지막 기간까지)
  item_id · item_name · supplier_id · period · period_index(1부터) ·
  opening_qty          기초 재고 (첫 기간 = core.v_stock_on_hand.current_stock, 이후 = 전 기간 closing)
  receipt_qty          입고예정. core.v_inbound_qty 의 inbound_qty 를 earliest_eta 가 속한 기간에 넣습니다.
                       eta 가 오늘 이전이면 첫 기간에 넣습니다
  forecast_qty         core.v_consensus_forecast.consensus_qty
  committed_so_qty     raw.sales_order status='CONFIRMED' 이고 due_date 가 그 기간인 수량 합
  soft_allocation_qty  core.soft_allocation status='RESERVED' 이고 valid_until >= current_date 인 수량 합 — 첫 기간에만
  demand_qty           = greatest(forecast_qty, committed_so_qty) + soft_allocation_qty
                       (renew.prd 22.1 "확정 수주가 있으면 예측보다 우선" 을 기간 단위로 적용. 둘을 더하면 이중 계산)
  closing_qty          = opening + receipt − demand   (누적 계산은 window sum 으로. 재귀 CTE 불필요)
  cumulative_demand_qty 첫 기간부터의 누적 demand (renew.prd 19.3)
  forecast_source      'CHAMPION' | 'DEFAULT'
  run_id · data_snapshot_at

  forecast 가 없는 기간은 행을 만들지 않습니다 (임의 값 금지). 그 결과 전개가 거기서 끊깁니다.
  is_active = 'Y' 품목만.

analytics.v_stockout_risk   ★ 재작성. 기존 컬럼 이름은 전부 유지하고(화면·정규화 함수가 읽습니다) 아래를 더합니다.
  기존: item_id · item_name · supplier_id · current_stock · inbound_qty · available_qty · daily_usage_avg · cv ·
        planned_lead_time · stockout_days · stockout_date · risk_status · reason
  추가: run_id · forecast_source · data_snapshot_at · first_negative_period ·
        days_of_supply · months_of_supply · leadtime_demand_qty · required_qty

  stockout_date   전개에서 closing_qty < 0 이 처음 되는 기간. 그 달 안에서 선형 보간:
                  period_start + floor(opening_qty / (demand_qty / 그 달 일수))  (demand_qty = 0 이면 그 기간에서 결품 아님)
                  전개 끝까지 음수가 없으면 null
  stockout_days   stockout_date − current_date (없으면 null)
  days_of_supply  = stockout_days 와 같은 뜻이되, 전개 끝까지 여유가 있으면 null 이 아니라 "전개 기간 이상" 을 뜻하도록
                  months_of_supply 를 함께 둡니다 (전개 기간 수 = 커버 확인된 개월 수)
  leadtime_demand_qty  오늘부터 (effective_lead_time + REVIEW_PERIOD_DAYS) 일까지의 누적 demand.
                       월 단위 전개를 일 단위로 안분 (기간 일수 비례)
  required_qty    = leadtime_demand_qty − available_qty (음수면 0). renew.prd 19.3 의 "필요량"
  risk_status
    CALCULATION_UNAVAILABLE  reason 이 있을 때
    CRITICAL   stockout_days < effective_lead_time                    (지금 발주해도 결품 후 도착)
    WARNING    stockout_days < effective_lead_time + REVIEW_PERIOD_DAYS + SAFETY_BUFFER_DAYS   (이번 검토 주기 안에 발주해야 함)
    SAFE       그 밖에 (stockout_date 가 null 이면 SAFE)
    ★ 정책값은 core.policy_config 에서 읽습니다. 숫자를 뷰에 적지 마세요.
  reason (우선순위 순)
    NO_INVENTORY_DATA   core.v_stock_on_hand 에 행이 없음
    NO_LEADTIME         effective_lead_time 이 null
    NO_FORECAST         v_consensus_forecast 에 오늘 이후 기간이 하나도 없음 (예측 미실행 · horizon 부족)
    NO_USAGE_HISTORY    학습 구간 수요가 전혀 없음 (v_sku_demand_profile.demand_type = 'NO_DEMAND')
    INSUFFICIENT_SAMPLE 그 밖의 판정 불가

analytics.v_stockout_kpi
  n_items · n_critical · n_warning · n_safe · n_unknown · n_within_30d · n_within_60d · avg_stockout_days

analytics.v_projection_item      화면의 품목 선택 칩용 요약 한 줄/품목
  item_id · item_name · risk_status · stockout_date · stockout_days · reason
```

> **주의** `analytics.v_stockout_risk` 는 `create or replace view` 로 컬럼을 추가할 수 있지만(끝에 추가), 컬럼 타입이 바뀌면 안 됩니다. 기존 `risk_status` 가 'UNKNOWN' 을 내던 것을 'CALCULATION_UNAVAILABLE' 로 바꾸는 것은 값 변경이라 괜찮습니다. 애매하면 `drop view analytics.v_stockout_kpi; drop view analytics.v_stockout_risk;` 후 재생성하세요 (v_stockout_kpi 가 의존합니다).

권한: 새 테이블은 공통 패턴. `core.forecast_override` 만 위에 적은 대로 USER insert 허용. 새 analytics 뷰 전부 `grant select to authenticated`. `core.v_ai_forecast` · `core.v_consensus_forecast` 도 `grant select to authenticated` (STEP 12 화면이 읽습니다).

파일 끝 확인 select: `select * from analytics.v_stockout_kpi;` · `select item_id, risk_status, reason, stockout_date, planned_lead_time from analytics.v_stockout_risk order by stockout_days nulls last;` · `select * from analytics.v_leadtime_policy order by supplier_id;`

### 2. `lib/status.ts` · `lib/scm-model.ts` · `lib/scm.ts`

- `ReasonCode` 에 `'NO_FORECAST'` 추가, `REASON_LABEL['NO_FORECAST'] = '예측 없음'`, `toReasonCode` 도 받도록. `toRiskStatus` 주석의 "STEP 9 에서" 문구를 현재 상태로 고칩니다.
- `StockoutRisk` 타입에 `runId · forecastSource · dataSnapshotAt · firstNegativePeriod · daysOfSupply · monthsOfSupply · leadtimeDemandQty · requiredQty` 추가하고 `normalizeStockoutRisk` 가 채웁니다 (후보 컬럼명 방식 유지).
- `StockoutKpi` 에 `warningCount · within60DaysCount` 추가.
- `lib/scm-model.test.ts` 에 새 필드 정규화 · `NO_FORECAST` · `WARNING` 매핑 테스트를 추가합니다 (순수 함수만).

### 3. `lib/inventory.ts` (신규)

```
getInventoryProjection(itemId)   → { rows: ProjectionRow[], error }   analytics.v_inventory_projection, period 순
getProjectionItems()             → { rows: ProjectionItem[], error }  analytics.v_projection_item, 위험 순(nullsLast)
getLeadtimePolicies()            → { rows: LeadtimePolicy[], error }  analytics.v_leadtime_policy
getLeadtimePlanHistory(limit=50) → { rows, error }                    analytics.v_leadtime_plan_history
```

`lib/backtest.ts` 와 같은 모양 (num() · try/catch · { rows, error }).

### 4. `components/chart/projection-chart.tsx` (신규 · 'use client')

`design.md` §7.3 "결품(0 이하) 영역" 규칙: 예상재고 선(시리즈 색 1번) + 0선 `--crit` 파선(`ReferenceLine`) + 음수 구간 `ReferenceArea` 에 `CHART_TOKENS.deficitBand` + 입고예정은 `Bar`(시리즈 색 2번, 알파). 계산하지 않고 받은 값만 그립니다. props: `data: { period; opening; receipt; demand; closing }[]`, `leadTimeDays?: number | null` (있으면 오늘+리드타임 위치에 세로 `ReferenceLine` "리드타임" 라벨).

### 5. 화면

**5-1. `app/(user)/inventory-projection/page.tsx`** — `Planned` 를 실제 화면으로 교체

- 상단: 품목 선택 칩 (`?item=`, `getProjectionItems()`; 칩에 상태 배지 색을 점으로 표시하지 말고 `StatusBadge` 소형 텍스트). 기본 선택 = 가장 먼저 결품되는 품목
- 예측이 stale 이면 `.stale-banner` (design.md §8.4) — `getLatestSuccessfulRun()` 의 `isStale`
- KPI 4장 (`// kpi-filter: 없음 — 한 품목을 설명하는 지표`): 현재고 · 입고예정 · 결품 예상일 · 소진까지 (null 이면 EmptyValue + reason)
- 차트 패널 (`ProjectionChart`)
- 월별 표: 기간 · 기초 · 입고예정 · 예측수요 · 확정수주 · 가예약 · 적용수요 · 기말 · 상태(기말 < 0 이면 `crit` 배지 "결품")
- InsightBanner: "가장 먼저 음수가 되는 기간 · 리드타임 안에 커버해야 하는 누적 수요 · 필요량". 수치는 뷰가 준 값만.
- `PageHeader` meta: PRD 19 · run_id

**5-2. `app/(user)/analysis/stockout/page.tsx`** — 4상태로 갱신

- subtitle 과 meta("STEP 9 에서 재작성") 를 현재 상태로 고칩니다
- KPI: 대상 품목 · 위험(CRITICAL) · **주의(WARNING)** · 30일 이내 · 산출 불가 → `grid-kpi` 가 4열이면 5장은 두 줄이 됩니다. 5장을 두되 마지막 카드는 "산출 불가" 로 유지하고 30일 이내 카드를 "60일 이내" 와 합치지 마세요. (5장 허용)
- 표: 품목코드를 `/inventory-projection?item=` 링크로. 컬럼에 "예측 기준"(forecast_source: Champion/기본) 과 "필요량" 추가. 일평균 사용 컬럼은 제거하지 말고 유지
- 표시 문구: WARNING = 주의 · CRITICAL = 위험 (`lib/status.ts` 의 RISK_LABEL 그대로)

**5-3. `app/(admin)/admin/policies/leadtime/page.tsx`** — `Planned` 교체 + `actions.ts` + `state.ts` + `leadtime-row-form.tsx`

- 첫 줄 `requireAdmin()` (레이아웃이 이미 막지만 화면도 검증)
- KPI: 공급처 수 · 확정값 적용 · 실적 P80 적용 · 표본 부족(confidence LOW) — 각각 필터
- 표: 공급처 · 국가 · 마스터 · 실적 P50/P80/P90 · 표본 · 신뢰도(LOW/MEDIUM 만 배지, design.md §8.3) · 적용값(source 배지) · 행 폼(숫자 입력 + 사유 입력 + 저장, "해제" 버튼)
- 액션 `saveLeadtimePlan(prev, formData)`: `requireAdminOrThrow()` → rpc `set_leadtime_plan` → `writeAuditLog(action: 'LEADTIME_PLAN_SET')` → `revalidatePath('/admin/policies/leadtime')` · `/analysis/stockout` · `/inventory-projection`
- 하단 패널: 변경 이력 50건

### 6. 인터페이스 (다음 단계가 씁니다 — 이름을 바꾸지 마세요)

- `core.v_consensus_forecast(item_id, period, run_id, model_id, ai_qty, override_qty, consensus_qty, p80, p90, sigma, has_override, data_snapshot_at)`
- `analytics.v_inventory_projection` 의 컬럼 이름 위 그대로
- `analytics.v_stockout_risk` 의 `risk_status` 4값 · `reason` 5값 · `required_qty` · `leadtime_demand_qty`
- `lib/inventory.ts` 의 함수 4개 · `lib/scm.ts` 의 `getStockoutRisks()` · `getStockoutKpi()`

## 완료 판정

- [ ] `npx tsc --noEmit` · `npm test` · `npm run build` 성공
- [ ] `grep -rn "from 'recharts'" app components | grep -v components/chart/` → 0건
- [ ] 화면 파일 hex 색 0건 · `schema('raw')` 0건
- [ ] `sql/15-inventory-projection.sql` 을 처음부터 끝까지 다시 읽어 세미콜론·별칭·RETURNS TABLE 컬럼 충돌(error.md #11)을 검사했다
- [ ] 정책값(리드타임 · 검토 주기 · 여유일)이 SQL 에 숫자로 박혀 있지 않다
- [ ] 계산 불가 품목이 `—` + 사유 코드로 표시되고 정렬에서 맨 뒤로 간다
- [ ] 리드타임 확정 시 사유가 필수이고 이력이 남는다
- [ ] `/inventory-projection` · `/analysis/stockout` · `/admin/policies/leadtime` 세 화면이 빌드된다

## 보고서

`.superpowers/sdd/step/task-09-report.md` 에 `_공통규칙.md` §6 형식으로 씁니다.
