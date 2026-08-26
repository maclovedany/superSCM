# 4회차 Supabase 구조

> Codex 에게 기능을 시킬 때 이 파일을 먼저 읽으라고 하세요.
> 이 문서가 없으면 Codex 는 존재하지 않는 테이블과 컬럼을 지어냅니다.

## 스키마 역할

| 스키마 | 역할 |
|---|---|
| `raw` | CSV 원본. 적재 후 수정하지 않습니다 |
| `core` | 공급처 표기 매핑과 수업 중 확정하는 기준 |
| `analytics` | 화면과 AI 가 조회하는 뷰 |

**화면 코드에서 `raw` 를 직접 조회하지 마세요.** 정제 규칙이 화면마다 흩어지면 같은 지표가 화면마다 다른 숫자로 나옵니다.

## 수업 전 확인 건수

| 대상 | 기대값 |
|---|---:|
| `raw.shipment_log` | 2,864 |
| `raw.usage_history` | 7,038 |
| `raw.inventory` | 43 |
| `raw.item_master` | 23 |
| `raw.supplier_master` | 13 |
| `raw.purchase_order` | 92 |
| `raw.goods_receipt` | 81 |
| `core.supplier_alias` | 36 |
| `core.leadtime_plan` | **0** |
| `core.usage_profile` | **0** |
| `analytics.v_stockout_risk` | 20 |

`core.leadtime_plan` 과 `core.usage_profile` 은 오전 분석 후 참가자와 확정합니다. 수업 전에는 비어 있어야 합니다.

---

## analytics — 화면이 조회하는 뷰

### `v_leadtime_gap`
공급처별 마스터 리드타임과 실제 P80 비교. 12행.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| supplier_id | text | SUP001 ~ SUP013 |
| supplier_name | text | Fujifilm BI Japan 등 |
| country | text | Japan, China, India … |
| std_lead_time | int | 마스터 표준 리드타임(일) |
| n_samples | int | 실적 표본 수 |
| avg_order_to_ship | numeric | 발주 → 현지 출고 평균(일) |
| avg_ship_to_receive | numeric | 출고 → 검수완료 평균(일) |
| mean_days | numeric | 전체 평균(일) |
| p50_days / p80_days / p90_days | int | 분위수 |
| std_days | numeric | 표준편차 |
| gap_days | int | p80_days − std_lead_time. 양수면 실제가 더 김 |
| confidence | text | HIGH / MEDIUM / LOW (표본 수 기준) |

### `v_stockout_risk`
재고 소진 위험. 20행. **오후 실습의 검증 정답지입니다.**

| 컬럼 | 타입 | 설명 |
|---|---|---|
| item_id | text | ITEM001 ~ ITEM020 |
| item_name | text | 품목명 |
| supplier_id | text | 생산법인 |
| current_stock | numeric | 현재고 (창고 합산) |
| inbound_qty | numeric | 입고예정 (진행 중 선적) |
| available_qty | numeric | current_stock + inbound_qty |
| daily_usage_avg | numeric | 일평균 사용량 (없으면 null) |
| cv | numeric | 변동계수 |
| planned_lead_time | int | 적용 중인 계획 리드타임 |
| stockout_days | numeric | available_qty ÷ daily_usage_avg (계산 불가 시 null) |
| stockout_date | date | 소진 예상일 |
| risk_status | text | SAFE / CRITICAL / UNKNOWN |
| reason | text | NO_USAGE / NO_LEADTIME (정상이면 null) |

### `v_stockout_kpi`
요약 한 줄.
`n_items`, `n_critical`, `n_safe`, `n_unknown`, `n_within_30d`, `avg_stockout_days`

### `v_usage_profile`
자재별 사용 프로파일. 19행.
`item_id`, `item_name`, `item_type`, `supplier_id`, `valid_days`,
`daily_usage_avg`, `daily_usage_sd`, `cv`, `stability`, `source`

### `v_usage_anomaly`
이상 사용 이력. 39행.
`usage_id`, `item_id`, `use_date`, `qty`, `avg_qty`, `ratio`, `note`,
`anomaly_type` (RETURN / PROJECT / UNEXPLAINED)

---

## core — 정제와 계산

### `leadtime_plan` (테이블 · 쓰기 가능)
오전 분석에서 확정한 계획 리드타임.
`supplier_id`(PK), `planned_lead_time`, `basis`, `service_level`, `confirmed_reason`, `confirmed_at`

**이 값을 바꾸면 `v_stockout_risk` 의 판정이 즉시 달라집니다.** 화면 코드는 한 줄도 고치지 않습니다.

### `usage_profile` (테이블 · 쓰기 가능)
오전 분석에서 확정한 일평균 사용량.
`item_id`(PK), `valid_days`, `daily_usage_avg`, `daily_usage_sd`, `cv`, `confirmed_at`

### 그 밖의 core 뷰

```
v_fact_shipment          정제 + 구간 일수 + 품질 판정
v_shipment_valid         분석 가능한 완료 건만
v_leadtime_stat          공급처별 분위수
v_leadtime_effective     확정값 → 없으면 실적 P80
v_usage_effective        확정값 → 없으면 정제 기준 평균
v_item_master            품목코드 정규화 · 중복 제거
v_stock_on_hand          창고 표기 통일 후 현재고 합산
v_inbound_qty            진행 중 선적 = 입고예정
```

---

## raw — 원본 (직접 조회하지 않음)

| 테이블 | 행수 | 비고 |
|---|---|---|
| shipment_log | 2,864 | 타임스탬프 7개. 진행 중 117건 포함 |
| usage_history | 7,038 | 영업일 385일. 음수(반품) 16건 포함 |
| supplier_master | 13 | 법인 12곳 + 중복 등록 1건 |
| item_master | 23 | 품목 20개 + 표기 오염 2 + 단종 1 |
| purchase_order | 92 | 공급업체 표기 25종 |
| goods_receipt | 81 | |
| inventory | 43 | 창고 표기 흔들림 있음 |

`shipment_log` 타임스탬프 순서:

```
order_date → supplier_ship_date → port_departure_date → port_arrival_date
→ customs_clear_date → warehouse_receipt_date → qc_release_date
```

**리드타임의 끝점은 `qc_release_date`** 입니다. 창고에 도착해도 검수 전이면 쓸 수 없습니다.

---

## 접속 방법

```ts
import { createSupabaseServerClient } from '@/lib/supabase';

const supabase = await createSupabaseServerClient();
const { data, error } = await supabase
  .schema('analytics')
  .from('v_stockout_risk')
  .select('*');
```

`public` 스키마가 아니므로 `.schema()` 를 반드시 거쳐야 합니다.

**Supabase 대시보드에서 스키마 노출 설정이 되어 있어야 합니다.**

```
Project Settings → API → Data API → Exposed schemas
    public, core, analytics
```

이 설정이 없으면 조회 결과가 **에러 없이 빈 배열**로 나옵니다.

조회 함수는 `lib/scm.ts` 에 모읍니다. 화면에서 supabase 를 직접 부르지 않습니다.
