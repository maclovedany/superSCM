# STEP 13 구현 지시서 — Approval Workflow + 근거 Snapshot + Decision History

> 먼저 `docs/prompts/_공통규칙.md`. STEP 10 의 `analytics.v_purchase_recommendation` · `analytics.v_sku_detail` · SKU Detail 페이지, STEP 12 의 Override 폼 패턴을 전제로 합니다. 보고서 `task-10-report.md` · `task-12-report.md` 의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 13** 입니다. `추천 확인 → 필요시 수정 → 사유 입력 → 승인`. 승인 시점의 계산 근거 전체를 Snapshot 으로 함께 저장해, 나중에 데이터가 바뀌어도 "그때 무엇을 보고 결정했는지" 를 재현합니다.

읽을 PRD 장: **23(Approval) · 31.2(추적성) · 32(추천과 승인 분리)**.

## 만들 것

### 1. `sql/19-approval.sql`

```
core.approval
  approval_id bigserial PK ·
  item_id · recommendation_run_id(=forecast run_id) ·
  recommended_qty numeric · approved_qty numeric · adjustment numeric(= approved − recommended) ·
  decision text check in ('APPROVED','REJECTED','DEFERRED') ·
  reason_code text check in ('AS_RECOMMENDED','BUDGET','SUPPLIER_CAPACITY','LEAD_TIME','DEMAND_INFO','DATA_ERROR','OTHER') ·
  reason_text text ·
  snapshot jsonb not null      ★ 아래 구조
  approved_by uuid · approved_email text · approved_at timestamptz default now() ·
  status text default 'ACTIVE' check in ('ACTIVE','SUPERSEDED')   (같은 품목의 새 결정이 오면 이전 행 SUPERSEDED)

snapshot jsonb (renew.prd 23.2 — 전부 저장. 뷰 한 행을 jsonb 로 통째로 담습니다)
  {
    recommendation: <analytics.v_purchase_recommendation 의 그 품목 행 전체 (to_jsonb)>,
    sku_detail:     <analytics.v_sku_detail 행>,
    projection:     <analytics.v_inventory_projection 의 그 품목 행 배열>,
    consensus:      <analytics.v_consensus_forecast 의 그 품목 행 배열>,
    safety_stock:   <analytics.v_safety_stock 행>,
    leadtime:       <analytics.v_leadtime_policy 의 그 공급처 행>,
    champion:       <analytics.v_champion_model 행>,
    run_id, model_version, data_snapshot_at, captured_at
  }

core.approve_recommendation(p_item_id text, p_approved_qty numeric, p_decision text, p_reason_code text, p_reason_text text)
  returns table (ok boolean, approval_id bigint, message text) · security definer
  · auth.uid() null 이면 거부. USER 도 승인 가능 (renew.prd 4.3 "Approval")
  · 추천 행이 없으면 거부. 수량이 추천과 다른데 reason_code 가 'AS_RECOMMENDED' 면 거부. 'OTHER' 는 텍스트 필수
  · REJECTED/DEFERRED 는 approved_qty = 0 허용
  · 위 snapshot 을 함수 안에서 조립 (뷰를 to_jsonb 로)
  · 같은 item 의 ACTIVE 행을 SUPERSEDED 로

analytics.v_approval                 core.approval + item_name + supplier_id (snapshot 은 제외 — 무겁습니다)
analytics.v_approval_snapshot        approval_id · snapshot (재조회 전용)
analytics.v_decision_history         승인 + Override(analytics.v_forecast_override) + Champion 수동지정(core.champion_model MANUAL) + 리드타임 변경(leadtime_plan_history) 을
                                     UNION 한 통합 결정 이력: kind · item_id · item_name · actor_email · at · summary(한국어 한 줄) · ref_id
analytics.v_approval_kpi             n_active · n_approved · n_rejected · n_deferred · n_adjusted(adjustment<>0) · pending(=발주 필요인데 ACTIVE 승인 없음) · this_month
```

`analytics.v_sku_detail` 에 승인 컬럼을 덧붙입니다: `last_decision · last_approved_qty · last_approved_at · last_approved_email · has_active_approval`. (`create or replace view` 로 끝에 컬럼 추가. STEP 10 이 만든 정의를 `sql/16` 에서 복사해 컬럼만 더하지 말고 — **`sql/16` 의 v_sku_detail 정의를 그대로 두고, `sql/19` 에서 `analytics.v_sku_detail` 을 다시 `create or replace` 하되 `select d.*, a.… from analytics.v_sku_detail d left join …` 처럼 자기 자신을 참조할 수는 없으므로**, `sql/16` 의 정의 본문을 옮겨 오고 `sql/16` 쪽에는 "v_sku_detail 최종 정의는 sql/19 에 있음" 주석을 남깁니다. 이 정도의 중복은 허용.)

