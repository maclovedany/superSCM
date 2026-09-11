# Stage 1 업무 운영 전환 Implementation Plan

> **실행 시 필수 하위 규칙:** 이 계획을 구현할 때는 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans`를 사용하고, 각 작업의 검증 관문을 통과한 뒤 다음 작업으로 이동한다.

**목표:** 현재의 인증·적재·분석·Forecast 기반을 유지하면서, `stage1.md`에서 확정한 수요 취합, 재고 배정, 승인, 최종 발주량 및 발주 시점 확정 업무를 실제 운영 가능한 구조로 연결한다.

**구조:** 원본은 `raw`, 업무 상태와 트랜잭션은 `core`, 화면 조회와 계산 결과는 `analytics`에 둔다. 화면과 AI Agent는 같은 조회 함수를 사용하며 `analytics`만 읽는다. 재고 배정, 승인, 발주 확정처럼 동시성과 권한이 중요한 변경은 Server Action이 직접 계산하지 않고 권한 검사를 거쳐 데이터베이스 함수 한 번으로 처리한다.

**기술:** Next.js 15 App Router, React 19, TypeScript, Supabase PostgreSQL/RLS, 순수 CSS, `node:test`, Vercel Cron, Resend REST 이메일 발송 어댑터.

**기준 문서:** `AGENTS.md`, `SCHEMA.md`, `stage1.md`, `gap.md`, `향후논의사항.md`

**전역 제약:**

- 운영 해외법인은 일본·중국·베트남·싱가포르·네덜란드 5곳이다. 과거 공급처는 삭제하지 않고 활성 여부와 적용 기간으로 관리한다.
- Supabase SQL은 저장소에 마이그레이션으로 작성하고, 실제 Supabase 적용은 사용자가 직접 수행한다. 각 단계에는 적용 후 확인 쿼리를 포함한다.
- 화면 컴포넌트에서 Forecast, DoS, 가용재고, 발주량, 배정 우선순위를 계산하지 않는다.
- 계산 불가는 `null + reason_code`로 보존하고 화면에서는 `EmptyValue`를 사용한다. MOQ 미설정만 업무 합의에 따라 1을 적용한다.
- Tailwind, styled-components, CSS Modules, 화면 내 hex 색상, 신규 차트 라이브러리를 추가하지 않는다.
- `raw.item_substitute`와 실시간 전산·실재 재고 대사 기능은 `향후논의사항.md` 범위이므로 이번 리팩터링에 연결하지 않는다.
- 기존 Forecast, Backtest, Champion 결과는 삭제하거나 덮어쓰지 않는다.

---

## 1. 현재 기준 상태

### 이미 구축되어 유지할 기반

- STEP 1: 공통 디자인 시스템과 공통 UI 컴포넌트
- STEP 2: 로그인, ADMIN/USER, 서버 인증, RLS, `core.audit_log`
- STEP 3~7: 학습·검증 격리, 데이터 적재, Demand Profile, SQL Forecast, Backtest, Champion
- STEP 16: AI Agent 대화 및 검증된 조회 함수 재사용 구조
- STEP 18: 해외법인·공급처·출항 규칙·영업일 달력·품목 정책의 조회 기반
- STEP 19: 부서·직책·업무 권한 코드와 `core.has_permission()`
- 실제 데이터 정의 보관: `supabase/realdata/`, `supabase/schema-dump/2026-09-11.sql`

### 현재 구현됐지만 보완해야 하는 부분

| 영역 | 현재 상태 | 남은 작업 |
|---|---|---|
| 해외법인·공급처 | 5개 법인과 조회 화면 존재 | 관리자 편집, 실제 준비기간·출항 규칙 입력, 이력 |
| 품목 정책 | 목표 DoS·MOQ·배정 방식 컬럼과 조회 존재 | 담당자 변경 요청, 팀장 승인, 승인본 적용 |
| 업무 권한 | DB 권한 코드와 조회 화면 존재 | 메뉴 필터, 실제 업무 화면·Server Action·RLS 적용 |
| 기준월 | 대시보드와 사이드바에 `2026.09` 고정 | 활성 발주계획 기준월 조회로 교체 |
| 재고 | 기존 뷰가 진행 중 입고를 가산 | 정상 창고재고와 배정 차감 기준으로 교체 |
| 수요 | 관리자 화면은 준비 중 | 부서 제출·마감·표준화·수급회의·이벤트 승인 |
| 발주 Workflow | 레거시 브라우저 계산 | 신규 DB 기반 업무 화면으로 대체 후 메뉴 제거 |

### 직접 사용을 중단해야 하는 상충 구현

- `components/workflow/demand-step.tsx`의 수주확률 가중 계산
- `components/workflow/demand-step.tsx`의 조건부 Bulk 수요 50% 자동 반영
- `components/workflow/supply-step.tsx`의 Open PO 가용재고 가산
- `components/workflow/*`의 샘플 수량과 브라우저 내 발주 계산
- `SCHEMA.md`의 기존 `available_qty = current_stock + inbound_qty` 운영 정의

이 파일들은 신규 기능 구현 중 수정하지 않고 `(legacy)` 경로에 유지한다. 신규 업무 화면이 검수된 뒤 메뉴에서만 제거한다.

---

## 2. 목표 파일 구조

```text
app/
  (user)/
    demand-submissions/             부서별 수요 제출
    orders/                         영업 주문·검토 요청
    allocations/                    배정 현황·SCM 처리
    approvals/                      SCM팀장 승인함
    procurement-plans/              최종 발주계획
    inventory/                      권한별 재고 조회
    urgent-orders/                  서비스부 긴급발주 조회
  (admin)/admin/
    master/                         법인·공급처·달력 관리
    notification-history/           알림 발송 이력
  api/cron/notifications/route.ts   10분 단위 알림 처리
  api/cron/allocations/route.ts     만료·입고 후 자동배정 처리
components/
  demand/                           제출·취합 화면 공통 요소
  orders/                           주문·배정 화면 공통 요소
  approvals/                        승인 목록·상세
  procurement/                      발주계획 요약·근거 표
lib/
  demand/                           타입·정규화·조회·Server Action 입력 검증
  orders/                           타입·정규화·조회·명령 결과 처리
  approvals/                        승인 조회·명령
  procurement/                      발주계획 조회 모델
  notifications/                   이메일 발송 어댑터
supabase/migrations/
  20260911000300_stage1_foundation_hardening.sql
  20260911000400_stage1_approval_notification.sql
  20260911000500_stage1_inventory_availability.sql
  20260911000600_stage1_sales_order_allocation.sql
  20260911000700_stage1_demand_submission.sql
  20260911000800_stage1_approved_demand.sql
  20260911000900_stage1_procurement_plan.sql
  20260911001000_stage1_procurement_schedule.sql
  20260911001100_stage1_inventory_kpi.sql
  20260911001200_stage1_legacy_cutover.sql
```

---

## 3. 단계별 구현 계획

## Task 1: 현재 기반 고정 및 상충 정의 차단

**목적:** STEP 18·19를 출발점으로 고정하고, 기존 더미 계산이 신규 업무 데이터에 섞이지 않게 한다.

**파일:**

- 수정: `SCHEMA.md`
- 수정: `lib/menu.ts`
- 수정: `components/shell/sidebar.tsx`
- 수정: `app/(user)/layout.tsx`
- 수정: `app/(admin)/layout.tsx`
- 수정: `lib/permission.ts`
- 수정: `lib/permission.test.ts`
- 생성: `supabase/migrations/20260911000300_stage1_foundation_hardening.sql`

**구현:**

- [ ] 테스트에 직책별 메뉴 노출 기대값을 먼저 추가한다. `SCM_PLANNER`는 발주계획·배정, `SCM_LEAD`는 승인함, `SALES_REP`는 주문, `BIZ_DEV`는 배정 우선순위, 마케팅·서비스는 각 재고와 수요 제출 메뉴만 보여야 한다.
- [ ] `Sidebar` 입력을 `role`만 받는 구조에서 `role + permissionCodes`로 바꾸고 `menuFor()`를 실제 사용한다.
- [ ] 두 layout에서 `getPermissions()`를 호출해 권한 코드를 Sidebar에 전달한다.
- [ ] `analytics` 사용자별 뷰가 소유자 권한으로 RLS를 우회하지 않도록 신규 운영 뷰에 `security_invoker = true`를 적용하는 공통 규칙을 SQL 주석으로 고정한다.
- [ ] `core.item_policy`의 `allocation_mode`와 `target_dos_days`는 승인 전 초안과 승인본을 구분해야 하므로, 현재 컬럼을 즉시 운영값으로 직접 수정하는 경로를 차단한다.
- [ ] `SCHEMA.md`에서 운영 가용재고 정의를 “정상 창고재고 - 임시배정 - 확정배정 - 승인대기 확보”로 정정하고 기존 `v_stockout_risk`는 더미 분석용이라고 명시한다.
- [ ] `stage1.md`, `gap.md`, `향후논의사항.md`는 요구사항 문서로만 유지하고 앱에서 직접 읽지 않는다.

**데이터베이스 확인:**

```sql
select entity_id, entity_name, active
from core.supply_entity
where active
order by entity_id;
-- 기대: CN, JP, NL, SG, VN 5행

select job_role, count(*)
from core.role_permission
group by job_role
order by job_role;
-- 기대: 정의된 6개 직책 모두 1개 이상의 권한
```

**검증:**

- [ ] `npm test -- lib/permission.test.ts`
- [ ] USER 계정의 주소 직접 접근이 메뉴 표시 여부와 무관하게 서버에서 403 처리되는지 확인한다.
- [ ] 커밋: `업무 권한을 메뉴와 서버 경로에 연결`

---

## Task 2: 공통 승인 및 감사 이력 엔진

**목적:** 품목 정책, 수동 우선 배정, 이벤트 추가 수요, 최종 발주계획이 같은 승인 규칙과 이력 형식을 사용하게 한다.

**파일:**

- 생성: `supabase/migrations/20260911000400_stage1_approval_notification.sql`
- 생성: `lib/approvals/model.ts`
- 생성: `lib/approvals/model.test.ts`
- 생성: `lib/approvals/repository.ts`
- 생성: `app/(user)/approvals/actions.ts`
- 생성: `app/(user)/approvals/page.tsx`
- 생성: `components/approvals/approval-table.tsx`
- 수정: `lib/menu.ts`
- 수정: `styles/components.css`

**DB 객체:**

- `core.approval_request`
  - `approval_id`, `approval_type`, `target_type`, `target_id`, `payload`
  - `status`: `PENDING | APPROVED | REJECTED | CANCELLED`
  - `reason_code`, `reason_text`, `requested_by`, `requested_at`
  - `decided_by`, `decided_at`, `decision_comment`
- `core.approval_event`: append-only 상태 변경 이력
- `analytics.v_my_approval_inbox`, `analytics.v_approval_history`
- `core.request_approval(...)`, `core.decide_approval(...)`

**구현:**

- [ ] 승인 타입을 `ITEM_POLICY`, `ALLOC_PRIORITY`, `EVENT_ORDER`, `PURCHASE_PLAN` 네 코드로 제한하는 테스트를 먼저 작성한다.
- [ ] 요청자와 승인자가 같을 수 없게 한다. ADMIN 여부가 아니라 `core.has_permission()`으로 해당 승인 권한을 검사한다.
- [ ] 이벤트 추가 수요 사유에는 고객, 기종, 수량이 모두 있어야 요청을 생성한다.
- [ ] 모든 승인·반려는 `core.approval_event`와 `core.audit_log`에 같은 트랜잭션으로 기록한다.
- [ ] Server Action 첫 줄에서 `requirePermission()`을 호출하고 DB 함수 결과만 반환한다.
- [ ] 승인함 화면은 통계 계산 없이 `analytics.v_my_approval_inbox`를 렌더링한다.

**데이터베이스 확인:**

```sql
select approval_type, status, requested_by, decided_by
from core.approval_request
order by requested_at desc;

select action, target_type, target_id
from core.audit_log
where target_type = 'APPROVAL_REQUEST'
order by at desc;
```

**검증:**

- [ ] 권한 없는 USER의 승인 함수 직접 호출이 거절되는지 확인한다.
- [ ] 요청자가 자기 요청을 승인할 수 없는지 확인한다.
- [ ] 반려 시 의견이 없으면 거절되는지 확인한다.
- [ ] `npm test -- lib/approvals/model.test.ts`
- [ ] 커밋: `공통 승인과 감사 이력 엔진 추가`

---

## Task 3: 알림 Outbox와 이메일 발송

**목적:** 10분 반복 알림, 임시배정 만료 예고, 처리 결과 알림을 중복 없이 시스템 알림과 이메일로 보낸다.

**파일:**

- 같은 마이그레이션 확장: `supabase/migrations/20260911000400_stage1_approval_notification.sql`
- 생성: `lib/notifications/types.ts`
- 생성: `lib/notifications/email.ts`
- 생성: `lib/notifications/email.test.ts`
- 생성: `lib/supabase/admin.ts`
- 생성: `app/api/cron/notifications/route.ts`
- 생성: `app/(user)/notifications/page.tsx`
- 생성: `app/(user)/notifications/actions.ts`
- 생성: `app/(admin)/admin/notification-history/page.tsx`
- 수정: `.env.local.example`
- 생성 또는 수정: `vercel.json`

**DB 객체:**

- `core.notification_outbox`: `notification_id`, `dedupe_key`, `template_code`, `recipient_user_id`, `channel`, `scheduled_at`, `payload`, `status`, `attempt_count`
- `core.notification_delivery`: 발송 시각, 성공·실패, 오류, 외부 메시지 식별자
- `core.user_notification`: 앱 내 읽음 상태
- `analytics.v_my_notification`, `analytics.v_notification_delivery`
- `core.enqueue_notification(...)`, `core.claim_due_notifications(...)`, `core.finish_notification(...)`

**구현:**

- [ ] `(dedupe_key, recipient_user_id, channel)` 고유 제약으로 중복 생성을 막는다.
- [ ] 승인 대기 반복 알림은 승인·반려까지 24시간 내내 10분 단위로 다음 건을 예약한다. 처리 즉시 예약된 후속 알림을 취소한다.
- [ ] 수요 미제출 알림은 제출 완료 시 후속 예약을 취소한다.
- [ ] 임시배정 생성 시 만료 10·5·3·2·1일 전 알림을 예약하고, 만료 당일에는 “임시배정이 자동 해제되었습니다” 완료 알림만 생성한다.
- [ ] 이메일은 서버 전용 `RESEND_API_KEY`, `RESEND_FROM_EMAIL`을 사용해 REST로 발송한다. 키는 브라우저 번들에 포함하지 않는다.
- [ ] Cron 경로는 `CRON_SECRET`을 검증하고 service key 서버 클라이언트로 due 항목만 처리한다.
- [ ] 앱 알림과 이메일의 성공·실패를 채널별로 따로 기록한다.

**검증:**

- [ ] 같은 Cron 요청을 두 번 실행해도 같은 알림이 중복 생성되지 않는지 확인한다.
- [ ] 승인 처리 후 10분 반복 예약이 0건인지 확인한다.
- [ ] 실패한 이메일은 `FAILED`와 오류 내용을 남기고 앱 알림은 유지되는지 확인한다.
- [ ] `npm test -- lib/notifications/email.test.ts`
- [ ] 커밋: `반복 알림과 이메일 발송 이력 추가`

---

## Task 4: 정상 창고재고와 가용재고 기준 확정

**목적:** Open PO와 이동 중 수량을 제외하고, 중복 배정을 방지할 수 있는 단일 가용재고 기준을 만든다.

**파일:**

- 생성: `supabase/migrations/20260911000500_stage1_inventory_availability.sql`
- 생성: `lib/inventory/model.ts`
- 생성: `lib/inventory/model.test.ts`
- 생성: `lib/inventory/repository.ts`
- 생성: `app/(user)/inventory/page.tsx`
- 생성: `components/inventory/stock-table.tsx`
- 수정: `lib/menu.ts`
- 수정: `lib/scm.ts`

**DB 객체와 규칙:**

- 기존 `raw.inventory`에 nullable `inventory_status`, `snapshot_at`, `warehouse_code` 적재 필드를 `ALTER`로 추가한다.
- `core.inventory_scope_rule`: 원본 창고·재고상태를 `NORMAL`, `INSPECTION`, `DEFECT`, `SERVICE_CENTER`, `PARTNER`, `IN_TRANSIT`로 매핑한다.
- `core.item_visibility_rule`: 품목 유형을 `PAPER_CARD_READER`, `CONSUMABLE`, `GENERAL` 조회 범위로 매핑한다.
- `core.stock_balance`: 품목별 확정 정상 창고재고와 스냅샷 시각. 배정 함수가 `FOR UPDATE`로 잠그는 행이다.
- `core.refresh_stock_balance(p_batch_id)`: 검증 완료된 재고 배치만 반영한다.
- `analytics.v_available_stock`:

```text
available_qty = normal_warehouse_qty
              - temporary_allocated_qty
              - firm_allocated_qty
              - approval_hold_qty
```

- 상태나 창고 범위를 분류할 수 없는 기존 행은 정상재고로 추정하지 않고 `INVENTORY_SCOPE_UNCLASSIFIED`로 제외한다.
- `raw.goods_receipt`는 창고 입고 완료일과 완료 상태가 모두 확인된 건만 `stock_balance` 증가 원장으로 연결한다.
- Open PO와 이동 중 선적은 참고 열로만 제공하며 `available_qty`에 더하지 않는다.

**구현:**

- [ ] 상태별 수량을 넣었을 때 `NORMAL`만 정상 창고재고가 되는 SQL 검증 데이터를 먼저 작성한다.
- [ ] `inventory` import schema와 validation에 신규 상태·스냅샷 컬럼을 추가한다. 필수 운영 값 누락은 ERROR로 처리하고 임의 상태를 넣지 않는다.
- [ ] 마케팅은 용지·카드리더기, 서비스는 소모품, 영업은 ATP만 보도록 `analytics` 뷰에서 권한과 품목 범위를 제한한다.
- [ ] 기존 Stockout 화면은 새 운영 재고가 준비되기 전까지 계산 불가 사유를 표시하고 더미 `v_stockout_risk`를 운영값으로 섞지 않는다.

**검증:**

- [ ] 검사대기 10, 정상 20, 이동 중 30이면 정상 창고재고가 20인지 확인한다.
- [ ] 상태 미입력 재고가 0으로 처리되지 않고 사유 코드로 제외되는지 확인한다.
- [ ] 익명 사용자가 재고를 조회하거나 갱신할 수 없는지 확인한다.
- [ ] 커밋: `정상 창고재고와 가용재고 기준 확정`

---

## Task 5: 영업 주문과 임시·확정 배정 트랜잭션

**목적:** 여러 영업담당자가 같은 재고를 동시에 주문해도 초과 배정되지 않게 한다.

**파일:**

- 생성: `supabase/migrations/20260911000600_stage1_sales_order_allocation.sql`
- 생성: `lib/orders/model.ts`
- 생성: `lib/orders/model.test.ts`
- 생성: `lib/orders/repository.ts`
- 생성: `lib/orders/actions.ts`
- 생성: `app/(user)/orders/page.tsx`
- 생성: `app/(user)/orders/new/page.tsx`
- 생성: `app/(user)/orders/[orderId]/page.tsx`
- 생성: `app/(user)/allocations/page.tsx`
- 생성: `components/orders/order-form.tsx`
- 생성: `components/orders/allocation-table.tsx`
- 수정: `lib/menu.ts`

**DB 객체:**

- `core.sales_order`: `order_id`, `order_no`, `customer_id`, `owner_user_id`, `status`, `requested_at`, `first_review_requested_at`, `allocation_choice`, `confirmed_order_no`, `replaces_order_id`
- `core.sales_order_line`: 품목, 요청수량, 임시배정, 확정배정, 부족수량
- `core.stock_allocation`: `TEMPORARY | APPROVAL_HOLD | FIRM | RELEASED`
- `core.allocation_priority`: 사업강화부 우선순위와 변경 이력
- `core.urgent_order`: 서비스부가 조회할 긴급발주 요청 품목·수량·필요일·사유·상태·담당자
- `core.sales_order_event`, `core.stock_allocation_event`: append-only 업무 이력
- `analytics.v_my_sales_order`, `analytics.v_allocation_queue`, `analytics.v_order_available_stock`, `analytics.v_urgent_order`

**상태:**

```text
DRAFT → REVIEW_REQUESTED → PARTIALLY_ALLOCATED | WAITING_FULL
      → CONFIRMED | EXPIRED | CANCELLED
```

**핵심 DB 함수:**

```text
core.create_sales_order(...)
core.request_order_review(p_order_id, p_choice)
core.confirm_sales_order(p_order_id, p_confirmed_order_no)
core.change_allocation_priority(p_order_id, p_priority, p_reason)
core.request_manual_allocation(p_order_id, p_item_id, p_qty, p_reason)
core.cancel_firm_allocation(p_allocation_id, p_reason)
core.copy_cancelled_order(p_order_id)
```

**구현 규칙:**

- [ ] 검토 요청은 등록자가 `PARTIAL` 또는 `WAIT_FULL`을 반드시 선택한다.
- [ ] 임시배정 만료는 최초 검토 요청 시각 + 30일이며 추가 배정으로 갱신되지 않는다. 만료일 변경을 트리거로 차단한다.
- [ ] 자동 순서는 사업강화부 우선순위, 최초 검토 요청 시각, 주문 생성 순서다.
- [ ] 부분 배정의 부족 수량은 최초 대기 순서를 유지한다.
- [ ] 수동 배정은 곧 확정배정이다. 정상 순서면 SCM 품목담당자가 즉시 확정하고, 순서를 건너뛰면 팀장 승인 전 `APPROVAL_HOLD`만 만든다.
- [ ] 승인 시 hold를 즉시 `FIRM`으로 전환하고 추가 SCM 처리 단계를 만들지 않는다. 반려 시 hold를 해제한다.
- [ ] 수주 확정 시 최종 승인 주문번호 입력을 필수로 하고 임시배정을 확정배정으로 전환한다.
- [ ] 확정배정 취소는 팀장 승인 없이 가능하지만 사유가 필수다. 주문도 함께 취소하고 재고를 복원하며 대기 상태로 돌리지 않는다.
- [ ] 취소 주문 재등록은 새 주문을 만들고 기존 품목·수량·고객을 복사하며 `replaces_order_id`로 연결한다.
- [ ] 모든 배정 함수는 `core.stock_balance`의 해당 품목 행을 `FOR UPDATE`로 잠근 뒤 한 트랜잭션에서 처리한다.

**검증:**

- [ ] 재고 100에 동시에 60씩 두 건을 요청해 배정 합계가 100을 넘지 않는지 확인한다.
- [ ] `PARTIAL`은 60+40으로 배정되고 부족수량이 남는지, `WAIT_FULL`은 0을 배정하고 전체 대기하는지 확인한다.
- [ ] 추가 배정 후에도 최초 만료일이 변하지 않는지 확인한다.
- [ ] 확정배정 취소 시 주문도 취소되고 재고가 복원되는지 확인한다.
- [ ] `npm test -- lib/orders/model.test.ts`
- [ ] 커밋: `영업 주문과 재고 배정 트랜잭션 구현`

---

## Task 6: 자동 만료와 입고 후 후속 배정

**목적:** 30일 만료와 신규 입고 배정을 사람의 수동 실행에 의존하지 않게 한다.

**파일:**

- 같은 마이그레이션 확장: `supabase/migrations/20260911000600_stage1_sales_order_allocation.sql`
- 생성: `app/api/cron/allocations/route.ts`
- 생성: `lib/orders/jobs.ts`
- 생성: `lib/orders/jobs.test.ts`
- 수정: `vercel.json`

**DB 함수:**

- `core.expire_temporary_allocations(p_now)`: 만료 배정 해제, 주문 `EXPIRED`, 재고 복원, 완료 알림 생성
- `core.allocate_new_stock(p_item_id, p_receipt_id)`: AUTO 품목에 우선순위대로 후속 배정
- `core.list_manual_allocation_candidates(p_item_id)`: MANUAL 품목은 계산 없이 후보만 제공

**구현:**

- [ ] 만료 예고는 작업 3의 예약 알림을 사용하고 만료 당일 함수가 실제 해제에 성공한 뒤 완료 알림을 생성한다.
- [ ] AUTO 품목은 입고 완료 트랜잭션에서 후속 배정을 실행한다.
- [ ] MANUAL 품목은 자동 배정하지 않고 SCM 품목담당자에게 처리 필요 알림만 보낸다.
- [ ] 자동 배정 알림에 주문번호, 품목, 배정수량, 남은 부족수량, 배정시각을 저장한다.
- [ ] `APPROVAL_HOLD`와 `FIRM`에는 30일 만료 함수를 적용하지 않는다.

**검증:**

- [ ] 경계 시각 직전에는 유지되고 경계 시각 이후 한 번만 만료되는지 확인한다.
- [ ] 신규 입고가 여러 대기 주문에 순서대로 나뉘는지 확인한다.
- [ ] MANUAL 품목에 자동 배정 0건인지 확인한다.
- [ ] 커밋: `임시배정 만료와 입고 후 자동배정 추가`

---

## Task 7: 부서별 월간 수요 제출

**목적:** 가장 우선순위가 높은 병목인 수요 자료 취합 시간을 줄이고 제출·수정·합의 이력을 남긴다.

**파일:**

- 생성: `supabase/migrations/20260911000700_stage1_demand_submission.sql`
- 생성: `lib/demand/model.ts`
- 생성: `lib/demand/model.test.ts`
- 생성: `lib/demand/repository.ts`
- 생성: `lib/demand/actions.ts`
- 생성: `app/(user)/demand-submissions/page.tsx`
- 생성: `app/(user)/demand-submissions/[submissionId]/page.tsx`
- 수정: `app/(admin)/admin/demand/page.tsx`
- 생성: `components/demand/submission-form.tsx`
- 생성: `components/demand/submission-status-table.tsx`
- 수정: `lib/import/schema.ts`
- 수정: `lib/import/validate.ts`
- 수정: `lib/import/validate.test.ts`

**DB 객체:**

- `core.planning_cycle`: 기준월, 제출마감일, 상태, 활성 여부
- `core.demand_submission`: 기준월, 부서, 제출상태, 제출자, 제출시각, 버전
- `core.demand_submission_line`: 원본 품목코드, 표준 품목코드, 수량, 필요월, 오류 사유
- `core.demand_submission_event`: 제출·회수·수정·합의 이력
- `analytics.v_demand_submission_status`, `analytics.v_demand_submission_line`
- `core.submission_deadline(p_plan_month)`: 대상월 전월 말일 - 1일

**구현:**

- [ ] 28·29·30·31일 말일에서 제출 마감 계산 테스트를 먼저 작성한다.
- [ ] 마케팅·서비스 등 `DEMAND_SUBMIT` 권한이 있는 사용자는 자기 부서 자료만 작성한다.
- [ ] 파일 업로드와 직접 입력 모두 STEP 4의 동일한 품목코드 검증을 재사용한다.
- [ ] 품목코드 불일치, null 수량, 잘못된 날짜는 조용히 제외하지 않고 행 오류로 남긴다.
- [ ] 제출 완료 시 해당 부서의 10분 반복 미제출 알림을 중단한다.
- [ ] SCM 취합 화면은 제출 여부, 오류 건수, 마지막 수정자와 시각을 한 화면에 보여준다.

**검증:**

- [ ] 동일 부서·기준월의 활성 제출본이 하나만 존재하는지 확인한다.
- [ ] 다른 부서 제출본 수정이 서버와 RLS에서 거절되는지 확인한다.
- [ ] 제출 전 ERROR 행이 있으면 제출 완료로 바뀌지 않는지 확인한다.
- [ ] 커밋: `부서별 월간 수요 제출과 마감 관리 구현`

---

## Task 8: 확정 수요 구성과 이벤트 추가 수요 승인

**목적:** 발주 계산에는 확정된 업무 근거만 들어가게 하고 영업 확률 수요를 완전히 배제한다.

**파일:**

- 생성: `supabase/migrations/20260911000800_stage1_approved_demand.sql`
- 생성: `lib/demand/approved-model.ts`
- 생성: `lib/demand/approved-model.test.ts`
- 수정: `lib/demand/repository.ts`
- 생성: `app/(user)/demand-submissions/consolidation/page.tsx`
- 생성: `components/demand/approved-demand-table.tsx`

**DB 객체:**

- `core.supply_meeting_result`: SCM 담당자 대리 입력, 승인 여부와 수량
- `core.event_demand`: 고객, 기종, 수량, 사유, 승인 연결
- `analytics.v_approved_demand_detail`
- `analytics.v_approved_demand_monthly`

**포함 규칙:**

1. `CONFIRMED_ORDER`: 최종 승인 주문번호가 입력된 수주 확정 건
2. `SUPPLY_MEETING`: 수급회의 승인 결과
3. `EVENT_DEMAND`: SCM팀장이 승인한 이벤트성 추가 발주

`sales_probability`, 파트너 선주문, 미승인 이벤트는 참고정보로 조회할 수 있지만 위 집계에는 조인하지 않는다.

**구현:**

- [ ] 확률 100% 영업 건도 수주 확정 번호가 없으면 0건 포함되는 SQL 검증을 작성한다.
- [ ] 이벤트 수요는 고객·기종·수량 사유가 모두 있고 `APPROVED`인 경우만 집계한다.
- [ ] 수급회의 결과는 입력자와 시각을 보존하고 수정 시 이전 값을 이력에 남긴다.
- [ ] 화면은 원천별 수량과 제외 사유를 보여주되 합계는 analytics 저장 결과를 사용한다.

**검증:**

- [ ] 수주확률만 변경해도 승인 수요 합계가 변하지 않는지 확인한다.
- [ ] 이벤트 승인 전 0, 승인 후 해당 수량만 반영되는지 확인한다.
- [ ] 커밋: `확정 근거 기반 수요 집계 구현`

---

## Task 9: 목표 DoS와 최종 발주량 계산

**목적:** Champion Forecast를 실제 발주 기준 수요와 최종 발주량으로 변환한다.

**파일:**

- 생성: `supabase/migrations/20260911000900_stage1_procurement_plan.sql`
- 생성: `lib/procurement/model.ts`
- 생성: `lib/procurement/model.test.ts`
- 생성: `lib/procurement/repository.ts`
- 생성: `lib/procurement/actions.ts`
- 생성: `lib/item-policy/actions.ts`
- 생성: `lib/item-policy/repository.ts`
- 생성: `lib/item-policy/model.test.ts`
- 생성: `app/(user)/procurement-plans/page.tsx`
- 생성: `app/(user)/procurement-plans/[planId]/page.tsx`
- 생성: `app/(user)/procurement-plans/item-policies/page.tsx`
- 생성: `components/procurement/plan-line-table.tsx`
- 생성: `components/procurement/plan-summary.tsx`
- 생성: `components/procurement/item-policy-form.tsx`
- 수정: `app/(admin)/admin/master/page.tsx`
- 수정: `lib/menu.ts`

**DB 객체:**

- `core.procurement_plan`: 기준월, Forecast Run, 재고 snapshot, 상태, 작성자, 승인자
- `core.procurement_plan_line`: 계산 단계별 수량과 사유
- `core.procurement_plan_event`: 생성·확정·승인 이력
- `core.item_policy_revision`: 제안값, 기존 승인값, 사유, 요청자, 승인 연결
- `analytics.v_procurement_plan`, `analytics.v_procurement_plan_line`, `analytics.v_procurement_plan_kpi`
- `analytics.v_item_policy_revision`
- `core.request_item_policy_change(...)`
- `core.build_procurement_plan(p_plan_month, p_forecast_run_id)`
- `core.confirm_procurement_plan(p_plan_id)`
- `core.approve_procurement_plan(p_plan_id, p_approval_id)`

**라인별 저장값:**

- `base_forecast_qty`
- `flex_min_qty`, `flex_max_qty`, `flex_applied`
- `confirmed_order_qty`, `meeting_qty`, `event_qty`
- `normal_stock_qty`, `allocated_qty`, `available_qty`
- `avg_usage_6m`, `projected_month_end_qty`, `projected_dos_days`
- `dos_required_qty`, `stockout_prevention_qty`, `selected_qty`
- `effective_moq`, `final_order_qty`, `projected_inventory_value`
- `calculation_status`, `reason_code`, `selection_reason`

**계산 규칙:**

- [ ] 계산 기능보다 먼저 품목 정책 변경 절차를 구현한다. SCM 품목담당자가 목표 DoS·배정 방식·목표재고·단가·MOQ 변경안을 제출하고 SCM팀장이 승인한 값만 `core.item_policy` 운영값으로 반영한다.
- [ ] 승인 전에는 기존 운영값을 유지하고, 반려 시 운영값을 바꾸지 않은 채 사유와 이력만 남긴다.
- [ ] 목표 DoS가 한 번도 승인되지 않은 품목은 발주 확정을 차단한다.
- [ ] 월평균사용량은 학습 데이터의 최근 6개월 집계만 사용하고 원본 null을 0으로 바꾸지 않는다.
- [ ] `DoS = 월말 재고 / 최근 6개월 월평균사용량 * 30`으로 계산한다.
- [ ] 리드타임 다음 첫 월은 기준 Forecast의 ±20%, 그다음 두 달은 ±30%, 4~6개월은 Flex 범위를 적용하지 않는다.
- [ ] 한 수량 선택 기준은 1순위 품절 가능성 최소, 2순위 목표 DoS 충족 최소수량, 3순위 월말 재고금액 최소다. `selection_reason`에 어느 기준으로 선택됐는지 저장한다.
- [ ] MOQ는 `coalesce(moq, 1)`로 적용하고 `ceil(selected_qty / effective_moq) * effective_moq`로 올림한다.
- [ ] `pack_size`, `min_order_amount`는 저장·표시만 하고 현재 계산에는 적용하지 않는다.
- [ ] 목표 DoS, 단가, 정상재고, 평균사용량, 활성 Champion Forecast 중 필수 근거가 없으면 임의 수량을 만들지 않고 `CALCULATION_UNAVAILABLE`과 사유 코드를 저장한다.
- [ ] 품목담당자 확정 후 SCM팀장 승인 전까지 발주 확정본으로 사용하지 않는다.

**필수 테스트 사례:**

- [ ] 필요량 120, MOQ 50이면 최종 발주량 150
- [ ] MOQ null이면 1을 적용
- [ ] 목표 DoS null이면 확정 차단
- [ ] 1차 Forecast가 ±20% 범위를 벗어나면 범위 안에서 선택
- [ ] 2차 Forecast가 ±30% 범위를 벗어나면 범위 안에서 선택
- [ ] 4~6개월은 Flex 미적용
- [ ] test Actual을 바꿔도 계획의 학습 Forecast 근거가 변하지 않음
- [ ] 영업 확률을 바꿔도 최종 발주량이 변하지 않음
- [ ] 품목 정책 변경안 승인 전후에 운영값이 정확한 시점에만 바뀜
- [ ] 담당자가 자기 정책 변경안을 승인할 수 없음
- [ ] `npm test -- lib/procurement/model.test.ts`
- [ ] `npm test -- lib/item-policy/model.test.ts`
- [ ] 커밋: `목표 DoS와 최종 발주량 계산 구현`

---

## Task 10: 발주일·출항일·입고 차이

**목적:** 공급처별 출항일과 법인 준비기간으로 매월 발주 시점을 확정하고 입고 차이를 추적한다.

**파일:**

- 생성: `supabase/migrations/20260911001000_stage1_procurement_schedule.sql`
- 생성: `lib/schedule/model.ts`
- 생성: `lib/schedule/model.test.ts`
- 생성: `lib/schedule/repository.ts`
- 생성: `lib/schedule/actions.ts`
- 생성: `app/(user)/procurement-plans/schedule/page.tsx`
- 생성: `app/(user)/analysis/receipt-gap/page.tsx`
- 생성: `components/procurement/schedule-table.tsx`
- 생성: `components/analysis/receipt-gap-table.tsx`

**DB 객체:**

- `core.procurement_schedule`: 계획, 공급처, 출항일, 준비기간, 요청 발주일, 계획 입고일
- `core.receipt_schedule_result`: 계획 입고일, 실제 입고일, 차이 일수
- `analytics.v_procurement_schedule`
- `analytics.v_receipt_gap_entity`, `analytics.v_receipt_gap_item`, `analytics.v_receipt_gap_month`
- `core.build_procurement_schedule(p_plan_id)`

**계산 규칙:**

```text
기준 발주일 = 공급처 출항일 - 해외법인 출항 준비기간
요청 발주일 = 기준 발주일이 휴일이면 이전 영업일
계획 입고일 = 요청 발주일 + 7일
확정 계획 입고일 = 계획 입고일이 휴일이면 이전 영업일
입고 차이 = 실제 입고일 - 확정 계획 입고일
```

- [ ] 공급처 출항일을 ISO 주차 기준으로 묶어 한 주의 발주 묶음을 만든다.
- [ ] `발주마감일`이라는 별도 상태나 컬럼을 만들지 않는다.
- [ ] 준비기간 0이 `PREP_DAYS_UNSET`인 법인은 발주일을 계산하지 않는다.
- [ ] 공휴일 데이터가 없는 국가는 공휴일을 임의 추정하지 않고 달력 준비 상태를 표시한다.
- [ ] 입고 차이는 부호 있는 일수로 저장하되 조기/지연 상태 코드를 별도로 만들지 않는다.

**검증:**

- [ ] 주말·공휴일 발주일과 입고일이 이전 영업일로 이동하는지 확인한다.
- [ ] 법인별·품목별·월별 집계가 동일 원천 행을 사용하는지 확인한다.
- [ ] 실제 입고일 null이면 차이도 null과 `ACTUAL_RECEIPT_UNSET`인지 확인한다.
- [ ] 커밋: `발주 일정과 입고 차이 분석 구현`

---

## Task 11: 부서별 운영 화면 완성

**목적:** 같은 데이터를 부서별 권한과 업무 목적에 맞게 보여준다.

**파일:**

- 수정: `lib/menu.ts`
- 수정: `components/shell/sidebar.tsx`
- 생성: `app/(user)/urgent-orders/page.tsx`
- 생성: `components/inventory/marketing-stock-view.tsx`
- 생성: `components/inventory/service-stock-view.tsx`
- 생성: `components/inventory/sales-atp-view.tsx`
- 생성: `components/orders/priority-editor.tsx`
- 수정: `styles/components.css`
- 수정: `styles/shell.css`

**화면별 범위:**

| 사용자 | 화면 | 허용 내용 |
|---|---|---|
| 마케팅부 | 재고, 수요 제출 | 용지·카드리더기 재고와 자기 부서 제출 |
| 서비스부 | 재고, 긴급발주, 수요 제출 | 소모품 재고·긴급발주와 자기 부서 제출 |
| 영업부 | 주문, ATP | 정상재고에서 모든 배정·hold를 차감한 주문 가능 수량, 자기 주문 |
| 사업강화부 | 배정 우선순위 | 임시배정과 대기 순서 조회·우선순위 변경 |
| SCM 품목담당자 | 취합, 정책, 배정, 발주계획 | 담당 품목 운영 업무 |
| SCM팀장 | 승인함, 발주계획 | 정책·우선배정·이벤트·최종 발주 승인 |

**구현:**

- [ ] 긴급발주는 `core.urgent_order`에 요청 품목·수량·필요일·사유·상태·담당자를 저장하고 `analytics.v_urgent_order`에서 서비스부 조회 범위를 적용한다.
- [ ] 메뉴의 `anyOf`를 실제 업무 권한에 지정한다.
- [ ] 각 page 시작에서 `requirePermission()`을 호출한다.
- [ ] 각 Server Action도 같은 권한을 다시 검사한다.
- [ ] RLS 또는 security-invoker 뷰가 마지막으로 같은 범위를 강제한다.
- [ ] 조회 오류와 빈 결과를 다른 문구로 표시한다.
- [ ] 수치가 null이면 모두 `EmptyValue`와 reason code를 사용한다.

**검증:**

- [ ] 6개 직책 테스트 계정으로 메뉴, 직접 URL, Server Action, DB 접근의 네 단계 권한표를 확인한다.
- [ ] 마케팅이 소모품을, 서비스가 용지·카드리더기를 범위 밖에서 조회할 수 없는지 확인한다.
- [ ] 커밋: `부서별 운영 화면과 권한 범위 완성`

---

## Task 12: 월말 재고 성과와 동적 대시보드

**목적:** Forecast 정확도와 별도로 실제 발주 성과를 월말 재고수량·금액으로 평가한다.

**파일:**

- 생성: `supabase/migrations/20260911001100_stage1_inventory_kpi.sql`
- 생성: `lib/kpi/model.ts`
- 생성: `lib/kpi/model.test.ts`
- 생성: `lib/kpi/repository.ts`
- 수정: `app/(user)/dashboard/page.tsx`
- 수정: `components/shell/sidebar.tsx`
- 생성: `app/(user)/analysis/inventory-performance/page.tsx`
- 생성: `components/analysis/inventory-performance-table.tsx`

**DB 객체:**

- `core.month_end_inventory_snapshot`: 기준월, 품목, 정상재고수량, 단가, 금액, snapshot 시각
- `analytics.v_inventory_performance`: 실제 수량·금액, 목표 재고, 차이, reason code
- `analytics.v_inventory_performance_kpi`: 전체 월말 재고수량·금액·목표 대비 차이
- `analytics.v_current_planning_cycle`: 현재 기준월과 진행 상태

**구현:**

- [ ] 월말 재고금액은 승인된 단가가 있을 때만 계산한다. 단가가 없으면 0원이 아니라 `UNIT_PRICE_UNSET`이다.
- [ ] 대시보드와 사이드바의 `2026.09`를 `v_current_planning_cycle` 값으로 교체한다.
- [ ] 수요 제출, 승인 대기, 배정 부족, 발주계획 상태를 저장된 KPI로 표시한다.
- [ ] Forecast WAPE와 월말 재고성과를 같은 KPI로 합치지 않는다.

**검증:**

- [ ] 기준월 변경 시 대시보드와 사이드바가 함께 바뀌는지 확인한다.
- [ ] 단가 null 품목이 총액에 0으로 조용히 포함되지 않는지 확인한다.
- [ ] 커밋: `월말 재고 성과와 동적 기준월 대시보드 추가`

---

## Task 13: 레거시 전환과 최종 회귀 검증

**목적:** 신규 운영 흐름이 검수된 뒤 상충하는 레거시 진입점만 제거하고 데이터는 보존한다.

**파일:**

- 생성: `supabase/migrations/20260911001200_stage1_legacy_cutover.sql`
- 수정: `lib/menu.ts`
- 수정: `app/(admin)/admin/workflow/page.tsx`
- 유지: `app/(legacy)/workflow/page.tsx`
- 유지: `components/workflow/*`
- 수정: `AGENTS.md`
- 수정: `SCHEMA.md`
- 생성: `docs/stage1-운영검수.md`
- 생성: `docs/stage1-supabase-수동적용.md`

**구현:**

- [ ] 신규 수요 제출 → 승인 수요 → 재고 배정 → 발주계획 → 팀장 승인 → 일정 생성 흐름을 운영 검수표로 작성한다.
- [ ] `/admin/workflow`를 신규 `/procurement-plans`로 전환하고 관리자 메뉴의 “레거시 업무 플로우”를 제거한다.
- [ ] `/workflow`는 참고용임을 명확히 표시하고 저장·승인 기능을 제공하지 않는다.
- [ ] 과거 public 계획 테이블은 즉시 drop하지 않는다. 사용 여부를 확인한 후 revoke와 deprecated comment만 적용한다.
- [ ] `raw.item_substitute`는 유지하지만 신규 뷰·계산·메뉴와 연결되지 않았는지 확인한다.
- [ ] 모든 신규 SQL 파일의 적용 순서, Supabase 대시보드 확인 쿼리, 환경변수 설정을 수동 적용 문서에 기록한다.

**최종 자동 검증:**

```bash
npm test
npm run build
git diff --check
rg -n "#[0-9a-fA-F]{3,8}" app components lib
rg -n "raw\.usage_history|raw\.inventory|schema\('core'\)" app components
rg -n "2026\.09|수주확률 가중|가용 Open PO" app components --glob '!components/workflow/**'
```

**기대 결과:**

- 모든 테스트 통과
- Next.js production build 성공
- 화면 컴포넌트 내 hex 색상 0건
- 신규 운영 화면의 raw/core 직접 조회 0건
- 신규 운영 화면의 기준월·Forecast 범위 하드코딩 0건
- 레거시 외 수주확률 가중 및 Open PO 가용재고 반영 0건

**수동 업무 시나리오 검증:**

- [ ] 두 영업담당자의 동시 요청에도 초과 배정이 없다.
- [ ] 임시배정은 최초 요청 +30일에만 만료되고 추가 배정으로 연장되지 않는다.
- [ ] 만료 10·5·3·2·1일 전 및 당일 완료 알림이 발송된다.
- [ ] 수동 우선 배정은 승인 전 hold, 승인 즉시 firm, 반려 즉시 재고 복원이다.
- [ ] 확정배정 취소는 사유 필수, 주문 동시 취소, 재등록은 새 주문이다.
- [ ] 제출 마감 후 미제출 부서에 10분 알림이 가고 제출 즉시 중단된다.
- [ ] 영업 확률 건은 발주 수요에 들어가지 않는다.
- [ ] 목표 DoS 미설정 품목은 발주 확정이 차단된다.
- [ ] 필요량 120·MOQ 50은 최종 150이다.
- [ ] SCM 품목담당자 확정 후 SCM팀장 승인 전에는 최종 발주로 표시되지 않는다.
- [ ] 발주일과 입고일의 휴일은 이전 영업일로 이동한다.
- [ ] 월말 재고수량·금액이 목표 재고와 비교된다.

- [ ] 커밋: `Stage 1 운영 전환과 레거시 격리 완료`

---

## 4. 단계 의존 관계와 실행 순서

```text
작업 1 기반 고정
  ├─ 작업 2 승인 ─ 작업 3 알림
  ├─ 작업 4 재고 ─ 작업 5 배정 ─ 작업 6 자동 처리
  └─ 작업 7 수요 ─ 작업 8 확정 수요

작업 2 + 작업 3 + 작업 4 + 작업 6 + 작업 8
  └─ 작업 9 품목 정책 승인·최종 발주량

작업 9 + 기존 STEP 18 마스터
  └─ 작업 10 발주·입고 일정

작업 1~10
  └─ 작업 11 부서별 화면 ─ 작업 12 KPI ─ 작업 13 전환
```

권장 배포 단위는 다음과 같다.

1. **기반 배포:** 작업 1~3
2. **재고·주문 배포:** 작업 4~6
3. **수요 취합 배포:** 작업 7~8
4. **발주계획 배포:** 작업 9~10
5. **사용자 전환:** 작업 11~13

각 배포 단위는 이전 단위의 데이터를 삭제하지 않으며, 신규 테이블과 `ALTER`, 신규 뷰로 확장한다.

---

## 5. Supabase 수동 적용 원칙

사용자가 SQL을 직접 적용하므로 매 작업은 다음 순서를 지킨다.

1. 저장소에 마이그레이션 파일과 파일 하단 검증 쿼리를 작성한다.
2. 로컬 순수 함수 테스트와 `npm run build`를 통과시킨다.
3. 사용자에게 적용할 SQL 파일 한 개와 예상 결과를 안내한다.
4. 사용자가 Supabase SQL Editor에서 실행한다.
5. 검증 쿼리 결과를 확인한 뒤 해당 화면의 실데이터 조회를 검증한다.
6. 적용한 SQL은 수정하지 않고 다음 번호의 보정 마이그레이션으로 변경한다.

필요한 서버 전용 환경변수는 다음과 같다.

```text
SUPABASE_SECRET_KEY
CRON_SECRET
RESEND_API_KEY
RESEND_FROM_EMAIL
```

`SUPABASE_SECRET_KEY`와 이메일 키에는 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.

---

## 6. 완료 정의

이 리팩터링은 다음 조건을 모두 만족할 때 완료한다.

- 운영 해외법인이 5곳으로 관리되고 과거 공급처 이력이 보존된다.
- 부서와 직책 권한이 메뉴, 서버, 데이터베이스에서 모두 강제된다.
- 부서별 수요 제출과 10분 미제출 알림이 동작한다.
- 영업 주문의 임시·확정·승인대기 배정이 실제 재고를 초과하지 않는다.
- 임시배정의 30일 만료와 다중 예고·완료 알림이 동작한다.
- 정상 창고재고만 계산에 포함되고 미입고 Open PO는 가용재고에 포함되지 않는다.
- 수주 확정, 수급회의 승인, 승인된 이벤트 수요만 발주 수요에 포함된다.
- 목표 DoS, 6개월 평균사용량, Flex ±20%/±30%, MOQ를 반영한 최종 발주량이 SQL에서 계산된다.
- 목표 DoS 등 필수 근거가 없으면 발주 확정이 차단되고 사유 코드가 표시된다.
- SCM 품목담당자 확정과 SCM팀장 승인이 분리되고 모두 이력에 남는다.
- 공급처 출항일과 법인 준비기간으로 발주일이 생성되고 휴일은 이전 영업일로 이동한다.
- 계획 입고일과 실제 입고일의 차이를 법인·품목·월별로 조회할 수 있다.
- 월말 재고수량·금액을 목표 재고와 비교할 수 있다.
- 신규 운영 화면이 검수된 후 레거시 메뉴가 제거된다.
- `npm test`, `npm run build`, `git diff --check`가 모두 성공한다.

---

## 7. 이번 범위에서 명시적으로 제외하는 항목

- 전산 재고와 실재 재고의 실시간 대사
- 부품 부족 시 대체 Product 및 대체 부품 탐색
- `raw.item_substitute`를 이용한 자동 대체 추천
- 포장단위에 따른 발주량 올림
- 최소주문금액 강제
- 영업 확률을 사용한 발주 수요 가중

앞의 세 항목은 `향후논의사항.md`에서만 관리한다. 포장단위와 최소주문금액은 DB 설정 자리는 유지하되 이번 계산에는 적용하지 않는다.
