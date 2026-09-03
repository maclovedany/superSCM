# STEP 17 구현 지시서 — 영업 SCM Agent + ATP + Soft Allocation

> 먼저 `docs/prompts/_공통규칙.md`. STEP 16 의 `lib/agent/tools.ts` 레지스트리와 `runAgent`, STEP 9 의 `v_inventory_projection` · `v_consensus_forecast`, STEP 10 의 `v_safety_stock` 을 전제로 합니다. `task-16-report.md` 의 인터페이스 절을 꼭 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 17** 입니다. renew.prd 27장. 영업팀이 "X700 지금 500대 추가 주문 받을 수 있어?" 라고 물으면 ATP(Available to Promise) 관점에서 답합니다. 가예약(Soft Allocation)이 ATP 에서 차감되어 이중 약속을 막습니다. 영업은 단가·공급처 상세·리드타임 통계·예측 정확도를 볼 수 없습니다 — **서버에서 필드 단위 차단**.

읽을 PRD 장: **27(전체) · 4.5(정보 접근 범위) · 28.3(영업용 화면)**.

## Role 에 대해

현재 Role 은 ADMIN · USER 두 가지뿐입니다 (renew.prd 4.1 "향후 확장"). 영업 구분은 `core.app_user.department` 로 합니다: **department 가 '영업' 으로 시작하거나 'SALES' 를 포함하면 영업 사용자**로 봅니다. 판정 함수는 `lib/auth.ts` 에 `isSalesUser(user)` 하나로 두고, SQL 에는 `core.is_sales()` 를 둡니다 (같은 규칙). 이 규칙을 파일 주석과 보고서에 명시합니다.

## 만들 것

### 1. `sql/23-atp-sales.sql`

```
core.is_sales()                    security definer · app_user.department 규칙

core.policy_config 시드 추가        ATP_PROTECT_SAFETY_STOCK 1 (1=안전재고 보호 · 0=미보호)

analytics.v_atp                     품목 × 4구간 (renew.prd 27.3)
  item_id · item_name · bucket('NOW'|'2W'|'1M'|'BEYOND') · bucket_until date ·
  available_now(현재고) · confirmed_incoming(구간까지 입고예정, v_inbound_qty.earliest_eta 기준) ·
  committed_demand(구간까지 확정 수주) · soft_allocation(RESERVED · valid_until >= today) ·
  protected_safety_stock(정책 1이면 v_safety_stock.safety_stock, 아니면 0) ·
  atp_qty = greatest(0, available_now + confirmed_incoming − committed_demand − soft_allocation − protected_safety_stock) ·
  lead_time · lead_time_confidence · delivery_buffer_days(DELIVERY_BUFFER_DAYS) ·
  data_snapshot_at · reason(NO_INVENTORY_DATA 등)
  BEYOND 구간: 신규 발주 시 lead_time + buffer 뒤 → atp 는 '발주 시 확보 가능' 을 뜻하므로 atp_qty 는 null 로 두고 earliest_new_supply_date 컬럼에 날짜만

core.check_order_feasibility(p_item_id text, p_qty numeric, p_target_date date)
  returns jsonb  (renew.prd 27.5 의 키 그대로: status · feasible · available_qty · requested_qty · projected_inventory_after_order ·
                  safety_stock · risk · earliest_safe_date · lead_time_used · lead_time_confidence · data_snapshot_at · reason)
  · target_date 까지의 구간을 v_atp 에서 고르고, 그 구간의 atp_qty 와 요청량 비교
  · AVAILABLE(atp >= qty 이고 이후 전개가 음수로 안 감) · CONDITIONALLY_AVAILABLE(일부 가능 또는 납기 조정 시 가능 — earliest_safe_date 제시) · UNAVAILABLE · UNKNOWN(reason)
  · earliest_safe_date = 그 수량이 확보되는 가장 이른 날 + DELIVERY_BUFFER_DAYS (P80 은 5회 중 1회 지연 — 주석)
  · 이 함수는 데이터를 바꾸지 않습니다

core.create_soft_allocation(p_item_id, p_qty, p_valid_days int default null, p_customer text default null)
  returns table (ok boolean, allocation_id bigint, valid_until date, message text)
  · auth.uid() 필요. valid_days 없으면 SOFT_ALLOCATION_DAYS
  · 현재 ATP(NOW 구간)보다 많으면 거부 ("가용 {atp} 를 초과")
  · insert RESERVED
core.confirm_soft_allocation(p_allocation_id)   본인/관리자 · RESERVED → CONFIRMED
core.release_soft_allocation(p_allocation_id)   본인/관리자 · → RELEASED · released_at
core.release_expired_allocations()              RESERVED 이고 valid_until < current_date → RELEASED. STEP 14 의 scan_alerts 가 시작할 때 이 함수를 부르도록 sql/20 의 scan_alerts 를 여기서 `create or replace` 로 갱신하지 말고 — **`app/api/cron/scan-alerts/route.ts` 가 scan 전에 rpc 로 이 함수를 부르게** 합니다 (anon 실행 허용 + 인자 없음 + 부작용은 만료 해제뿐)

core.sales_inquiry               renew.prd 27.7
  inquiry_id bigserial · asked_by · asked_email · asked_at · item_id · requested_qty · requested_date · question text ·
  answer_status('AVAILABLE'|…) · answer jsonb · soft_allocation_id · converted_to_order boolean default false
analytics.v_sales_inquiry        + item_name · 본인 것만 보이도록 RLS (관리자 전부)
analytics.v_sales_inquiry_stats  품목별 최근 30일 문의 수 · UNAVAILABLE 수 · 전환율 (STEP 14 INQUIRY_SPIKE 룰이 이제 이 테이블을 봅니다 — sql/20 의 to_regclass 분기가 살아납니다)
analytics.v_soft_allocation      + item_name · 남은 일수 · 본인/관리자
analytics.v_sales_supply_status  품목별 수급 상태 (renew.prd 28.3): item_id · item_name · status('안전'|'주의'|'불가' ← v_stockout_risk 의 SAFE/WARNING/CRITICAL 을 영업 표현으로) · atp_now · atp_2w · atp_1m · earliest_new_supply_date
                                 ★ 단가 · 공급처 상세 · 리드타임 통계 · 정확도 컬럼 없음
analytics.v_sales_promise_risk   확정 수주 중 납기 전 재고 확보 불가 건
```