권한: `core.approval` 읽기 authenticated · insert 는 함수만(security definer) — 테이블에 직접 insert 정책은 만들지 않습니다. update 는 관리자.

### 2. `lib/approval.ts`

`getApprovals(itemId?)` · `getApprovalSnapshot(approvalId)` · `getDecisionHistory(limit=200)` · `getApprovalKpi()` · `DECISION_LABEL` · `APPROVAL_REASON_CODES`(7종 한국어 라벨).

### 3. 화면

**3-1. SKU Detail §5** (`app/(user)/purchase-recommendation/[itemId]/page.tsx`) — STEP 10 이 남긴 안내 문구를 실제 폼으로 교체
- 현재 ACTIVE 결정 요약(있으면) + `approval-form.tsx`: 승인 수량(기본값 = 추천 수량) · 결정(승인/반려/보류) · 사유 코드 · 사유 텍스트 · [발주 승인] (Primary 버튼은 이 화면에 하나 — §2 Override 폼의 버튼은 secondary 여야 합니다. STEP 12 가 primary 를 썼다면 secondary 로 바꿉니다)
- 이 품목의 결정 이력 표 (승인 · Override · Champion · 리드타임 통합, `v_decision_history` where item)
- 액션 `approveRecommendation` (`requireUser()` → rpc → `writeAuditLog('RECOMMENDATION_APPROVED')` → revalidate)

**3-2. `app/(user)/decision-history/page.tsx`** — `Planned` 교체
- KPI: 전체 결정 · 승인 · 수정 승인(adjustment≠0) · 반려/보류 · **승인 대기**(발주 필요인데 ACTIVE 승인 없음) — 각 필터 (승인 대기 카드는 목록이 v_decision_history 가 아니라 추천 목록이므로, 누르면 `/purchase-recommendation?filter=pending` 으로 가는 링크 카드로 만들지 말고 — `filter` 없이 foot 에 "발주 추천 화면에서 확인" 을 적습니다)
- 표: 시각 · 종류 배지(승인/보정/Champion/리드타임) · 품목 · 요약 · 담당자 · [근거 보기](승인 행만 → `/decision-history/[approvalId]`)
- `app/(user)/decision-history/[approvalId]/page.tsx`: Snapshot 재현 화면. 승인 시점의 추천 근거(recommendation · safety_stock · leadtime · champion)를 STEP 10 SKU Detail §4 와 같은 표 형식으로, 상단에 "이 화면은 {approved_at} 시점의 근거입니다. 현재 값과 다를 수 있습니다" 배너(`.stale-banner` 재사용 아님 — InsightBanner eyebrow "SNAPSHOT"). 전개 표(projection 배열)도.

**3-3. `app/(user)/purchase-recommendation/page.tsx`** — 컬럼 "승인" 추가: ACTIVE 결정 배지(승인 n개 / 반려 / 보류 / 미결정) + KPI "승인 대기" 필터 추가 (`v_purchase_recommendation` 에 `approval_status · approved_qty` 컬럼을 `sql/19` 에서 덧붙입니다 — v_sku_detail 과 같은 방식으로 정의를 옮깁니다. 아니면 `analytics.v_purchase_recommendation_with_approval` 새 뷰를 만들어 화면만 그 뷰를 읽게 해도 됩니다. **후자를 권합니다** — 기존 뷰를 옮기지 않아도 되고 STEP 16·19 가 읽는 이름이 안 바뀝니다.)

### 4. 테스트

`lib/approval.test.ts` 라벨 · 정규화. use-server 테스트 통과.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] 승인 시 Snapshot 이 저장되고 `/decision-history/[id]` 에서 재조회된다
- [ ] 수량을 바꾸면 사유가 필수다 · AI 추천값(recommended_qty)이 그대로 보존된다
- [ ] Primary 버튼이 SKU Detail 에 하나뿐이다
- [ ] `core.approval` 에 직접 insert 하는 앱 코드가 없다 (rpc 만)

## 보고서

`.superpowers/sdd/step/task-13-report.md`. 메뉴: `/decision-history` ready.
