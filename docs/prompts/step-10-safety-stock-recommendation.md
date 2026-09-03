# STEP 10 구현 지시서 — Safety Stock + Purchase Recommendation + SKU Detail

> 먼저 `docs/prompts/_공통규칙.md` 를 읽으세요. STEP 9 산출물(`sql/15-inventory-projection.sql` · `lib/inventory.ts` · `components/chart/projection-chart.tsx`)을 전제로 합니다. STEP 9 보고서 `.superpowers/sdd/step/task-09-report.md` 의 "인터페이스" 절도 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 10** 입니다. 시스템의 핵심 가치입니다.

1. **안전재고** — 예측 오차(백테스트)와 리드타임 변동으로 σ_DLT 를 구하고 Service Level 의 Z 를 곱합니다.
2. **발주 추천** — 리드타임+검토주기 동안의 수요 + 안전재고 − 가용 − 입고예정 → MOQ · Pack 반영 → 발주 권고일.
3. **SKU Detail** — PRD 29장의 28개 항목을 한 화면 한 흐름으로.
4. 관리자 정책 화면 — Service Level · 품목 정책(MOQ · Pack · 등급) · 안전재고 확인.

읽을 PRD 장: **21(Safety Stock) · 22(Purchase Recommendation) · 29(SKU Detail) · 18.2(신뢰도)**.

## 만들 것

### 1. `sql/16-safety-stock-recommendation.sql`

머리말: "sql/15-inventory-projection.sql 을 먼저 실행". 순서: 테이블 → 시드 → core 뷰 → analytics 뷰 → 권한 → 확인.

**1-1. Service Level**

```
core.service_level
  item_grade text · service_level numeric · z_value numeric · effective_from date default current_date ·
  updated_by uuid · updated_at
  PK (item_grade, effective_from)
  시드: ('A', 0.98, 2.0537) · ('B', 0.95, 1.6449) · ('C', 0.90, 1.2816)  effective_from '2000-01-01'

core.z_table                    서비스 수준 → Z (정규분포 분위수). 품목별 service_level 이 표에 없으면 가장 가까운 값
  service_level numeric PK · z_value numeric
  시드: 0.80 0.8416 · 0.85 1.0364 · 0.90 1.2816 · 0.95 1.6449 · 0.975 1.9600 · 0.98 2.0537 · 0.99 2.3263 · 0.995 2.5758

core.v_item_service_level       품목별 적용 서비스 수준과 Z. 우선순위:
  ① core.item_policy.service_level (품목 직접 지정) → z_table 최근접
  ② core.item_policy.item_grade → core.service_level 의 effective_from <= current_date 중 최신
  ③ core.policy_config SERVICE_LEVEL_DEFAULT · Z_VALUE_DEFAULT
  컬럼: item_id · item_grade · service_level · z_value · source('ITEM'|'GRADE'|'DEFAULT')
```

**1-2. 단가**

```
core.v_item_price               raw.item_master."표준단가" 를 숫자로. 정규화 item_id 기준 distinct on
  item_id · unit_price numeric (변환 실패·빈 값이면 null)
```

**1-3. 안전재고 ★**

```
analytics.v_safety_stock
  item_id · item_name · supplier_id · item_grade · service_level · z_value · service_level_source ·
  lead_time_days(L)           core.v_leadtime_effective.effective_lead_time
  lead_time_sd(σ_L)           core.v_leadtime_stat.std_days
  lead_time_confidence        core.v_leadtime_stat.confidence
  daily_demand(d)             오늘부터 L+REVIEW_PERIOD_DAYS 일의 누적 consensus 수요 ÷ 그 일수  (v_stockout_risk.leadtime_demand_qty 재사용 가능)
  sigma_d_monthly             ① core.champion_model.rmse (백테스트) ② 없으면 core.v_ai_forecast.sigma (in-sample) ③ 없으면 null
  sigma_d(일 단위)            sigma_d_monthly / sqrt(30.4)   ← 일별 독립 가정. 주석으로 남깁니다
  sigma_source                'BACKTEST' | 'IN_SAMPLE' | null
  sigma_dlt                   sqrt( L × σ_d² + d² × σ_L² )    σ_L 이 null 이면 0 으로 보지 말고 → 표본 부족이면 σ_L=0 으로 두되 reason 을 'INSUFFICIENT_SAMPLE' 로 남기지 않습니다.
                              (리드타임 표본이 1건이면 std 가 null 입니다. 이때는 σ_L = 0 으로 계산하고 lead_time_confidence 로 드러냅니다)
  safety_stock                round(z × sigma_dlt)
  reason                      NO_LEADTIME(L null) · NO_FORECAST(d null) · INSUFFICIENT_SAMPLE(σ_d null) → 이때 safety_stock null
```

