# Task 5 · 영업 주문과 임시·확정 배정 트랜잭션 — 구현 보고

BASE `f4c7535` · 커밋 `c41669c`(DB · 모델) · `4113313`(화면)

## 무엇을 만들었나

### DB — `supabase/migrations/20260911000600_stage1_sales_order_allocation.sql` (재실행 안전)

| 객체 | 내용 |
|---|---|
| `core.sales_order` | 브리프 열 + `order_seq`(생성 순서, identity), `owner_name`, `customer_name`, `temporary_expires_at`, `allocation_priority`(1~9, 기본 5), 확정 · 취소 · 만료 필드. 상태 7종 check, 확정 · 취소 필드 check, 확정 상태 안 `confirmed_order_no` 유일, `replaces_order_id` 유일 |
| `core.sales_order_line` | 품목 · 요청수량 · 임시 · 확정 · 승인대기 · `shortage_qty`(generated). 초과 배정 check, 주문 안 품목 유일 |
| `core.stock_allocation` | `TEMPORARY / APPROVAL_HOLD / FIRM / RELEASED`, `source`(REVIEW_REQUEST · MANUAL · RECEIPT), `approval_id`(유일), 해제 필드 check. 행 삭제 금지 |
| `core.allocation_priority` | 우선순위 변경 전후 · 변경자 · 시각 · 사유 append-only. 현재 값은 `sales_order.allocation_priority`에 같은 트랜잭션으로 반영 |
| `core.sales_order_event` · `core.stock_allocation_event` | append-only 이력(트리거로 UPDATE/DELETE 차단). 배정 이력은 전이 check 포함 |
| `core.urgent_order` | 품목 · 수량 · 필요일 · 사유 · 상태 · 담당자. 테이블 · 뷰 · RLS만 (판정 7) |
| `core.v_item_allocation_qty` | **소유자 권한** 품목별 임시 · 확정 · 확보 합계와 가용재고. 가용재고를 읽는 권한 범위와 같게 제한 |
| `core.v_allocation_queue_line` | 대기 순번의 단일 정의(우선순위 → 최초 검토 요청 → 생성 순서), security_invoker |
| `analytics.v_my_sales_order` | 본인 주문 + 품목 합계 + `lines`/`events` jsonb + 재등록 연결 |
| `analytics.v_allocation_queue` | SCM · 사업강화부 대기열, 품목 가용재고(null + `INVENTORY_SCOPE_UNCLASSIFIED`), 활성 배정 jsonb |
| `analytics.v_available_stock` · `v_order_available_stock` | Task 4 열 이름 · 순서 그대로 `create or replace`. 0 고정이던 세 열을 실제 합계로 교체 |
| `analytics.v_urgent_order` | STOCK_VIEW_ALL 전체, URGENT_ORDER_VIEW는 소모품만 |

공개 명령 함수 7개(모두 security definer, 첫머리에서 `auth.uid()` · `core.is_active_user` · `core.has_permission` 검사, authenticated에만 실행 권한):
`create_sales_order(customer_id, customer_name, lines jsonb, note)` · `request_order_review(order_id, choice)` →jsonb ·
`confirm_sales_order(order_id, confirmed_order_no)` · `change_allocation_priority(order_id, priority, reason)` ·
`request_manual_allocation(order_id, item_id, qty, reason)` →jsonb · `cancel_firm_allocation(allocation_id, reason)` ·
`copy_cancelled_order(order_id)`.

**동시성 설계.** 모든 경로의 잠금 순서를 `core.stock_balance` 품목 행(품목코드 오름차순, `core.lock_stock_balance_items`) → 주문 행 → 배정 행 → 승인 행으로 고정했다. 가용재고 판정은 잠금을 얻은 뒤 다음 문장에서 하므로(READ COMMITTED 문장 스냅샷) 먼저 끝난 트랜잭션의 배정이 반드시 보인다. `create_stock_allocation`은 호출자가 잠갔더라도 다시 잠그고 `v_committed + p_qty > v_normal`이면 거절한다(이중 방어).

**RLS 함정 회피.** 영업담당자는 RLS상 남의 주문 배정을 볼 수 없다. security_invoker 뷰가 `stock_allocation`을 직접 합하면 남의 배정이 빠져 주문 가능 수량이 부풀려진다. 그래서 차감 합계는 소유자 권한 `core.v_item_allocation_qty`(품목 합계만 노출)에서 읽는다 — 임시 DB에서 "영업1이 볼 때 100-60(본인)-40(영업2) = 0"으로 확인했다.

### 판정별 구현

1. **선착순 검토 요청** — `request_order_review`는 그 순간 `정상 − (임시+확보+확정)`에서 줄마다 `least(요청, greatest(가용, 0))`. 대기 주문 몫을 떼어 두지 않는다.
2. **만료 = 최초 검토 요청 + 30일** — 주문에 한 번만 기록(`temporary_expires_at`), 배정 행에는 만료일을 두지 않는다. `guard_sales_order_mutation` 트리거가 만료일 · 최초 검토 요청 시각 · 선택 방식의 변경을 superuser 포함 거절. WAIT_FULL로 대기하다 나중에 배정돼도 같은 값.
3. **정상 순서** — `core.v_allocation_queue_line`에서 같은 품목 · 부족수량 > 0 · `(우선순위, 최초 검토 요청, order_seq)`가 더 앞선 줄이 없으면 FIRM. 있으면 사유 필수 → `APPROVAL_HOLD` + `core.request_approval('ALLOC_PRIORITY', 'STOCK_ALLOCATION', allocation_id, …)`. 승인 → 즉시 FIRM, 반려 · 취소 → 즉시 RELEASED. 후처리는 `core.approval_request`의 `AFTER UPDATE OF status` 트리거 `alloc_priority_decision_apply`로 `decide_approval`과 같은 트랜잭션에서 실행하며, 승인 시 확보 상태 · 주문 상태를 다시 확인하고 아니면 예외로 결정 자체를 되돌린다. `BEFORE INSERT` 트리거가 확보 없이 만든 ALLOC_PRIORITY 요청을 막는다(승인해도 실행 대상이 없어 영원히 대기로 남는 것을 방지).
4. **수주 확정** — 최종 승인 주문번호 필수(확정 주문 사이 중복 금지), 임시배정 → FIRM, 확보는 유지, 부족분은 대기열에 남음. 확정 주문의 후속 배정은 `allocate_to_order_line`이 곧바로 FIRM. 만료 예고 series 취소.
5. **재등록** — CANCELLED · EXPIRED만, 본인 주문만, 한 번만. 고객 · 품목 · 수량 · 비고 복사, `replaces_order_id` 연결, 원 주문에 COPIED 이력.
6. **고객** — `customer_id`(코드 텍스트) · `customer_name` 텍스트, FK 없음.
7. **긴급발주** — 테이블 · `analytics.v_urgent_order` · RLS만.
8. **예시 데이터 없음 · 재실행 안전** — 함수 밖 INSERT 없음(계약 테스트), 임시 DB에 연속 3회 적용 exit 0. 원격 미적용. 확인 쿼리는 파일 끝 주석.
9. **이력** — 모든 상태 변경이 같은 트랜잭션에서 `sales_order_event`(선택 방식 · 임시배정 · 부족 · 선택자 포함) · `stock_allocation_event`(원인 `cause` 포함) · `allocation_priority`에 남는다.

