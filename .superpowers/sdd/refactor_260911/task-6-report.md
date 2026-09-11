# Task 6 · 자동 만료와 입고 후 후속 배정 — 구현 보고

BASE `56b0726`(Task 5 최종) · 커밋 `d5fbc9d`

## 무엇을 만들었나 (판정별)

### 파일 목록(브리프 대비 변경 — 컨트롤러 판정 1)

브리프는 "같은 마이그레이션 확장(20260911000600)"을 지시했지만, 컨트롤러 판정 1에 따라
**새 파일** `supabase/migrations/20260911000610_stage1_allocation_jobs.sql`에 이번 작업의
SQL을 전부 담았다(0600은 이미 2,393줄). 0600의 함수는 하나도 다시 정의하지 않았다 — 필요한
훅이 전부 새 함수이거나 Task 4/0500의 `core.apply_stock_receipts_from_batch` 재정의였다.

- 신규: `supabase/migrations/20260911000610_stage1_allocation_jobs.sql`
- 신규: `app/api/cron/allocations/route.ts`
- 신규: `lib/orders/jobs.ts`, `lib/orders/jobs.test.ts`
- 수정: `vercel.json`(Cron 항목 추가)
- 수정: `docs/notification-operations.md`(새 Cron 운영 기준 한 단락)
- 수정: `supabase/tests/sales_order_allocation/{bootstrap.sh,concurrency.sh,fixtures.psql,invariants.psql,run-all.sh,scenarios.psql,README.md}`
- 수정: `error.md`(#20 변형 — 새 오류 아님, 같은 원인의 재발)

### DB — `20260911000610_stage1_allocation_jobs.sql`

| 객체 | 판정 | 구현 |
|---|---|---|
| `core.expire_temporary_allocations(p_now)` | 2, 3, 8 | 후보: 상태 REVIEW_REQUESTED/PARTIALLY_ALLOCATED/WAITING_FULL, `clock_timestamp() >= temporary_expires_at`, "TEMPORARY 있음" 또는 "TEMPORARY·APPROVAL_HOLD·FIRM 전혀 없음"(이 조건 때문에 이미 FIRM만 남은 주문은 재실행 때 후보에서 빠진다). 주문별 `BEGIN…EXCEPTION`(암묵적 SAVEPOINT)으로 TEMPORARY만 해제 → 남은 FIRM·APPROVAL_HOLD 0건이면 EXPIRED, 아니면 `apply_sales_order_status`로 재계산하고 상태 유지. 완료 알림은 `released_qty > 0`일 때만 발송(`enqueue_temporary_allocation_released`, dedupe로 재실행 시 중복 없음). 실패는 삼키지 않고 결과 행(`outcome='FAILED', error_message`)으로 보고 |
| `core.allocate_new_stock(p_item_id, p_receipt_id)` | 4, 5, 7 | `p_receipt_id`(=`stock_receipt_ledger.ledger_id`) 수량을 `core.v_allocation_queue_line` 순번대로 소진. 확정 전 만료 주문은 사전 확인으로 건너뛰고(+ 55000 예외 방어 이중화), 확정 전 WAIT_FULL은 남은 수량이 부족분 전체를 못 채우면 스킵, CONFIRMED는 선택 방식 무관하게 채움. 1건 이상 배정될 때마다 `enqueue_auto_allocation_notice`(주문번호·품목·배정수량·남은부족·배정시각) |
| `core.notify_manual_allocation_needed` / `core.list_manual_allocation_candidates` | 6 | 전자는 ALLOC_MANUAL 활성 사용자 전원에게 품목·입고수량만 알림. 후자는 `v_allocation_queue_line`을 그대로 읽어 대기 순번만 반환(계산·쓰기 없음), ALLOC_MANUAL 권한 검사 포함 |
| `core.apply_stock_receipts_from_batch`(재정의, Task 4/0500) | 4 | 새로 반영된 원장 행(`insert … on conflict do nothing returning`)마다 `core.item_policy.allocation_mode`(없으면 AUTO)로 분기해 AUTO/MANUAL 훅을 정상 창고재고 재계산 뒤 호출. `core.commit_import_batch`는 그대로라 STEP4/Task4 커밋 경로에서 자동으로 이어받는다 |

### 앱 — Cron

`app/api/cron/allocations/route.ts`는 Task 3의 `isAuthorizedCronRequest`를 재사용해
`CRON_SECRET`을 검증하고 `core.expire_temporary_allocations`만 호출한다(만료 판정·해제·
알림은 전부 DB 트랜잭션 안). `lib/orders/jobs.ts`는 RPC 결과 행을 카멜케이스로 정규화하고
outcome별로 집계(`processed/expired/released/failed/failedOrders`)하는 순수 함수만 담는다 —
계산 없이 DB가 돌려준 값만 옮긴다(AGENTS.md 2조). 실패 건이 있으면 500으로 응답해 Cron
모니터링이 놓치지 않게 한다. `vercel.json`에 같은 10분 주기로 등록했다.

## 테스트와 결과

### 커밋된 DB 스위트 (`supabase/tests/sales_order_allocation/run-all.sh`)

```
$ bash supabase/tests/sales_order_allocation/run-all.sh
bootstrap 완료: … (마이그레이션 전체 적용 + 20260911000600 · 20260911000610 재적용)
scenarios:   PASS 208 · FAIL/ERROR 0
  S2 PASS 12 · S3 PASS 9 · S4 PASS 29 · S5 PASS 24 · S6 PASS 16 · S7 PASS 26 · S8 PASS 25
  S9 PASS 12 · S10 PASS 13 · S11 PASS 21 · S12 PASS 14 · S13 PASS 7
concurrency: PASS 26 · FAIL/ERROR 0
  PASS: C1 재고 행 잠금을 기다리는 검토 요청 수 (2)
  PASS: C2 재고 행 잠금을 기다리는 검토 요청 수 — 10건이 동시에 진행 중 (10)
  PASS: C2 동시 10건 → 배정 합계 정확히 100 (초과 0)
  PASS: C4 동시 10건 → 배정 합계 정확히 100
  PASS: C4 선착순 30·30·30·10, 나머지 0 + 부족 표시
invariants:  PASS 10 · FAIL/ERROR 0
결과: 전부 통과
삭제: scm_test_order_alloc_…
```

(2회 연속 실행 확인, 매번 `scm_test_%` DB 0개로 정리됨.)

**S11 (만료 경계·재실행·FIRM 유지·배정 0건)** — ITEMT20/21/22, 최초 검토 요청 시각을 소급해
6초 뒤 만료되는 주문 셋을 만든다(S9·S10과 같은 테스트 전용 경로).
- 경계 직전: `expire_temporary_allocations()`를 불러도 세 주문 모두 결과에 없음(0건), G1의
  TEMPORARY는 그대로.
- 경계 이후 1회차: G1(임시 40만) → EXPIRED, G2(임시 20 + 수동 FIRM 10) → RELEASED(주문은
  EXPIRED로 끝나지 않음, FIRM 10 유지, 부족수량 30-10=20으로 재계산), G3(WAIT_FULL·배정
  0건) → EXPIRED(대기열 이탈). G1은 완료 알림 발송, G3은 해제한 것이 없어 알림 0건.
- 재실행: 세 주문 모두 더 이상 후보가 아님(0건) — 이중 해제·이중 만료 없음. G1 완료 알림
  건수는 1회차와 재실행 뒤가 같음(dedupe_key로 중복 없음).

**S12 (입고 후 AUTO 후속 배정)** — ITEMT24(재고 0), 부족만 쌓인 주문 넷(I1 25·H1 30·H2
20 WAIT_FULL·H3 50). I1을 최우선(1)으로 올려 수주 확정(부족 25는 대기열에 남음). 별도 품목
ITEMT26으로 "만료된 확정 전 주문은 건너뛰고 입고 커밋은 성공"을 먼저 확인(K1 만료 후
건너뜀 → K2 정상 배정). 본 입고 45: I1(CONFIRMED·최우선) FIRM 25 전량 → H1(PARTIAL) 임시
20(부족 10 유지, 순번 그대로) → H2(WAIT_FULL)는 남은 재고(0)가 전량 20에 못 미쳐 스킵 →
H3은 재고 소진으로 0. 배정 합계 45(초과 없음), I1·H1에 자동 배정 알림(주문번호·품목·배정
수량·남은부족·배정시각), H2·H3은 배정이 없어 알림 없음.

**S13 (MANUAL 품목)** — ITEMT25(MANUAL), 부족 15인 주문 J1. 입고 15 커밋해도
`temporary_allocated_qty=0`·부족 15 그대로, `stock_allocation`에 RECEIPT 배정 0건, 정상
창고재고는 15로 반영(원장은 AUTO/MANUAL 무관하게 항상 반영), SCM 품목담당자에게 처리 필요
알림(품목·입고수량) 발송. `core.list_manual_allocation_candidates('ITEMT25')`는 J1을 1순위·
부족 15로만 보여주고(계산·쓰기 없음), ALLOC_MANUAL 권한 없는 사용자는 거절.

**C5 (동시성 — 만료·입고·검토 요청)** — ITEMCJ01. 배정만 있는 주문(TEMPORARY 60, 부족
0)을 4초 뒤 만료로 소급한 뒤, `core.expire_temporary_allocations()` · 신규 입고 20 커밋
· 새 검토 요청(15)을 세 프로세스로 동시에 실행. 셋 다 exit 0, 배정 합계가 정상 창고재고를
넘지 않음(초과 배정 없음), L1은 결국 EXPIRED로 정리됨. 세 경로 모두 `core.stock_balance`
행을 먼저 잠그는 단일 자원 경합이라(Task 5 잠금 순서) 순환 대기가 없고, 40P01 대신 행 잠금
대기로만 직렬화된다.

**C6 (동시성 — 한 주문 실패가 다른 주문을 막지 않음)** — ITEMCJ02(M1)·ITEMCJ03(M2), 둘 다
4초 뒤 만료로 소급. ITEMCJ02 재고 행을 3초 잠근 채 `set lock_timeout='1s'`로
`expire_temporary_allocations()`를 부르면: M1은 `55P03`(lock_timeout)으로 `FAILED`(오류
메시지에 잠금 대기 초과 기록), 같은 호출에서 다른 품목 M2는 정상 `EXPIRED`. M1의 임시배정은
해제되지 않고 그대로 TEMPORARY(서브트랜잭션 롤백 확인). 잠금이 풀린 뒤 재시도(다음 Cron
회차 대역)하면 M1도 정상 EXPIRED — 실패가 영구적이지 않음을 확인.

### 앱 단위 테스트

```
$ node --test lib/orders/jobs.test.ts
✔ normalizeExpiryJobRow는 DB 행을 카멜케이스로 정규화한다
✔ normalizeExpiryJobRow는 예상치 못한 outcome을 FAILED로 취급한다
✔ summarizeExpiryJobRows는 결과 건수를 outcome별로 센다
✔ summarizeExpiryJobRows는 빈 배열이면 0건으로 요약한다
✔ Cron 라우트는 CRON_SECRET을 검증하고 core.expire_temporary_allocations만 호출한다
ℹ tests 5 · pass 5 · fail 0

$ npm test
ℹ tests 167 · pass 167 · fail 0   (Task 5 종료 시점 162 + jobs.test.ts 5)

$ npm run build
✓ Compiled successfully … ƒ /api/cron/allocations 193 B

$ git diff --check
(출력 없음)
```

## TDD 증거

**RED** — `lib/orders/jobs.test.ts`를 먼저 작성하고 실행:
```
$ node --test lib/orders/jobs.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib' … (jobs.ts가 아직 없음)
ℹ tests 1 · pass 0 · fail 1
```

**GREEN** — `lib/orders/jobs.ts` + `app/api/cron/allocations/route.ts` 작성 후:
```
$ node --test lib/orders/jobs.test.ts
ℹ tests 5 · pass 5 · fail 0
```

**DB RED/GREEN 1** — S11을 먼저 작성해 실행하자 새 함수의 SQL 버그(42702 column reference
"order_id" is ambiguous, error.md #20 변형)로 실패:
```
psql:…/scenarios.psql:580: ERROR: FAIL: S11 1회차 G1 EXPIRED 1건
```
`perform core.lock_stock_balance_items… / update core.sales_order … where order_id = …`에
테이블 별칭을 붙여 수정 후 재실행 → 통과.

**DB RED/GREEN 2** — 실패 격리를 `core.lock_stock_balance_items(…, false)`가 관용하는
INVENTORY_SCOPE_UNCLASSIFIED로 강제하려 했으나(재고 분류 행 삭제), `false` 인자라 예외가
나지 않아 항상 성공으로 끝나는 것을 발견(설계가 아니라 검증 시나리오의 오류) →
`p_require_all=false`는 Task 5의 `cancel_sales_order`와 같은 의도된 설계이므로 유지하고,
대신 `lock_timeout` 기반의 실제 잠금 대기 실패(concurrency.sh C6)로 시나리오를 다시
설계했다. 동시에 계산 실수(G2 부족수량 기대값 10 → 올바르게는 20)도 이 라운드에서 잡았다.
```
$ bash supabase/tests/sales_order_allocation/run-all.sh
scenarios:   PASS 181 · FAIL/ERROR 1
psql:…scenarios.psql:575: ERROR: FAIL: S11 G2 부족수량 10으로 재계산
```
수정 후:
```
scenarios:   PASS 208 · FAIL/ERROR 0
concurrency: PASS 26 · FAIL/ERROR 0
invariants:  PASS 10 · FAIL/ERROR 0
결과: 전부 통과
```

## 자체 검토에서 찾아 고친 것

1. **`42702 column reference "order_id" is ambiguous`(error.md #20 변형).**
   `returns table (order_id …)` 함수 안에서 별칭 없는 `where order_id = …`가 출력 변수와
   충돌했다 — 테이블 별칭으로 고치고 error.md에 새 변형으로 기록했다.
2. **실패 격리 시나리오 설계 오류.** `INVENTORY_SCOPE_UNCLASSIFIED`를 유발하려던 첫 설계는
   `lock_stock_balance_items`의 `p_require_all=false`(Task 5의 의도된 설계, `cancel_sales_order`와
   동일) 때문에 절대 실패하지 않았다 — 발견 즉시 실제 잠금 대기(`lock_timeout`)로 대체했다.
3. **부족수량 재계산 기대값 오류.** 임시 20을 해제한 뒤 남는 것은 FIRM 10뿐이므로 부족수량은
   `요청 30 − FIRM 10 = 20`이지 "해제 직전 부족 10"이 아니다 — 테스트 기대값을 고쳤다.
4. **bash 유니코드 변수 결합 버그(기존 파일, 이번에 처음 발동).** `concurrency.sh`의
   `"…: $FAILURES건"`이 실패 건수가 처음으로 1 이상이 되는 순간(C6에서 의도적으로 실패를
   만들면서) `FAILURES건: unbound variable`로 죽었다(한글 바이트가 변수명 일부로 잘못
   해석됨). `${FAILURES}건`으로 중괄호를 붙여 고쳤다 — Task 5까지는 FAILURES가 항상 0이라
   드러나지 않았던 잠재 버그다.
5. **`clock_timestamp()` 이중 호출로 만료일 불변식 위반.** C5 초안에서
   `first_review_requested_at`과 `temporary_expires_at`을 한 UPDATE 안에서 각각
   `clock_timestamp() - interval …`로 따로 계산해 미세하게 값이 달라졌다(`INV 모든 주문
   만료 = 최초 검토 요청 + 30일` 위반). 한 번만 계산해 두 열에 같은 값을 쓰도록 고쳤다.
6. **`bootstrap.sh`·`run-all.sh` 재실행 안전성 확인 범위.** 0610도 0600처럼 재적용
   단계를 추가해(`TARGET_MIGRATION_2`) 부트스트랩이 두 파일 모두의 재실행 안전성을
   검증하게 했다.

## 우려 사항 (컨트롤러 판단 필요)

1. **`core.list_manual_allocation_candidates`를 소비하는 화면이 없다.** 브리프 파일
   목록에 화면이 없어 만들지 않았다(YAGNI). SCM 품목담당자는 지금 이 함수를 SQL로만 쓸 수
   있다 — 다음 태스크에서 `/allocations`류 화면에 붙일 필요가 있으면 알려달라.
2. **자동 배정 알림 · 처리 필요 알림에는 이메일 렌더링 커스터마이즈가 없다.**
   `lib/notifications/email.ts`의 `renderNotificationEmail`은 payload의 `title`·`message`만
   범용으로 쓰므로 별도 처리를 추가하지 않았다(기존 패턴 재사용, Task 3 계약 그대로).
3. **입고 수량이 초대량(품목당 대기 주문이 수백 건)인 경우 `allocate_new_stock`의 순차
   루프가 길어질 수 있다.** 현재 실데이터 규모(SCHEMA.md·AGENTS.md 메모리 참고: 실데이터에
   재고·리드타임 자체가 없다)에서는 발생하지 않는 문제라 최적화하지 않았다.
4. **`core.apply_stock_receipts_from_batch` 재정의로 함수 OID는 유지되지만, Supabase에
   이미 적용된 원격 DB가 있다면 0610을 반드시 0600 이후·0500 이후 순서로 적용해야 한다**
   (파일명이 이미 그 순서를 보장한다).

## 사용자가 Supabase에서 할 일

1. SQL Editor에서 `20260911000600`이 이미 적용된 뒤 `supabase/migrations/20260911000610_stage1_allocation_jobs.sql`
   전체를 실행한다(다시 실행해도 안전).
2. Vercel 환경변수(`CRON_SECRET`, `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`)는
   Task 3에서 이미 설정했다면 추가 설정이 없다 — `/api/cron/allocations`가 같은 값을 쓴다.
3. `vercel.json`의 10분 Cron 두 개(알림·배정 만료)는 Vercel Pro 이상이거나 동등한 외부
   스케줄러가 필요하다(`docs/notification-operations.md` 참고, Task 3부터 있던 제약).
4. 실데이터에는 아직 분류된 재고·`item_policy.allocation_mode` 설정이 없으므로, 적용
   직후에는 만료 후보가 있어도 정상 동작하지만 AUTO 후속 배정은 대기 주문이 없는 한
   눈에 띄는 변화가 없다.