**1-4. 발주 추천 ★** (renew.prd 22.3 의 필드 전부)

```
analytics.v_purchase_recommendation      is_active='Y' 품목 전부 (발주 불필요도 포함. final_recommended_qty = 0)
  item_id · item_name · supplier_id · supplier_name ·
  current_inventory · incoming_qty · available_qty(=current+incoming) · incoming_eta ·
  forecast_qty            리드타임+검토주기 창의 순수 consensus 예측 합 (일 안분)
  committed_qty           같은 창의 확정 수주 합
  consensus_forecast      = v_stockout_risk.leadtime_demand_qty (창의 적용수요. max(forecast, committed) 기간별 적용)
  lead_time · lead_time_confidence · review_period_days · safety_buffer_days ·
  safety_stock ·
  stockout_date · required_order_date = stockout_date − lead_time − SAFETY_BUFFER_DAYS (stockout_date null 이면 null)
  raw_recommended_qty     = greatest(0, consensus_forecast + safety_stock − current_inventory − incoming_qty)
  moq · pack_size ·
  final_recommended_qty   raw 가 0 이면 0. 아니면 greatest(raw, coalesce(moq, 0)) 를 pack_size 로 올림(pack null 이면 그대로)
  unit_price · recommended_amount = final × unit_price (단가 null 이면 null)
  risk                    v_stockout_risk.risk_status
  reason_code             v_stockout_risk.reason, 또는 safety_stock 의 reason. 계산 불가면 raw/final 도 null
  explanation             한국어 문장 (SQL 에서 조립). 예:
                          '리드타임 42일 + 검토 30일 동안 수요 1,620 · 안전재고 400 · 가용 1,250 · 입고예정 300 → 필요 470 → MOQ 500 · 포장 100 적용 500'
                          계산 불가면 '산출할 수 없습니다: <사유 라벨>'
  run_id · data_snapshot_at

analytics.v_purchase_recommendation_kpi
  n_items · n_order_needed(final>0) · n_urgent(required_order_date <= current_date) · n_critical · n_warning · n_unknown ·
  total_recommended_qty · total_recommended_amount(단가 있는 것만 합) · n_missing_price
```

**1-5. SKU Detail** (renew.prd 29 — 화면이 한 번에 읽는 요약 한 줄)

```
analytics.v_sku_detail       품목당 1행
  item_id · item_name · supplier_id · supplier_name · country ·
  demand_type ·
  champion_model_id · champion_model_name · champion_wape · champion_bias · champion_selection_method ·
  forecast_run_id · forecast_source · data_snapshot_at · is_stale ·
  current_inventory · incoming_qty · incoming_eta ·
  stockout_date · stockout_days · first_negative_period ·
  lead_time · lead_time_source · lead_time_confidence ·
  safety_stock · service_level · z_value · sigma_dlt ·
  required_order_date · raw_recommended_qty · final_recommended_qty · moq · pack_size · unit_price · recommended_amount ·
  risk · reason_code · explanation ·
  n_overrides(유효 Override 수)
```

권한: `core.service_level` · `core.z_table` 공통 패턴(관리자 쓰기). `core.item_policy` 는 이미 있음. analytics 뷰 전부 `grant select to authenticated`.

확인 select: kpi 한 줄 · `select item_id, risk, required_order_date, raw_recommended_qty, final_recommended_qty, explanation from analytics.v_purchase_recommendation order by required_order_date nulls last limit 20;`