### 알림 (Task 3 계약 재사용)

- 주문의 첫 임시배정 → `core.schedule_temporary_allocation_expiry(order_id::text, …)`, 수신자 = 영업담당자 + ALLOC_MANUAL 활성 사용자. 이번 트랜잭션이 만든 예고 중 이미 지난 시각은 취소(Task 6에서 늦게 배정되는 경우).
- 순서 건너뜀 승인 요청 → Task 3 트리거가 만든 팀장 `APPROVAL_PENDING` payload에 주문 · 품목 · 요청 수량 · 현재 가용재고 · 사유 · 요청자를 채움(10분 반복분이 그대로 이어받음).
- 승인 · 반려 결과 → 신규 템플릿 `ALLOC_PRIORITY_DECIDED`를 요청자 + 영업담당자에게. dedupe 키를 Task 3의 `approval:<id>:decision:<status>`와 같게 두고 트리거 이름순으로 먼저 실행해 요청자가 일반 결과 알림과 중복 수신하지 않게 했다. **payload에 `approval_id` 키를 넣지 않는다** — Task 3 트리거가 그 키로 PENDING 알림을 일괄 취소하므로 결과 알림까지 지워진다(임시 DB에서 확인하고 `priority_approval_id`로 둠).
- 확정배정 취소 → 신규 템플릿 `ALLOC_FIRM_CANCELLED`(주문번호 · 품목 · 해제 수량 · 처리자 · 처리 시각 · 사유)를 영업담당자에게.
- `core.enqueue_temporary_allocation_released()`는 호출하지 않았다(Task 6).

### 앱

- `lib/orders/model.ts` — 상태 · 선택 · 배정 상태 코드와 라벨, 입력 검증 7종, `v_my_sales_order` · `v_allocation_queue` 정규화(null 유지), DB 결과 문구, 이력 문장, 배지 색, 일시 표시.
- `lib/orders/repository.ts` — analytics 뷰 조회 3개, core RPC 7개. 계산 · 권한 판정 없음.
- `lib/orders/actions.ts` — 서버 액션 7개. 첫 줄 `requirePermission(해당 권한)` → 형식 검증 → DB 함수 결과만 반환.
- 화면 — `/orders` 목록(주문 등록 버튼은 ORDER_CREATE), `/orders/new`(`requirePermission('ORDER_CREATE')`, 품목 옆 주문 가능 수량은 `EmptyValue`+사유 코드), `/orders/[orderId]` 상세(검토 요청 · 수주 확정 · 재등록 · 이력), `/allocations`(대기열 · 수동 확정배정 · 확정배정 취소), `/allocations/priorities`(우선순위 변경). 모든 페이지 첫 줄 권한 가드, 오류/빈 결과 구분.
- `lib/menu.ts` — 세 업무 메뉴 설명만 실제 기능에 맞게 수정(권한 · 경로 변경 없음). `styles/components.css` 끝에 주문 · 배정 클래스 두 줄 추가(토큰만 사용).

## 무엇을 테스트했나

### 임시 PostgreSQL (`/tmp:5432`, PostgreSQL 17.10)

절차: `scm_task5_<시각>` DB → Task 4의 auth 스텁 → `schema-dump/2026-09-11.sql`(public 재생성 줄 제거) → STEP4 · STEP7 정책 선삭제 → 마이그레이션 전체 순서 적용 → 0600 재적용(exit 0, ERROR 0). 사용자 7명(영업 2 · 품목담당 1 · 팀장 1 · 사업강화부 1 · 마케팅 1 · 요청+승인 겸직 검증용 1 — 겸직 직책은 임시 DB 전용), 품목 9개, `stock_balance` 8행을 fixture로 넣었다. 신규 입고는 fixture에서 `stock_balance.normal_qty`를 올려 흉내 냈다. 결과: **시나리오 116/116, 동시성 11/11, 불변식 8/8 PASS**. 첫 실행에서 발견한 문제는 아래 자체 검토 1번(수정 후 새 DB에서 전체 재실행). 검증 후 DB 삭제(`scm_task5_%` 0개 확인).

**브리프 검증 4건**

1. 재고 100, 동시에 60 두 건(C1, 별도 연결 2개 + 잠금 게이트): 잠금 대기 2건 확인 → A `REVIEW_REQUESTED 임시=60 부족=0`, B `PARTIALLY_ALLOCATED 임시=40 부족=20`, 배정 합계 100.
2. PARTIAL vs WAIT_FULL(S2, ITEMT02 재고 100): C PARTIAL 60 → 60. D WAIT_FULL 60(가용 40) → `WAITING_FULL`, 임시 0, 부족 60, 배정 행 0. E PARTIAL 60 → `PARTIALLY_ALLOCATED`, 임시 40, 부족 20. 영업1(남의 주문 행 0건 조회) 주문 가능 수량 0.
3. 만료 불변(S3): 재고 180으로 올린 뒤 E 줄에 후속 배정 20 → 만료 시각 동일, 임시배정 2건, `REVIEW_REQUESTED`. D(WAIT_FULL)에 나중에 60 배정 → 만료 = 최초 검토 요청 + 30일 그대로, 예고 30건 예약. superuser의 직접 `UPDATE temporary_expires_at` → `42501 임시배정 만료일은 … 변경할 수 없습니다.`
4. 확정배정 취소(S4, ITEMT03): F 50 확정(`ERP-001`) → FIRM 50. 품목담당자 취소(사유) → F `CANCELLED`, 배정 전부 RELEASED, 영업2 주문 가능 수량 0 → 50. 취소 주문 검토 요청 · 확정 거절(대기로 돌아가지 않음). 영업담당자에게 취소 알림 2건(사유 · 처리자 · 해제 수량 50 포함). 재등록 → DRAFT 새 주문, 고객 · 품목 · 수량 · 비고 복사, 중복 재등록 거절.

