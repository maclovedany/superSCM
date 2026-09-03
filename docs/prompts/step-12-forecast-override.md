# STEP 12 구현 지시서 — Forecast Override · Consensus · Forecast Value Add

> 먼저 `docs/prompts/_공통규칙.md`. STEP 9 가 만든 `core.forecast_override` 테이블과 `core.v_consensus_forecast`, STEP 10 이 만든 SKU Detail(`app/(user)/purchase-recommendation/[itemId]/page.tsx`) 을 전제로 합니다. 두 보고서(`.superpowers/sdd/step/task-09-report.md` · `task-10-report.md`)의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 12** 입니다. 담당자가 AI 예측을 **수정하지 않고** 별도 Override 를 입력하면 Consensus 가 만들어지고, 그 Consensus 가 재고전개·발주 계산에 들어갑니다(STEP 9·10 이 이미 `v_consensus_forecast` 를 읽습니다). 실적이 확정되면 AI 와 Consensus 중 누가 더 맞았는지(Forecast Value Add)를 봅니다.

읽을 PRD 장: **17(Forecast Override 전체)**.

## 만들 것

### 1. `sql/18-forecast-override.sql`

머리말: "sql/16 까지 먼저 실행".

```
core.set_forecast_override(p_item_id text, p_period date, p_override_qty numeric, p_reason_code text, p_reason_text text)
  returns table (ok boolean, message text) · security definer
  · auth.uid() 가 null 이면 거부 (로그인 사용자 누구나 가능 — renew.prd 4.3)
  · reason_code 가 8종 밖이면 거부 · 'OTHER' 인데 reason_text 가 비면 거부
  · core.v_ai_forecast 에 (item, period) 가 없으면 거부 ("이 기간의 AI 예측이 없습니다")
  · 같은 (item, period) 의 유효 행(superseded_at is null)이 있으면 superseded_at = now()
  · 새 행 insert: ai_forecast = v_ai_forecast.predicted_qty · override_qty · consensus_forecast = ai + override · run_id ·
    created_by = auth.uid() · created_email
  · consensus 가 음수가 되면 거부

core.clear_forecast_override(p_item_id text, p_period date)
  유효 행의 superseded_at 을 채웁니다. 본인 또는 관리자만.

analytics.v_forecast_override         유효·이력 전부. item_name · model_id · is_active(superseded_at is null) · created_email
analytics.v_consensus_forecast        core.v_consensus_forecast + item_name + reason_code(유효 Override 의) — STEP 10 이 이미 만들었으면 그대로 두고 여기서 만들지 않습니다
analytics.v_forecast_value_add        renew.prd 17.3
  Override 가 있었던 (item, period) 중 실적(core.v_test_actual 또는 raw 실적을 core 뷰로)이 확정된 기간만:
  item_id · item_name · period · actual · ai_forecast · consensus_forecast · ai_abs_error · consensus_abs_error ·
  improved boolean(consensus 오차 < ai 오차) · reason_code
  ★ 어느 Override 를 쓸지: 그 기간에 대해 가장 마지막에 유효했던 행 (superseded 된 것도 포함해 created_at 최대)
analytics.v_forecast_value_add_summary
  전체 1행: n_periods · ai_wape · consensus_wape · n_improved · n_worsened
analytics.v_forecast_value_add_by_reason
  reason_code 별: n · ai_wape · consensus_wape · improvement_pct
analytics.v_override_excess          품목별 유효 Override 수와 최근 90일 Override 횟수 (STEP 14 의 Excessive Override 룰이 읽습니다)
  item_id · n_active · n_recent_90d
```

권한: 함수 `grant execute to authenticated`, `revoke from public, anon`. 뷰 `grant select to authenticated`.

### 2. `lib/override.ts` (신규)

```
getOverrides(itemId?)             analytics.v_forecast_override · created_at desc · limit 200
getConsensus(itemId)              analytics.v_consensus_forecast · period 순
getValueAdd()                     rows + summary + byReason 세 조회 함수
REASON_CODES                      8종 코드 → 한국어 라벨 (renew.prd 17.2 그대로: 신규 계약 · 프로모션 · 신제품 출시 · 단종 · 프로젝트성 수요 · 시장 변화 · 데이터 오류 보정 · 기타)
```

### 3. 화면

**3-1. SKU Detail §2 에 Override 폼 붙이기** — `app/(user)/purchase-recommendation/[itemId]/page.tsx` 의 Consensus 표 각 행에 클라이언트 폼 `override-row-form.tsx`(같은 폴더): 증감 수량 입력 · 사유 코드 select · 사유 텍스트(OTHER 면 필수, `required` 를 클라이언트에서 토글) · 저장 · (유효 Override 가 있으면) 해제 버튼. 액션 `actions.ts`: `setOverride` · `clearOverride` — `requireUser()` → rpc → `writeAuditLog('FORECAST_OVERRIDE_SET' / 'FORECAST_OVERRIDE_CLEAR')` → revalidatePath(`/purchase-recommendation/[itemId]` · `/purchase-recommendation` · `/inventory-projection` · `/forecast-override`). `state.ts` 분리 (error.md #10).

**3-2. `app/(user)/forecast-override/page.tsx`** (신규 화면. 메뉴 등록은 컨트롤러가 함 — 보고서에 "USER 메뉴 예측 절 · `/forecast-override` · 라벨 '예측 보정'" 이라고 적으세요)

- KPI: 유효 Override(품목 수) · 이번 달 입력 · 해제됨 · **Value Add 개선률**(필터 없음)
- 표: 품목 · 기간 · AI · 증감 · Consensus · 사유 · 입력자 · 시각 · 상태(유효/대체됨)
- 패널 "Forecast Value Add": summary 한 줄(AI WAPE vs Consensus WAPE) + reason_code 별 표 + 기간별 표. 실적이 없어 비교 불가면 EmptyState("실적이 확정된 기간이 아직 없습니다").
- InsightBanner: "특정 품목에서 보정이 반복되면 모델 개선 신호" — `v_override_excess` 상위 3개 품목

### 4. 테스트

- `lib/override.test.ts`: REASON_CODES 8종 · 정규화 함수.
- `lib/use-server-exports.test.ts` 가 새 actions.ts 를 통과해야 합니다.

### 5. 인터페이스 (다음 단계가 씁니다)

- `analytics.v_override_excess` (STEP 14 Excessive Override 룰)
- `analytics.v_forecast_value_add_summary` (STEP 15 대시보드)

## 완료 판정

- [ ] tsc · test · build · grep 0건
- [ ] AI 원본 보존: `core.forecast_result` 를 update/delete 하는 코드가 없다
- [ ] reason_code 가 코드로 저장되고 OTHER 는 텍스트 필수
- [ ] Consensus 가 `v_stockout_risk` · `v_purchase_recommendation` 에 반영된다 (STEP 9·10 이 `v_consensus_forecast` 를 읽는지 sql/15·16 에서 확인하고 보고서에 근거 줄 번호를 적는다)

## 보고서

`.superpowers/sdd/step/task-12-report.md`.