### 2. `lib/atp.ts` · `lib/auth.ts` 보강

`getAtp(itemId)` · `checkOrderFeasibility(itemId, qty, date)` · `createSoftAllocation` · `confirmSoftAllocation` · `releaseSoftAllocation` · `getSoftAllocations()` · `getSalesInquiries()` · `getSalesSupplyStatus()` · `getSalesPromiseRisk()` · `recordSalesInquiry(...)`.
`lib/auth.ts` 에 `isSalesUser(user)`.

**필드 차단** (renew.prd 4.5): `lib/atp.ts` 의 함수는 영업 사용자에게는 단가 · 공급처 · 리드타임 통계 · 정확도 필드를 **애초에 select 하지 않거나 응답 객체에서 제거**합니다. `stripForSales(obj, user)` 유틸을 `lib/agent/redact.ts` 에 두고 STEP 16 의 orchestrator 가 **모든 툴 결과**에 적용하도록 연결합니다 (영업 사용자가 SCM 툴을 못 부르더라도 이중 방어).

### 3. 영업 툴 6종 — `lib/agent/tools-sales.ts` 를 STEP 16 레지스트리에 추가

```
checkOrderFeasibility(itemId, qty, targetDate) · getATP(itemId, targetDate?) · getEarliestDelivery(itemId, qty) ·
getAlternativeItems(itemId)  ← raw.item_substitute 를 core 뷰(core.v_item_substitute)로 · createSoftAllocation(itemId, qty, validDays?) · getSupplyStatus(itemId)
roles: ['ADMIN','USER'] 이지만 orchestrator 가 isSalesUser 면 SCM 툴 집합 대신 이 6종만 노출. 관리자·SCM 은 16종 전부.
createSoftAllocation 툴은 실제로 예약을 만듭니다 → 답변에 "가예약 {id} · {valid_until} 까지" 를 반드시 포함하도록 툴 결과 numbers 에 넣고, 시스템 프롬프트에 "예약을 만들었으면 반드시 알린다".
문의 이력: 영업 툴이 불릴 때마다 `core.sales_inquiry` 에 기록 (orchestrator 의 툴 호출 hook 또는 툴 run 안에서).
```

시스템 프롬프트에 영업용 분기 추가: renew.prd 27.5 응답 예시 문체(즉시 출하 가능 수량 · 입고 예정 충당 · 신뢰도와 여유일 안내).

### 4. 화면

- `app/(user)/sales/page.tsx` (신규 — renew.prd 28.3 영업용 대시보드. 메뉴: 컨트롤러가 USER 메뉴 지원 절에 `/sales` '영업 수급 조회' 로 등록): KPI(내 문의 · 가예약 · 만료 임박 · 납기 위험 수주) · 품목별 수급 상태 표(안전/주의/불가 배지 · ATP 즉시/2주/1개월 · 신규 발주 시) · 내 가예약 표([확정] [해제] 폼) · 납기 위험 수주 표 · 빠른 확인 폼(품목 · 수량 · 납기 → `check_order_feasibility` 결과 카드 + [가예약] 버튼)
- `/agent` 화면: 영업 사용자면 예시 질문 칩을 renew.prd 27.2 로 바꿉니다.

### 5. 테스트

- `lib/agent/redact.test.ts`: 영업 사용자에게 unit_price · supplier_name · p80_days · wape 등이 제거되고 SCM 사용자에게는 남는다.
- `lib/atp.test.ts`: 정규화 · status 4종 매핑.
- `lib/agent/tools.test.ts` 확장: 영업 툴 6종 등록 · 영업 사용자 툴 집합 = 6종.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] ATP 응답에 status 4종 중 하나가 포함된다
- [ ] 가예약 후 같은 품목 ATP 가 그만큼 줄어든다 (뷰 정의로 확인 — soft_allocation 차감)
- [ ] 영업 role 로 단가 필드가 툴 응답·화면 어디에도 없다 (redact 테스트 + v_sales_* 뷰 컬럼)
- [ ] 만료 해제가 cron 경로에 연결되었다

## 보고서

`.superpowers/sdd/step/task-17-report.md`.