**실제 동시성 (별도 psql 프로세스)**

- C2 게이트: 관리 세션이 ITEMC01 재고 행을 6초 잠근 상태에서 검토 요청 10건(각 30, PARTIAL 5 · WAIT_FULL 5)을 동시에 띄움 → `pg_stat_activity`에서 **Lock 대기 10건** 확인 → 해제 후 10건 모두 exit 0, 배정 합계 **정확히 100**(30·30·30 + PARTIAL 10, WAIT_FULL 4건 0, PARTIAL 2건 0 + 부족 30).
- C3 다른 품목: ITEMC01 잠금 중 ITEMC02 요청(statement_timeout 2s) → 0초에 완료. 같은 ITEMC01 요청은 `canceling statement due to statement timeout`으로 실패하고 주문은 DRAFT로 남음(부분 반영 없음).
- C4 게이트 없는 동시 10건(ITEMC03, 전부 PARTIAL 30) → 실패 0, 배정 `30,30,30,10,0×6`, 합계 100.
- 불변식: 초과 배정 품목 0, 줄 합계 = 배정 원장, 모든 주문 · 배정 · 해제에 이력, 모든 확보에 승인 연결, 모든 만료 = 최초 검토 요청 + 30일.

**수동 배정 · 승인 (S5, ITEMT04 재고 100 → 150)**

- 대기열 I(부족 20)=1, J(부족 40)=2. 품목담당자가 J에 30을 사유 없이 → `PRIORITY_REASON_REQUIRED`. 사업강화부 → `42501 ALLOC_MANUAL`.
- 사유 입력 → `APPROVAL_HOLD`, 주문 가능 수량 150-70-30-30 = **20**(확보가 차감됨). 팀장 알림 4건(2명 × 2채널)에 주문 · 품목 · 요청 수량 30 · 현재 가용재고 50 · 사유 · 요청자.
- 요청자(승인 권한 없음) · 마케팅의 승인 → `42501 이 승인 유형을 결정할 업무 권한이 없습니다.` 겸직 사용자가 만든 요청을 본인이 승인 → `42501 자신이 요청한 승인은 직접 결정할 수 없습니다.`
- 팀장 반려(의견 없음 거절 → 의견 입력) → 확보 즉시 RELEASED, 가용 10 → **20 복원**.
- 팀장 승인 → 같은 트랜잭션에서 확보 → **FIRM**(추가 단계 없음), 가용 20 유지, 결과 알림 4건(요청자 · 영업담당자) PENDING · 일반 결과 알림 중복 0 · 팀장 대기 알림 중단. 재승인 → `이미 처리되었거나 취소된 승인 요청입니다.`
- 1순번 I에 사유 없이 20 → 승인 없이 즉시 FIRM.

**우선순위 · 취소 연쇄 (S6, ITEMT06)**: 사업강화부가 R 우선순위 5 → 1(영업 42501, 사유 없음 · 0 · 동일값 거절) → 대기열 R=1, Q=2, 이력(전후 · 변경자 · 시각 · 사유). Q에 순서 건너뜀 확보 5가 대기 중일 때 Q의 확정배정 취소 → Q의 임시 10 · 확정 5 · 확보 5 모두 해제(원인 FIRM_CANCELLED/ORDER_CANCELLED), 승인 요청 `CANCELLED` + 이력, 팀장 대기 알림 중단, 이후 팀장 승인 거절, 가용 25 복원.

**직접 쓰기 · 권한 (S7)**: authenticated의 `stock_allocation` UPDATE/INSERT, `sales_order` 만료일 UPDATE, `sales_order_event` DELETE → 모두 `42501 permission denied`. 내부 함수 `allocate_to_order_line` · `create_stock_allocation` 직접 실행 → `permission denied for function`. 확보 없는 ALLOC_PRIORITY 요청 차단. 마케팅: 주문 · 배정 · 대기열 · 소모품 배정 합계 0행, 주문 등록 42501. 영업2는 본인 주문만. 영업은 대기열 · 재고 상세 0행. 미분류 품목(ITEMU01) 검토 요청 → `55000 INVENTORY_SCOPE_UNCLASSIFIED` 거절 + 주문 DRAFT 유지, 주문 가능 수량 null + 사유 코드. anon → `permission denied for schema`. 비활성 계정 거절. superuser도 배정 DELETE · 이력 UPDATE · 배정 수량 변경 · 취소 주문 복구 · 요청수량 변경은 트리거가 거절. SCM 상세 뷰 확인: ITEMT04 `정상=150 임시=100 확정=50 확보=0 가용=0`.

### TDD 증거

**RED 1** — 모델 · SQL 계약 테스트를 먼저 작성:
```
$ node --test lib/orders/model.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/orders/model.ts' imported from .../lib/orders/model.test.ts
ℹ pass 0 · fail 1
```
기대한 실패 — `model.ts`와 마이그레이션이 아직 없었다.

**GREEN 1** — `model.ts` + 마이그레이션 작성 후 `ℹ tests 24 · pass 24 · fail 0`.

**RED 2** — 화면용 이력 문장 · 배지 색 · 일시 테스트 2개를 추가:
```
SyntaxError: The requested module './model.ts' does not provide an export named 'allocationStatusTone'
ℹ pass 0 · fail 1
```
**GREEN 2**:
```
$ node --test lib/orders/model.test.ts
ℹ tests 26 · pass 26 · fail 0
$ npm test
ℹ tests 158 · pass 158 · fail 0
$ npm run build
✓ Compiled successfully … ƒ /orders 165 B · ƒ /orders/[orderId] 2.52 kB · ƒ /orders/new 2.5 kB · ƒ /allocations 128 B
$ git diff --check
(출력 없음)
```

## 변경 파일