### 2. `lib/recommendation.ts` (신규)

```
getPurchaseRecommendations()        analytics.v_purchase_recommendation · required_order_date 순(nullsLast) · limit 500
getPurchaseRecommendationKpi()
getSkuDetail(itemId)                 analytics.v_sku_detail 한 행
getSafetyStocks()                    analytics.v_safety_stock
getServiceLevels()                   core.service_level (effective_from desc)
getItemPolicies()                    core.item_policy + core.v_item_master 이름 → 뷰 analytics.v_item_policy 를 SQL 에 추가해 그것을 읽습니다
```

타입은 `PurchaseRecommendation` · `SkuDetail` · `SafetyStock` · `ServiceLevel` · `ItemPolicy`. 정규화는 `num()` 방식.

### 3. 화면

**3-1. `app/(user)/purchase-recommendation/page.tsx`** — `Planned` 교체

- KPI 5장: 발주 필요(final>0) · 긴급(권고일 경과) · 위험 · 산출 불가 · **총 추천 금액**(필터 없음, `// kpi-filter` 주석). 단가 누락이 있으면 foot 에 "n개 품목 단가 없음"
- 표 (권고일 순 · 산출 불가 맨 뒤): 품목코드(→ `/purchase-recommendation/[itemId]` 링크) · 품목명 · 공급처 · 판정 배지 · 결품 예상일 · **발주 권고일**(오늘 이전이면 `hl-crit`) · 필요량(raw) · **추천 수량(final)** · MOQ/포장 · 금액 · 설명(한 줄, `t-sm text-2`)
- InsightBanner: 가장 급한 품목 1개와 그 설명(뷰의 explanation 그대로)
- 내보내기: `app/api/recommendation/recommendations.csv/route.ts` (`requireUser`, BOM 포함, 22.3 필드 전부) — STEP 7 의 `app/api/backtest/performance.csv/route.ts` 를 본보기로
- 예측 stale 이면 `.stale-banner`

**3-2. `app/(user)/purchase-recommendation/[itemId]/page.tsx`** — SKU Detail ★ (renew.prd 29장 28개 항목을 위에서 아래로 한 흐름)

`params: Promise<{ itemId: string }>` (Next 15). 없는 품목이면 `notFound()`.

```
PageHeader   품목코드(mono) · 품목명 · meta: 공급처 · run_id · 판정 배지        [← 목록]  [CSV]
§1 수요와 예측       KPI: Champion · WAPE · Bias · 수요 패턴
                     차트: ForecastOverlayChart (실적 = v_item_series, 모델 = champion 의 예측(검증구간 + 미래), 밴드 = P80/P90)
                     ← model-comparison/page.tsx 의 조립 코드를 본보기로. 계산 아님, 병합
§2 Consensus         표: 기간 · AI 예측 · Override(증감) · Consensus · 사유코드  (core.v_consensus_forecast 를 analytics 로 노출한 뷰가 없으면
                     sql/16 에 analytics.v_consensus_forecast 를 추가해 읽습니다. 이름 그대로.) Override 입력 폼은 STEP 12 가 붙입니다.
                     이 표 아래에 `<div id="override-slot" />` 를 두지 말고, 그냥 표만 둡니다.
§3 재고              KPI: 현재고 · 입고예정(+ETA) · 결품 예상일 · 소진까지
                     차트: ProjectionChart (lib/inventory.getInventoryProjection)
§4 발주              KPI: 리드타임(+신뢰도 배지 LOW/MEDIUM) · 안전재고 · 발주 권고일 · 추천 수량
                     안전재고 근거 표: Service Level · Z · L · σ_L · d · σ_d(출처) · σ_DLT   — 뷰가 준 값만
                     추천 근거 표: 창 수요 · 안전재고 · 가용 · 입고예정 → 필요량 → MOQ · 포장 → 최종
                     설명 문장 (InsightBanner, explanation 그대로)
§5 승인 · 이력       Panel 안에 안내 문구 한 줄: "승인과 결정 이력은 STEP 13 에서 이 자리에 붙습니다." (Planned 컴포넌트는 쓰지 않습니다)
```

