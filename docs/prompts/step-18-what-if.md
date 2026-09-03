# STEP 18 구현 지시서 — What-If Simulation

> 먼저 `docs/prompts/_공통규칙.md`. STEP 9 · 10 의 전개/추천 공식, STEP 11 의 `components/chart/comparison-chart.tsx`, STEP 16 의 툴 레지스트리 · `runAgent` 를 전제로 합니다. 보고서 `task-09` · `task-10` · `task-11` · `task-16` 의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 18** 입니다. renew.prd 25장. 시나리오 7종을 Base 와 나란히 비교합니다. **실제 데이터를 바꾸지 않습니다** — 시뮬레이션 컨텍스트(함수 인자)에서만 계산합니다. 자연어 요청("A공급처 리드타임이 두 배가 되면?")을 파라미터로 바꿔 실행합니다.

읽을 PRD 장: **25(전체) · 19 · 21 · 22(공식 재사용)**.

## 만들 것

### 1. `sql/24-what-if.sql`

핵심은 **함수 하나**입니다. STEP 9·10 의 뷰는 현재 데이터 위의 고정 계산이므로, 같은 공식을 **파라미터를 받는 함수**로 다시 씁니다. 뷰 정의를 복사하지 말고, 공통 부분을 `core.fn_projection(p_item_id, p_params jsonb)` 로 뽑아 **STEP 9 의 뷰가 이 함수를 쓰도록 바꾸는 것이 이상적**이지만, 뷰 재작성 범위가 커집니다. → **이 단계에서는 함수를 별도로 두되, 공식이 sql/15 · sql/16 과 동일함을 주석에 줄 번호로 인용**합니다. 공식이 갈라지면 두 곳을 같이 고쳐야 한다는 경고도.

```
core.simulate_scenario(p_item_id text, p_params jsonb)
  returns table (period date, base_closing numeric, scenario_closing numeric, base_receipt numeric, scenario_receipt numeric,
                 base_demand numeric, scenario_demand numeric)
  + returns 를 두 개로 나누는 편이 명확합니다:
core.simulate_scenario_summary(p_item_id text, p_params jsonb)
  returns jsonb  { base: { stockout_date, safety_stock, order_qty, required_order_date, risk }, scenario: {…같은 키}, params_applied: {…}, data_snapshot_at }

p_params (renew.prd 25.1 의 7종 — 키 이름 고정):
  demand_pct            +20 / -20  (수요 ±%)
  lead_time_days        42 → 60   (절대값) 또는 lead_time_pct
  open_po_delay_days    20         (입고예정 ETA 를 미룸)
  service_level         0.90 → 0.95
  supplier_unavailable  true       (입고예정 제거 + 신규 발주 불가 → 결품일만)
  extra_order_qty · extra_order_period   대형 계약 추가 (그 기간 수요에 더함)
  promotion_pct · promotion_period       프로모션 (그 기간 수요 ×)
  모든 키 선택. 없는 키는 Base 와 같음. 알 수 없는 키는 무시하지 말고 params_applied.ignored 에 넣어 화면이 보여줍니다

  · 데이터를 읽기만 합니다 (select). insert/update/delete 없음 — 함수 본문에 `stable` 선언
  · Base 는 같은 함수를 빈 params 로 돌린 값 (뷰 값과 같아야 합니다 — 검증 select 를 파일 끝에: v_stockout_risk.stockout_date 와 simulate_scenario_summary(item, '{}') 의 base.stockout_date 비교)
  · 영업(is_sales) 은 호출 불가 (단가 · 리드타임 통계 노출)

core.what_if_log               누가 어떤 시나리오를 돌렸는지 (item_id · params · asked_by · at · natural_language text) — 감사·재현용. 결과는 저장하지 않음
```

### 2. `lib/what-if.ts`

`runWhatIf(itemId, params)` → `{ series, summary, error }` (rpc 두 번). `SCENARIO_PRESETS` 7종 (라벨 · 기본 params · 설명). `WhatIfParams` 타입과 `parseParams(unknown)` 검증(허용 키만, 숫자 범위).

### 3. 자연어 → 파라미터

`lib/agent/what-if-intent.ts`: `runAgent` 를 쓰지 않고 `lib/agent/llm.ts` 의 `chatCompletion` 을 **JSON 스키마 강제**로 1회 호출해 `{ item_id, params }` 를 뽑습니다. 품목명이 나오면 `core.v_item_master` 에서 찾아 item_id 로. 실패·미설정이면 `{ error }` — 화면은 수동 폼으로 대체. **LLM 은 파라미터만 만들고 숫자는 계산하지 않습니다.**

STEP 16 레지스트리의 `simulateScenario(params)` 툴을 활성화: `lib/what-if.runWhatIf` 호출 · numbers 에 base/scenario 요약값.

### 4. 화면 `app/(user)/what-if/page.tsx` — `Planned` 교체

- 상단: 품목 선택 칩 · 자연어 입력(선택, `what-if-nl-form.tsx`) · 시나리오 프리셋 칩 7개(누르면 폼 채움) · 파라미터 폼(`what-if-form.tsx`, 서버 액션 → 결과를 `?item=&p=<base64 json>` 로 URL 에 두고 서버 컴포넌트가 rpc 조회 — 결과가 URL 에 있으니 공유·뒤로가기 가능, 클라이언트 state 최소)
- 결과: `grid-2` — 왼쪽 Base · 오른쪽 시나리오 KPI 4장씩(결품 예상일 · 안전재고 · 발주 수량 · 발주 권고일) + 판정 배지. 차이는 delta 로
- 차트: `ComparisonChart` (Base 실선 vs 시나리오, 0선)
- 표: 기간별 기초/입고/수요/기말 두 열 세트
- 하단 문구: "실제 데이터는 바뀌지 않습니다. 시나리오는 저장되지 않으며 URL 로 공유할 수 있습니다."
- `params_applied.ignored` 가 있으면 경고 줄

### 5. 테스트

`lib/what-if.test.ts`: `parseParams` 허용 키 · 범위 · 무시 키 수집 · 프리셋 7종. use-server 테스트.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] `sql/24` 의 함수가 `stable` 이고 본문에 insert/update/delete 가 없다 (what_if_log 기록은 앱 액션이 별도 insert)
- [ ] 빈 params 의 Base 결과가 뷰 값과 같도록 검증 select 가 있다
- [ ] 자연어 변환 실패 시 수동 폼으로 동작한다
- [ ] 7종 프리셋이 모두 params 로 표현된다

## 보고서

`.superpowers/sdd/step/task-18-report.md`. 메뉴 `/what-if` ready.