- 신규: `supabase/migrations/20260911000600_stage1_sales_order_allocation.sql`, `lib/orders/model.ts`, `lib/orders/model.test.ts`, `lib/orders/repository.ts`, `lib/orders/actions.ts`, `components/orders/order-form.tsx`, `components/orders/allocation-table.tsx`, `app/(user)/orders/new/page.tsx`, `app/(user)/orders/[orderId]/page.tsx`
- 교체: `app/(user)/orders/page.tsx`, `app/(user)/allocations/page.tsx`, `app/(user)/allocations/priorities/page.tsx`
- 수정: `lib/menu.ts`(설명), `styles/components.css`(끝에 두 줄), `error.md`(#17 변형)

## 자체 검토에서 찾아 고친 것

1. **배정 합계 뷰의 조회 범위가 넓었다.** 처음에는 `core.v_item_allocation_qty`를 STOCK_VIEW_PAPER/SUPPLY에 품목 범위 없이 열었다. 임시 DB에서 마케팅이 소모품 배정 합계 8행을 읽는 것을 보고, 그 합계를 쓰는 뷰와 같은 범위(마케팅 = 용지 · 카드리더기, 서비스 = 소모품)로 좁혔다. 새 DB에서 전체 재검증.
2. **결과 알림이 Task 3 트리거에 지워질 뻔했다.** Task 3 `sync_approval_notifications`는 `payload ->> 'approval_id'`가 같은 PENDING 알림을 모두 취소한다. 결과 알림 payload에서 `approval_id` 키를 빼고 `priority_approval_id`로 두었다(S5에서 PENDING 4건 확인).
3. **승인 요청 우회 경로.** 누구나(ALLOC_MANUAL) `core.request_approval('ALLOC_PRIORITY', …)`를 직접 만들 수 있어, 확보 없는 요청이 승인 불가 · 10분 알림 무한 반복으로 남을 수 있었다 → BEFORE INSERT 가드 트리거.
4. **주문 취소 시 대기 중인 우선 배정 요청.** 그대로 두면 팀장 반복 알림이 계속된다 → 취소 경로에서 확보 해제 후 요청을 CANCELLED(이력 · 감사로그 포함).
5. **비활성 수신자.** `enqueue_notification`은 비활성 수신자에서 예외를 던져 업무 트랜잭션 전체를 되돌린다 → 주문 알림은 활성 수신자만 골라 예약.

## 우려 사항 (컨트롤러 판단 필요)

1. **마이그레이션 크기 2,284줄.** 계획대로 한 파일이며 절(1~13)로 나눴지만 크다. Task 6이 같은 파일을 더 늘린다. 재구성은 하지 않았다.
2. **확정 전 주문을 영업담당자가 취소하는 함수가 없다.** 브리프 함수 목록에 없어 만들지 않았다. stage1 §2 96행("주문이 반려 · 취소되면 임시배정 해제")은 확정배정 취소 경로로만 충족된다 — 거래가 무산된 주문의 임시배정은 30일 만료까지 재고를 잡는다.
3. **Task 6 만료와 FIRM · APPROVAL_HOLD의 공존.** 확정 전 주문에도 수동 FIRM이나 승인대기 확보가 있을 수 있다. 만료로 `EXPIRED`가 되면 그 FIRM/확보가 만료 주문에 남고, `cancel_firm_allocation`은 EXPIRED 주문을 거절한다. Task 6에서 (a) 임시배정만 해제하고 FIRM이 있으면 만료시키지 않을지 (b) 함께 해제할지 결정해야 한다. 배정 0건인 WAITING_FULL 주문을 +30일에 만료할지도 같다.
4. **수주 확정 권한** = `ORDER_CREATE` + 주문 등록자 본인(전용 권한 코드 없음).
5. **우선순위 척도** 1(최우선)~9(최후순), 기본 5는 stage1에 없는 설계 선택이다. 기본값은 DB 열 기본값과 `ALLOCATION_PRIORITY_DEFAULT`에 있고 계약 테스트가 둘을 묶는다.
6. **SCM 품목담당자 수신자** = ALLOC_MANUAL 권한의 활성 사용자 전원(품목별 담당자 마스터가 없음).
7. **WAIT_FULL은 주문 단위** — 한 품목이라도 부족하면 주문 전체 0 배정("요청 전체를 배정 대기").
8. **드문 교착** — `decide_approval`(승인 행 먼저)과 같은 주문의 `cancel_firm_allocation`이 동시에 오면 한쪽이 40P01로 되돌려진다(데이터 손상 없음, 재시도 필요).
9. **ATP 사용자의 core 직접 조회** — `core.v_item_allocation_qty`는 ATP_VIEW에 품목별 임시 · 확정 · 확보 합계를 보인다(analytics 화면은 가용재고만). Task 4의 `stock_balance` RLS와 같은 수준의 노출이다.
10. **Task 8 주의** — 취소된 주문도 `confirmed_order_no`를 유지한다. `CONFIRMED_ORDER` 집계는 반드시 `status = 'CONFIRMED'`로 거른다.
11. `core.urgent_order.status` 값(REQUESTED · IN_PROGRESS · COMPLETED · CANCELLED)은 Task 11이 조정할 수 있다. 주문 등록 시 품목 `사용여부`는 값 의미를 몰라 검사하지 않는다.

## Task 6이 호출할 계약 (내부 전용, security definer 안에서만)

- `core.lock_stock_balance_items(p_item_ids text[], p_require_all boolean)` — 잠금 1단계. **순서: 재고 행 → 주문 행 → 배정 행 → 승인 행**.
- `core.v_allocation_queue_line` — 대기 순번(`queue_rank`) 단일 정의. `allocation_choice`로 WAIT_FULL 판단.
- `core.allocate_to_order_line(p_line_id bigint, p_max_qty numeric, p_source text /* 'RECEIPT' */, p_actor uuid /* null=시스템 */) returns numeric` — 가능한 만큼 배정, 확정 주문이면 FIRM, 아니면 TEMPORARY(주문 만료 공유), 첫 임시배정이면 만료 예고 예약, 주문 상태 재계산 · 이력. WAIT_FULL 전량 조건은 호출자가 `p_max_qty`로 결정.
- `core.transition_stock_allocation(p_allocation_id, 'RELEASED', p_actor, p_reason, p_cause /* 'EXPIRED' */, p_payload)` — 해제 + 이력 + 줄 합계.
- `core.apply_sales_order_status(p_order_id)` · `core.log_sales_order_event(p_order_id, 'EXPIRED', prev, 'EXPIRED', actor, reason, payload)` — 만료 시 `status='EXPIRED'`, `expired_at` 기록(check 제약).
- `core.sales_order_notice_recipients(p_order_id, p_include_planners)` · `core.enqueue_order_notice(dedupe, template, recipients, payload)`.
- 만료 예고 series id = **`order_id::text`** → `core.enqueue_temporary_allocation_released(order_id::text, recipients)`.
- 가용재고 판정은 `core.item_committed_qty(item_id)`를 잠금 뒤에 부른다.

## 사용자가 Supabase에서 할 일

1. SQL Editor에서 `20260911000400`, `20260911000500`이 적용된 뒤 `supabase/migrations/20260911000600_stage1_sales_order_allocation.sql` 전체를 실행한다(다시 실행해도 안전).
2. 파일 끝 확인 쿼리 (a)~(g)로 뷰 보안 옵션, 초과 배정 0행, 줄 합계 일치, 만료일 변경 거절을 확인한다.
3. Exposed schemas는 이미 `core`, `analytics`면 추가 설정이 없다.
4. 실데이터에 분류된 재고가 아직 없으므로 적용 직후 `/orders/new`의 주문 가능 수량은 모두 `INVENTORY_SCOPE_UNCLASSIFIED`이고, 검토 요청은 그 사유로 거절된다 — 0으로 배정하지 않는 의도된 동작이다.

---

## pre-review fix — 확정 전 주문 취소 (커밋 `c8ee7dd`)

컨트롤러 판정: 우려 2(확정 전 주문 취소 부재)는 확정된 gap(stage1 §2 96행). 우려 3은 Task 6, 5는 Task 8로 넘김, 4는 그대로 수용, 1은 리뷰 판단.

### 변경

- **`core.cancel_sales_order(p_order_id uuid, p_reason text) returns uuid`** (공개, authenticated 실행)
  - `auth.uid()` 활성 사용자 + `ORDER_CREATE` + 주문 등록자 본인(수주 확정과 같은 소유 규칙), 사유 필수(`CANCEL_REASON_REQUIRED`).
  - 잠금: `core.lock_stock_balance_items`로 주문 전 품목의 재고 행을 품목코드 순으로 잠근 뒤 주문 행 `FOR UPDATE`.
  - 거절: `CONFIRMED` → `ORDER_ALREADY_CONFIRMED`, `CANCELLED/EXPIRED` → `ORDER_ALREADY_CLOSED`, FIRM 배정이 하나라도 있으면 해제 전에 `FIRM_ALLOCATION_EXISTS`(확정배정 취소 경로 안내).
  - 처리: 임시배정 · 승인대기 확보 전부 RELEASED(원인 `ORDER_CANCELLED`) → 확보에 연결된 PENDING `ALLOC_PRIORITY` 요청을 기존 `core.cancel_alloc_priority_approval`로 CANCELLED(승인 이력 · 감사로그, Task 3 트리거가 반복 알림 취소) → 주문 CANCELLED(취소 시각 · 취소자 · 사유) → 줄 합계 갱신(대기열에서 빠짐) → 만료 예고 series 취소 → 주문 이력 `CANCELLED`(`kind=ORDER_CANCELLED`, 해제 목록 · 해제 수량 · 취소한 승인 요청 수).
  - 작성 중(DRAFT) 주문도 취소할 수 있게 상태 전환표에 `DRAFT → CANCELLED`를 추가했다. 취소 주문은 기존대로 `copy_cancelled_order`로 재등록한다.
- **`core.release_order_allocations(p_order_id, p_actor, p_reason, p_cause) returns jsonb`** (내부 전용) — 활성 배정 해제 + 확보 승인 요청 취소 루프를 한 곳으로 모았다. `core.cancel_firm_allocation`도 이 함수를 쓰도록 바꿨고(동작 동일, 이력 payload에 `kind=FIRM_CANCELLED` 추가), S4 · S6 재검증으로 회귀 없음을 확인했다.
- 앱: `validateCancelOrder`, `orderActionsFor(...).canCancel`(DRAFT · 검토 단계이고 확정배정 0일 때), 이력 문장 `영업담당자 주문 취소 · 해제 수량 N`, `cancelSalesOrder` 저장소, `cancelSalesOrderAction`(첫 줄 `requirePermission('ORDER_CREATE')` → 형식 검증 → DB 결과만), 주문 상세에 등록자용 `CancelOrderForm` 카드.

### 덮는 테스트

- 모델 · SQL 계약(`lib/orders/model.test.ts`): 취소 입력 검증, `canCancel`(확정배정 20이면 false, CONFIRMED · CANCELLED · null false), 이력 문장, 공개 명령 권한 목록 · 재고 행 → 주문 행 잠금 순서 목록에 `cancel_sales_order` 추가, 본인 · 사유 · 확정/종료/FIRM 거절이 해제보다 먼저, 해제 함수가 승인 요청을 취소, `cancel_firm_allocation`이 같은 해제 함수 사용, DRAFT → CANCELLED 전환.
- 임시 DB 시나리오 S8(신규 품목 ITEMT07 · 08 · 09, 각 재고 100):
  - 임시 60 / 재고 100 → 남의 주문(42501 본인) · ORDER_CREATE 없는 품목담당자(42501) · 빈 사유(CANCEL_REASON_REQUIRED) 거절 → 취소 → 주문 가능 40 → **100**, 주문 CANCELLED · 사유 · 취소자, 배정 RELEASED + 해제 이력(ORDER_CANCELLED), 주문 이력(해제 수량 60 · 이전 상태 REVIEW_REQUESTED), 대기열 0행, 만료 예고 PENDING 0 → 재취소 `ORDER_ALREADY_CLOSED` → 재등록 가능, 재등록한 DRAFT 주문도 취소됨.
  - 승인대기 확보: 다품목 주문(ITEMT08 50 + ITEMT07 10)에 순서 건너뜀 확보 30 + 팀장 대기 알림 존재 → 등록자가 취소 → ITEMT08 주문 가능 **30**(130-100), ITEMT07 **100**, 요청 `PENDING → CANCELLED` + 승인 취소 이력 1건, APPROVAL_PENDING PENDING/PROCESSING 행 **0**, 이후 팀장 승인 `이미 처리되었거나 취소된`, 다른 주문 영향 없음.
  - 확정배정 있음: 확정 전 주문에 정상 순서 수동 FIRM 20 → 취소 `FIRM_ALLOCATION_EXISTS`, 수주 확정 주문 → `ORDER_ALREADY_CONFIRMED`, 거절 뒤 주문 상태 · 배정 2건 그대로.
- 불변식 파일의 "검토 요청된 주문" 조건을 `status <> 'DRAFT'`에서 `first_review_requested_at is not null`로 고쳤다. 이제 DRAFT에서 바로 CANCELLED가 되는 주문이 있어 오래된 조건이 실패했다(코드 결함 아님, 수정 뒤 새 DB에서 전체 재실행).

### 명령과 결과

```
$ node --test lib/orders/model.test.ts        # 테스트 먼저 추가
SyntaxError: The requested module './model.ts' does not provide an export named 'validateCancelOrder'
ℹ pass 0 · fail 1                               # RED — 구현 전 기대한 실패

$ node --test lib/orders/model.test.ts        # 구현 후
ℹ tests 28 · pass 28 · fail 0

# 새 임시 DB scm_task5_fix_20260912010637 (부트스트랩 → 0600 재적용 exit 0 · ERROR 0 → fixture)
scenarios exit=0 pass=141 s8=25
concurrency exit=0
재고 행 잠금을 기다리는 검토 요청 수: 2 (기대 2)   · C1 60+60 → 합계 100, 60/0 · 40/20
재고 행 잠금을 기다리는 검토 요청 수: 10 (기대 10)  · C2 합계 정확히 100, 실패 0
다른 품목 ITEMC02 요청: exit=0, 소요 0초          · C3 같은 품목은 statement timeout, DRAFT 유지
C4 게이트 없는 10건: 30,30,30,10,0×6 · 합계 100
불변식 8/8 PASS
dropped scm_task5_fix_20260912010637 (scm_task5% 0개)

$ npm test
ℹ tests 160 · pass 160 · fail 0
$ npm run build
✓ Compiled successfully … ƒ /orders/[orderId] 180 B · ƒ /orders 165 B · ƒ /orders/new 163 B
$ git diff --check
(출력 없음)
```

### 남은 우려

- 확보가 걸린 주문을 영업담당자가 취소하면 승인 요청의 `decided_by`가 영업담당자로 기록된다(요청 취소 처리자 = 주문 취소자). 승인 결정이 아니라 CANCELLED이므로 자기 승인 규칙과는 무관하다.
- 마이그레이션은 이 수정으로 2,393줄이 됐다(우려 1, 리뷰 판단).

---

## fix round 1 — 만료 시각 이후 차단 · DB 검증 스크립트 커밋 (커밋 `95a144c`)

리뷰 결과 Spec ✅ / Needs fixes: Important 1건 + 확인된 증거 공백 1건. 나머지 minor는 최종 리뷰로 미룸(변경 없음).

### 1. [Important] 만료 시각 이후에도 확정 · 임시배정이 되던 문제

**원인.** `confirm_sales_order`와 `allocate_to_order_line`이 `clock_timestamp() < temporary_expires_at`을 확인하지 않았다. 만료 시각과 Task 6 자동 해제 작업 사이에 영업담당자가 이미 만료된 임시배정을 확정(FIRM, 만료 없음)으로 바꿀 수 있었고, 후속 배정 계약 함수는 만료된 주문에 새 TEMPORARY를 만들었다(만료 예고는 전부 과거라 취소되어 아무에게도 알리지 않음) — stage1 §2 44 · 46행 위반.

**수정 (`20260911000600`, +45줄).** 확정 전 주문에서 `clock_timestamp() >= temporary_expires_at`이면 `TEMPORARY_ALLOCATION_EXPIRED`(SQLSTATE 55000)로 거절한다.

| 경로 | 차단 |
|---|---|
| `core.confirm_sales_order` | 상태 확인 직후 만료 시각 확인 → 수주 확정 거절 |
| `core.allocate_to_order_line` | 주문이 CONFIRMED가 아니면(=TEMPORARY 분기) 거절. CONFIRMED 주문의 FIRM 후속 배정은 그대로 |
| `core.create_stock_allocation` | `p_status = 'TEMPORARY'`이고 주문이 확정 전이면 거절 — 모든 임시배정 생성의 중앙 방어 |
| `core.transition_stock_allocation` | `TEMPORARY → FIRM` 전환만 거절. 해제(RELEASED)는 언제든 허용(Task 6 자동 해제용) |
| `core.request_order_review` | 만료 시각이 이미 기록된 주문이면 거절(DRAFT는 check 제약상 만료가 비어 있어 방어 코드) |

수동 FIRM(`request_manual_allocation` 정상 순서)과 승인대기 확보(생성 · 승인 → FIRM)는 시간 제한을 두지 않았다(stage1 §2 68 · 83행). 계약 테스트가 이 네 함수에 `TEMPORARY_ALLOCATION_EXPIRED`가 없음을 고정한다. 마이그레이션 머리말의 Task 6 계약에 "만료된 확정 전 주문은 `allocate_to_order_line`이 예외를 던지므로 신규 입고 배정은 먼저 해제하거나 건너뛴다"를 적었다.

### 2. [증거 공백] DB 시나리오 · 동시성 · 불변식 스크립트를 저장소에 커밋

`supabase/tests/sales_order_allocation/` — README에 실행 · 안전장치 · 정리 방법을 적었다.

| 파일 | 내용 |
|---|---|
| `run-all.sh` | 임시 DB 생성 → fixture → 시나리오 → 동시성 → 불변식 → 요약, `trap cleanup EXIT`로 성공 · 실패 · 중단 모두 `dropdb`(`KEEP_DB=1`로 유지 가능), 로그는 `LOG_DIR`(기본 mktemp) |
| `bootstrap.sh` | 클러스터 역할(없을 때만 nologin) → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션 → 0600 재적용 |
| `lib.sh` · `guard.psql` | DB 이름 `scm_test_*`, `PGHOST`는 소켓 디렉터리 · localhost만, `PGHOSTADDR`/`PGSERVICE` 설정 시 거절. 모든 `.psql`은 `\ir guard.psql`로 시작해 DB 이름 · 루프백 접속을 다시 확인 |
| `auth-stub.psql` · `fixtures.psql` | 테스트 전용 auth 스텁, 사용자 7명 · 품목 · 재고와 헬퍼 스키마 `order_test` |
| `scenarios.psql` | S2~S8(기존) + **S9 만료 시각 이후 차단** |
| `concurrency.sh` | C1~C4. 잠금 대기 수(2 · 10)도 이제 출력만이 아니라 PASS/FAIL로 판정 |
| `invariants.psql` | 불변식 8종 |

- 접속 정보 없음(계약 테스트가 `PGPASSWORD=` · `password=` · `supabase.co` · `sb_secret_` · `postgres://` 부재를 확인).
- `.sql`이 아니라 `.psql` 확장자 — `supabase test db`(pg_prove)가 이 폴더를 테스트로 실행하지 않게 했다.
- 스크래치 사본에서 옮기며 헬퍼 스키마 이름만 `t5` → `order_test`로 바꿨고, S9 fixture 품목 ITEMT10을 추가했다.

**S9 구성 (테스트 전용 경로).** 최초 검토 요청 시각을 "지금 − 30일 + 5초"로 처음 한 번 기록해 5초 뒤 만료되는 주문 두 건(EX 80, NB 20)을 만든다 — 만료일 불변 트리거는 null에서 처음 채우는 것을 허용하므로 트리거를 끄지 않았고, `만료 = 최초 검토 요청 + 30일`과 검토 요청 이력도 유지된다.
만료 전 후속 임시배정 60 · 20 생성 → NB 수주 확정 성공(만료 직전) → 만료 시각까지 대기 → EX 수주 확정 · `allocate_to_order_line` · `create_stock_allocation(TEMPORARY)` · `transition_stock_allocation(TEMPORARY→FIRM)` 모두 `TEMPORARY_ALLOCATION_EXPIRED`, 기존 임시배정 60 그대로 → 정상 순서 수동 FIRM 10 허용 → 다른 주문 우선순위를 1로 올린 뒤 순서 건너뜀 확보 5 생성 · 팀장 승인 → FIRM 허용(FIRM 합 15).

**안전장치 확인.**
```
$ psql -d postgres -f supabase/tests/sales_order_allocation/guard.psql
ERROR:  supabase/tests는 로컬 임시 DB(scm_test_*)에서만 실행합니다. 현재 DB: postgres      (exit 3)
$ bash supabase/tests/sales_order_allocation/run-all.sh postgres
거절: 검증 DB 이름은 scm_test_로 시작해야 합니다 (postgres).                              (exit 2)
$ PGHOST=db.example.supabase.co bash …/run-all.sh
거절: 로컬 PostgreSQL(유닉스 소켓 디렉터리 또는 localhost)에서만 실행합니다 …               (exit 2)
$ PGHOSTADDR=10.0.0.1 bash …/run-all.sh
거절: PGHOSTADDR 또는 PGSERVICE가 설정된 셸에서는 실행하지 않습니다(원격 접속 우회 방지).   (exit 2)
```

### 명령과 결과

```
$ node --test lib/orders/model.test.ts        # 계약 테스트 먼저 추가
✖ 만료 시각이 지난 확정 전 주문은 임시배정 생성 · 확정 전환 · 수주 확정을 거절하고 수동 FIRM · 확보는 막지 않는다
ℹ tests 30 · pass 29 · fail 1                  # RED — 마이그레이션에 만료 확인이 없어 기대한 실패

$ node --test lib/orders/model.test.ts        # 수정 후
ℹ tests 30 · pass 30 · fail 0

$ bash supabase/tests/sales_order_allocation/run-all.sh      # 커밋된 파일에서 실행
DB: scm_test_order_alloc_20260912012753 · 로그: …/T//scm_test_order_alloc.Eoz6JU
bootstrap 완료: scm_test_order_alloc_20260912012753 (마이그레이션 전체 적용 + 20260911000600_stage1_sales_order_allocation.sql 재적용)
scenarios:   PASS 153 · FAIL/ERROR 0
  S2 PASS 12
  S3 PASS 9
  S4 PASS 29
  S5 PASS 24
  S6 PASS 16
  S7 PASS 26
  S8 PASS 25
  S9 PASS 12
concurrency: PASS 16 · FAIL/ERROR 0
  PASS: C1 재고 행 잠금을 기다리는 검토 요청 수 (2)
  PASS: C2 재고 행 잠금을 기다리는 검토 요청 수 — 10건이 동시에 진행 중 (10)
  PASS: C2 동시 10건 → 배정 합계 정확히 100 (초과 0)
  PASS: C4 동시 10건 → 배정 합계 정확히 100
  PASS: C4 선착순 30·30·30·10, 나머지 0 + 부족 표시
invariants:  PASS 8 · FAIL/ERROR 0
결과: 전부 통과
삭제: scm_test_order_alloc_20260912012753
run-all exit=0        (이후 scm_test_% DB 0개)

$ npm test
ℹ tests 162 · pass 162 · fail 0
$ npm run build
✓ Compiled successfully … ƒ /orders/[orderId] 180 B · ƒ /orders 165 B · ƒ /orders/new 163 B
$ git diff --check
(출력 없음)
```

### 남은 우려

- **만료된 확정 전 주문에 수동 FIRM만 남는 경우.** 판정대로 수동 FIRM · 확보는 만료 뒤에도 허용되고 Task 6 판정은 "FIRM/확보가 남은 주문은 EXPIRED로 만들지 않는다"이다. 그런데 이제 수주 확정은 만료 뒤 거절되므로, 이런 주문은 확정할 방법이 없고 SCM 품목담당자의 확정배정 취소로만 끝난다. 의도라면 그대로, 아니라면 "임시배정이 없는 주문의 확정은 만료와 무관" 같은 예외 판정이 필요하다.
- `allocate_to_order_line`은 만료 주문에서 0을 돌려주지 않고 예외를 던진다(지시대로 거절). Task 6의 입고 배정 루프가 만료된 확정 전 주문을 걸러내지 않으면 입고 트랜잭션 전체가 되돌려진다 — 머리말 계약에 적었다.

### fix round 1 adjustment — 수주 확정 만료 차단 범위 축소 (커밋 `56b0726`)

컨트롤러 판정(위 우려 1): stage1 §2의 30일 규칙은 임시배정에만 적용된다(68 · 97행 — 수동 FIRM은 만료 없음). 수주 확정은 만료 시각이 지났고 **해제되지 않은 TEMPORARY가 남아 있을 때만** 거절한다. 남은 배정이 FIRM · 승인대기 확보뿐이면 만료 뒤에도 확정한다(최종 주문번호 기록 → CONFIRMED, 남은 부족수량은 대기열 유지, 이후 배정은 FIRM). 우려 2는 Task 6으로 넘김(변경 없음).

**변경.**
- `core.confirm_sales_order`: `clock_timestamp() >= v_order.temporary_expires_at and exists (… a.status = 'TEMPORARY')`일 때만 `TEMPORARY_ALLOCATION_EXPIRED`. 잠금(재고 행 → 주문 행) 뒤, 상태 확인 직후에 판정한다.
- 나머지 round 1 차단은 그대로: `allocate_to_order_line`(TEMPORARY 분기) · `create_stock_allocation(TEMPORARY)` · `transition_stock_allocation(TEMPORARY → FIRM)` · `request_order_review` 방어 확인. 따라서 만료 주문에 TEMPORARY가 남아 있으면 확정 경로의 전환도 여전히 막힌다.
- 마이그레이션 머리말 계약 문구를 같은 범위로 고쳤다.
- 계약 테스트: 확정 차단 식에 `exists (… a.status = 'TEMPORARY')`가 있어야 한다.
- 커밋된 검증 스위트: fixture 품목 ITEMT11(재고 100), 시나리오 **S10** 추가, `run-all.sh` 요약 · README에 S10 반영.

**S10 구성.** S9와 같은 테스트 전용 경로로 5초 뒤 만료되는 FA(50) · FB(40)를 만들고, 만료 전 FB에만 후속 임시배정 20을 만든 뒤 만료 시각까지 기다린다.
- (a) FA에 만료 뒤 정상 순서 수동 FIRM 30 → 수주 확정 **성공**(`ERP-FIRM-ONLY`, 만료 시각 경과 상태에서), FIRM 30 · 부족 20, 대기 순번 유지, 확정 뒤 후속 배정 10은 FIRM, FA에는 TEMPORARY 생성 이력이 한 건도 없음.
- (b) FB 우선순위를 1로 올려 정상 순서 수동 FIRM 10 → 임시 20 + FIRM 10이 남은 상태로 수주 확정 **거절**(`TEMPORARY_ALLOCATION_EXPIRED`), 주문 · 임시 20 · FIRM 10 그대로.
- (c) Task 6 자동 해제 대역으로 기존 해제 경로 `core.transition_stock_allocation(…, 'RELEASED', null, '임시배정 만료 자동 해제(검증 대역)', 'EXPIRED')` + `core.apply_sales_order_status`로 FB 임시배정만 해제 → 수주 확정 **성공**(`ERP-FB`), FIRM 10 · 부족 30 대기, 해제된 임시배정은 RELEASED 유지(확정으로 전환되지 않음).

**명령과 결과.**
```
$ node --test lib/orders/model.test.ts        # 계약 테스트 먼저 강화
✖ 만료 시각이 지난 확정 전 주문은 임시배정 생성 · 확정 전환 · 수주 확정을 거절하고 수동 FIRM · 확보는 막지 않는다
  AssertionError [ERR_ASSERTION]: 수주 확정은 만료 시각 뒤에도 해제되지 않은 임시배정이 남아 있을 때만 거절합니다(FIRM · 확보만 남은 주문은 확정 가능).
ℹ tests 30 · pass 29 · fail 1                  # RED — 확정 차단이 TEMPORARY 존재를 보지 않아 기대한 실패

$ bash supabase/tests/sales_order_allocation/run-all.sh      # 같은 시점, 커밋된 파일에서 실행
scenarios:   PASS 156 · FAIL/ERROR 1
  S10 PASS 3
psql:…/scenarios.psql:466: ERROR:  TEMPORARY_ALLOCATION_EXPIRED: 임시배정 만료 시각(2026-09-12 01:32:58.714049+09)이 지난 주문은 수주 확정할 수 없습니다. …
결과: 실패                                     # RED — S10 (a) FIRM만 남은 만료 주문 확정이 거절됨
삭제: scm_test_order_alloc_20260912013246

$ node --test lib/orders/model.test.ts        # 수정 후
ℹ tests 30 · pass 30 · fail 0

$ bash supabase/tests/sales_order_allocation/run-all.sh      # 수정 후, 커밋된 파일에서 실행
DB: scm_test_order_alloc_20260912013356 · 로그: …/T//scm_test_order_alloc.A6uWeP
bootstrap 완료: scm_test_order_alloc_20260912013356 (마이그레이션 전체 적용 + 20260911000600_stage1_sales_order_allocation.sql 재적용)
scenarios:   PASS 166 · FAIL/ERROR 0
  S2 PASS 12
  S3 PASS 9
  S4 PASS 29
  S5 PASS 24
  S6 PASS 16
  S7 PASS 26
  S8 PASS 25
  S9 PASS 12
  S10 PASS 13
concurrency: PASS 16 · FAIL/ERROR 0
  PASS: C1 재고 행 잠금을 기다리는 검토 요청 수 (2)
  PASS: C2 재고 행 잠금을 기다리는 검토 요청 수 — 10건이 동시에 진행 중 (10)
  PASS: C2 동시 10건 → 배정 합계 정확히 100 (초과 0)
  PASS: C4 동시 10건 → 배정 합계 정확히 100
  PASS: C4 선착순 30·30·30·10, 나머지 0 + 부족 표시
invariants:  PASS 8 · FAIL/ERROR 0
결과: 전부 통과
삭제: scm_test_order_alloc_20260912013356
run-all exit=0        (이후 scm_test_% DB 0개)

$ npm test
ℹ tests 162 · pass 162 · fail 0
$ npm run build
✓ Compiled successfully … ƒ /orders/[orderId] 180 B · ƒ /orders 165 B · ƒ /orders/new 163 B
$ git diff --check
(출력 없음)
```

**남은 우려.** 위 fix round 1의 우려 1은 이 판정으로 해소됐다. 우려 2(`allocate_to_order_line`이 만료 주문에서 예외)는 Task 6 판정으로 넘어갔다.