**3-3. `app/(admin)/admin/policies/service-level/page.tsx`** — `Planned` 교체 (+ actions.ts · state.ts · 폼)

- 상단 패널: 등급별 Service Level 표 (등급 · 서비스 수준 · Z · 적용 시작일) + 행 폼 "새 값 적용" → `core.service_level` 에 (grade, today) upsert. 액션은 `requireAdminOrThrow()` 후 supabase `.schema('core').from('service_level').upsert(...)` (RLS 가 관리자만 허용) + `writeAuditLog('SERVICE_LEVEL_SET')`
- 하단 패널: **품목 정책** 표 (품목 · 등급 · MOQ · 포장 단위 · 개별 서비스 수준 · 적용 Z(뷰) ) + 행 폼 → `core.item_policy` update + audit `ITEM_POLICY_SET`. 빈 입력은 null 로 저장 (0 으로 채우지 않음 — 6 번 SQL 주석 참조)
- revalidatePath: `/admin/policies/service-level` · `/admin/policies/safety-stock` · `/purchase-recommendation`

**3-4. `app/(admin)/admin/policies/safety-stock/page.tsx`** — `Planned` 교체

- 상단: 공통 정책값 편집 폼 (`core.policy_config` 의 SERVICE_LEVEL_DEFAULT · Z_VALUE_DEFAULT · REVIEW_PERIOD_DAYS · SAFETY_BUFFER_DAYS · DELIVERY_BUFFER_DAYS · EXCESS_STOCK_MONTHS) — key 별 숫자 입력 + 저장. 액션은 update + audit `POLICY_CONFIG_SET` (before/after 기록)
- 하단: `analytics.v_safety_stock` 표 (품목 · 등급 · SL · Z · L · σ_L · d · σ_d · 출처 · σ_DLT · **안전재고** · 사유) — 읽기 전용. KPI: 품목 수 · 백테스트 σ 사용 · in-sample σ 사용 · 산출 불가 (각 필터)

### 4. 테스트

- `lib/recommendation.test.ts`: 정규화 함수(뷰 행 → 타입)와 CSV 행 조립 함수(있다면)의 순수 함수 테스트. 계산은 없습니다.

### 5. 인터페이스 (다음 단계가 씁니다)

- `analytics.v_purchase_recommendation` 컬럼 이름 위 그대로 (STEP 11 · 13 · 15 · 16 · 19 가 읽음)
- `analytics.v_sku_detail` (STEP 13 이 승인 컬럼을 덧붙임, STEP 16 툴이 읽음)
- `analytics.v_safety_stock` (STEP 16 `getSafetyStock` 툴)
- `lib/recommendation.ts` 함수 이름 그대로
- SKU Detail 페이지의 §2 표와 §5 패널은 STEP 12 · 13 이 파일을 수정해 폼을 붙입니다. 섹션을 함수 컴포넌트로 나눠 두면(같은 파일 안에서) 붙이기 쉽습니다

## 완료 판정

- [ ] tsc · test · build 성공 · grep 검사 0건
- [ ] `sql/16` 을 처음부터 끝까지 다시 읽었다. `v_stockout_risk` 등 STEP 9 뷰의 실제 컬럼 이름을 `sql/15` 에서 확인하고 썼다
- [ ] MOQ · Pack 반영 수량이 뷰에서 나온다 · 발주 권고일이 나온다 · 확정수주가 예측보다 우선 적용된다(STEP 9 의 demand_qty 정의를 그대로 씀)
- [ ] 계산 불가가 숫자로 대체되지 않는다 (safety_stock · raw · final 이 null 이고 reason_code 가 있다)
- [ ] 정책값이 SQL 에 숫자로 박혀 있지 않다 (z_table 시드와 service_level 시드는 예외 — 데이터)
- [ ] 화면 4개(`/purchase-recommendation` · `/purchase-recommendation/[itemId]` · `/admin/policies/service-level` · `/admin/policies/safety-stock`) 빌드

## 보고서

`.superpowers/sdd/step/task-10-report.md` (공통규칙 §6). 파일 목록 정확히.
