# Task 11 리포트 — 부서별 운영 화면과 권한 범위 완성

## 요약

브리프의 화면별 범위표 6줄 중 4줄(마케팅 재고, 서비스 재고, 영업 주문/ATP, 사업강화부 우선순위)은
Task 4~6이 이미 만든 화면 · 뷰로 완전히 충족되어 있었다. 이번 작업은 실제로 비어 있던 두 가지만
채웠다 — (1) 긴급발주 등록 · 수정 · 상태 변경 경로와 화면(`/urgent-orders`), (2) SCM 품목담당자
배정 화면에 `core.list_manual_allocation_candidates`(Task 6가 만들고 아무도 부르지 않던 함수) 연결.
컨트롤러 판정 1~3을 그대로 따랐다.

## 브리프 화면별 범위표 — 이미 충족된 것과 새로 만든 것

| 사용자 | 화면 | 상태 | 근거 |
|---|---|---|---|
| 마케팅부 | 재고(용지·카드리더기) | **이미 충족** | `app/(user)/inventory/page.tsx` + `analytics.v_available_stock`(`supabase/migrations/20260911000500_...sql:560-589`)이 `STOCK_VIEW_PAPER` + `visibility_scope='PAPER_CARD_READER'`로 이미 제한 |
| 마케팅부 | 수요 제출 | **이미 충족** | `app/(user)/demand-submissions/page.tsx`(Task 7/8), RLS가 제출 부서 범위를 가름 — 이번 작업 범위 밖 |
| 서비스부 | 재고(소모품) | **이미 충족** | 위와 같은 뷰, `STOCK_VIEW_SUPPLY` + `visibility_scope='CONSUMABLE'` |
| 서비스부 | 긴급발주 | **신규** | `app/(user)/urgent-orders/page.tsx`, `core.create_urgent_order` 등(아래 상세) |
| 서비스부 | 수요 제출 | **이미 충족** | 마케팅부와 동일 경로 |
| 영업부 | 주문, ATP | **이미 충족** | `app/(user)/orders/*`, `analytics.v_order_available_stock`(Task 4·5)이 임시·확정·승인대기를 이미 차감 |
| 사업강화부 | 배정 우선순위 | **이미 충족** | `app/(user)/allocations/priorities/page.tsx` + `AllocationTable mode="PRIORITY"`(`components/orders/allocation-table.tsx`)의 `PriorityForm` — 브리프의 `priority-editor.tsx`는 별도로 만들지 않음(이미 있는 것을 쪼개는 것은 YAGNI 위반으로 판단) |
| SCM 품목담당자 | 취합, 정책, 배정, 발주계획 | **대부분 이미 충족** + **신규 연결** | 취합(Task 7/8) · 정책(Task 9a) · 발주계획(Task 9b)은 기존 화면. 배정(`/allocations`)에 `core.list_manual_allocation_candidates` 신규 연결 |
| SCM 품목담당자 | 긴급발주 등록·관리 | **신규**(컨트롤러 판정 1) | 위와 동일 |
| SCM팀장 | 승인함, 발주계획 | **이미 충족** | `app/(user)/approvals`, `app/(user)/procurement-plans` |

## 신규 구현 1 — 긴급발주

### DB (`supabase/migrations/20260911001100_stage1_department_screens.sql`)

- `core.create_urgent_order(p_item_id, p_qty, p_needed_by, p_reason) returns uuid` — `ALLOC_MANUAL`만,
  품목 존재 · 수량 > 0 · 필요일 · 사유 검증 후 `core.urgent_order`에 삽입.
- `core.update_urgent_order(p_urgent_order_id, p_qty, p_needed_by, p_reason, p_change_reason) returns uuid`
  — `ALLOC_MANUAL`만, `COMPLETED`/`CANCELLED` 건은 거절, 변경 사유 필수.
- `core.change_urgent_order_status(p_urgent_order_id, p_status, p_reason) returns uuid` — `ALLOC_MANUAL`만,
  종료 상태에서는 더 바꿀 수 없고 같은 상태로는 바뀌지 않음.
- 이력은 **새 표를 만들지 않고** 기존 `core.audit_log`(STEP 2, `target_type='urgent_order'`)를 재사용
  — `analytics.v_master_change_history`(Task 10a)와 같은 패턴. 세 함수 모두 append-only로
  before/after를 남기며 update·delete로 이력을 고치지 않는다.
- `analytics.v_urgent_order_history` — SCM(`STOCK_VIEW_ALL`)은 전체, 서비스부(`URGENT_ORDER_VIEW`)는
  소모품 품목 이력만. `core.audit_log`가 관리자만 직접 SELECT 가능한 RLS라서 뷰는 security_invoker를
  쓰지 않고(소유자 권한으로 `core.audit_log`를 읽음) WHERE 절의 `core.has_permission()`으로 호출자별
  범위를 가른다(`core.v_item_allocation_qty`와 같은 패턴).
- `core.urgent_order`의 직접 INSERT/UPDATE/DELETE는 `authenticated`에 계속 막혀 있다(Task 5 원본
  그대로 재확인) — 쓰기는 위 세 SECURITY DEFINER 함수만.
- `analytics.v_urgent_order`(Task 5가 이미 만든 조회 · RLS)는 건드리지 않았다.

### 화면

- `app/(user)/urgent-orders/page.tsx` — `requireAnyPermission('ALLOC_MANUAL', 'URGENT_ORDER_VIEW')`로
  시작. `ALLOC_MANUAL`이면 등록 폼 + 수정 · 상태 변경 가능한 표 + 변경 이력을 보고, 아니면(서비스부)
  읽기 전용 표만 본다. 조회 오류/빈 결과/등록 전용 오류를 구분해서 표시(`AGENTS.md` 3번).
- `components/orders/urgent-order-table.tsx` — 표 + `CreateUrgentOrderForm`(등록) + 행별 수정 · 상태
  변경 폼. `TERMINAL_URGENT_ORDER_STATUSES`인 행은 처리 버튼 대신 "종료됨"만 표시.
- `lib/urgent-orders/{model,repository,actions}.ts` — 화면 모델(정규화 · 입력 검증), 조회/명령
  저장소(`analytics.v_urgent_order*` 조회, `core.*` RPC 호출만), 서버 액션(`requirePermission
  ('ALLOC_MANUAL')`을 각 액션 첫 줄에서 재확인).

### 메뉴 · 권한

- `lib/permission.ts`: `WORK_ROUTE_PERMISSIONS['/urgent-orders'] = ['ALLOC_MANUAL', 'URGENT_ORDER_VIEW']`
  — SCM팀장이 가진 `STOCK_VIEW_ALL`만으로는 메뉴가 열리지 않도록 **의도적으로** 좁혔다(stage1 §2
  범위표에 SCM팀장의 긴급발주 화면은 없음). `middleware.ts`는 `WORK_ROUTE_PERMISSIONS`의 키를 그대로
  보호 경로에 반영하므로 수정하지 않아도 된다.
- `lib/menu.ts`: `/inventory` 다음에 `긴급발주` 항목 추가(`anyOf: WORK_ROUTE_PERMISSIONS['/urgent-orders']`).

## 신규 구현 2 — MANUAL 품목 배정 대기 순번 연결

- `lib/orders/model.ts` · `repository.ts`: `ManualAllocationCandidateRow` 타입과
  `getManualAllocationCandidates(itemId)`(=`core.list_manual_allocation_candidates` RPC 호출) 추가.
- `app/(user)/allocations/page.tsx`: 이미 불러온 배정 대기열(`analytics.v_allocation_queue`)에서
  `allocationMode === 'MANUAL' && shortageQty > 0`인 품목만 추려 품목별로 후보를 조회(계산은 전부
  DB가 하고 화면은 옮기기만 함).
- `components/orders/manual-allocation-queue.tsx`: 품목별 대기 순번 목록만 보여주는 읽기 전용 표.
  배정 버튼이 없다 — 자동 배정이 일어나지 않는다(컨트롤러 판정 3). 실제 확정배정은 이미 있던
  `ManualAllocationForm`(같은 페이지의 배정 대기열 표)에서 처리한다.

## 브리프 파일 목록과 실제 결과

| 브리프 항목 | 실제 |
|---|---|
| 수정 `lib/menu.ts` | 수정함(긴급발주 메뉴 1줄 추가) |
| 수정 `components/shell/sidebar.tsx` | **수정 안 함** — 이미 `lib/menu.ts` 기반으로 완전히 일반화돼 있어 새 메뉴 추가에 셸 코드 변경이 필요 없었다 |
| 생성 `app/(user)/urgent-orders/page.tsx` | 생성함 |
| 생성 `components/inventory/marketing-stock-view.tsx` | **만들지 않음** — `/inventory`가 이미 충족(위 표) |
| 생성 `components/inventory/service-stock-view.tsx` | **만들지 않음** — 위와 동일 |
| 생성 `components/inventory/sales-atp-view.tsx` | **만들지 않음** — 위와 동일 |
| 생성 `components/orders/priority-editor.tsx` | **만들지 않음** — `/allocations/priorities` + `AllocationTable mode="PRIORITY"`가 이미 충족 |
| 수정 `styles/components.css` | 수정함(`.urgent-order-actions`, `.manual-allocation-group*`) |
| 수정 `styles/shell.css` | **수정 안 함** — 새 레이아웃 영역이 없어 변경 불필요 |

## 네 단계 권한 확인 — 역할별

기존 단계(메뉴·라우트)는 `lib/permission.test.ts` · `lib/auth-policy.test.ts`에 있던 표를 **확장**했고
(요청받은 대로 새 표를 만들지 않았다), DB 단계는 `supabase/tests/urgent_order/`에서 실제로 실행해
확인했다. 이미 있던 화면(재고·주문·우선순위·수요제출·정책·발주계획·승인함)의 권한은 이전 Task들이
검증했으므로 다시 표를 만들지 않고 이번에 변경한 두 가지(긴급발주, MANUAL 배정 후보)만 아래에 편다.

### 긴급발주(`/urgent-orders`)

| 역할 | ① 메뉴 노출 | ② 직접 URL | ③ Server Action | ④ DB/RLS |
|---|---|---|---|---|
| SCM_PLANNER(`ALLOC_MANUAL`) | 보임 | 허용 | `createUrgentOrderAction`/`updateUrgentOrderAction`/`changeUrgentOrderStatusAction`이 `requirePermission('ALLOC_MANUAL')` 통과 | `core.create/update/change_urgent_order_status`가 `core.has_permission('ALLOC_MANUAL')` 통과 → 등록·수정·상태변경 성공(S3·S7·S8) |
| SCM_LEAD(`STOCK_VIEW_ALL`만) | **숨김**(anyOf 불충족) | **403**(`lib/auth-policy.test.ts` 신규 테스트) | 도달 전 페이지 가드에서 막힘(우회 직접 호출 시 `requirePermission`이 401/403) | `create_urgent_order` 호출 시 42501 `긴급발주 등록 권한(ALLOC_MANUAL)이 없습니다`(S1) — 조회는 `STOCK_VIEW_ALL`로 전체 허용 |
| SALES_REP / BIZ_DEV(둘 다 무관 권한) | 숨김 | 403 | 도달 전 차단 | `create_urgent_order` 호출 시 42501(권한 없음, S1과 동일 판정 경로) |
| MARKETING(`STOCK_VIEW_PAPER`만) | 숨김 | 403 | 도달 전 차단 | 등록 42501(S1) · 조회 `analytics.v_urgent_order`/`v_urgent_order_history` 0행(S4·S5, 오류 아님) |
| SERVICE(`URGENT_ORDER_VIEW`) | 보임(읽기 전용 UI) | 허용(조회 전용 페이지) | 등록/수정/상태변경 액션 자체가 `requirePermission('ALLOC_MANUAL')`이라 403 | `create/update/change_urgent_order_status` 42501(S6) · `core.urgent_order`에 직접 INSERT도 GRANT 없음으로 42501(S6) · 조회는 소모품(CONSUMABLE) 범위로만 허용(S4·S5) |

### MANUAL 품목 배정 대기 순번(`/allocations` 내 섹션)

| 역할 | ① 메뉴 노출 | ② 직접 URL | ③ Server Action | ④ DB/RLS |
|---|---|---|---|---|
| SCM_PLANNER(`ALLOC_MANUAL`) | `/allocations` 보임, 이 섹션은 `canManual`일 때만 렌더 | 허용 | 이 섹션은 읽기 전용(액션 없음) — 실제 확정배정은 기존 `requestManualAllocationAction`(`ALLOC_MANUAL` 재검사, 변경 없음) | `core.list_manual_allocation_candidates`가 `core.has_permission('ALLOC_MANUAL')` 확인(Task 6 원본 그대로) |
| 그 외 5개 역할 | `canManual=false`면 섹션 자체가 렌더되지 않음 | `/allocations`는 각자의 `WORK_ROUTE_PERMISSIONS`로 별도 제어(변경 없음) | — | `list_manual_allocation_candidates` 직접 호출 시 42501(Task 6 기존 보장, 이번에 재확인만) |

## 테스트와 결과

### TDD 증거 — RED → GREEN

1. **DB 함수 권한 가드 제거 → RED 확인 → 복구 → GREEN**
   - `core.create_urgent_order`에서 `core.has_permission('ALLOC_MANUAL')` 가드를 임시로 제거.
   - `PGOPTIONS='-c timezone=UTC' bash supabase/tests/urgent_order/run-all.sh` → `scenarios: PASS 0 · FAIL/ERROR 1`,
     `S1 마케팅부(STOCK_VIEW_PAPER만)는 등록할 수 없다 — 오류가 나지 않았습니다` (RED, DB 계층)
   - `node --test "lib/urgent-orders/model.test.ts"` → `✖ 긴급발주 등록 · 수정 · 상태 변경 함수는 모두 ALLOC_MANUAL을 요구한다`
     (RED, 마이그레이션 텍스트 검증 계층)
   - 가드를 원복 후 두 테스트 모두 재실행 → 전부 GREEN(아래 최종 결과에 포함).

### 최종 실행 결과

```
$ node --test "lib/urgent-orders/model.test.ts"
tests 13 · pass 13 · fail 0

$ node --test "lib/permission.test.ts" "lib/auth-policy.test.ts"
tests 19 · pass 19 · fail 0

$ npm test   (전체 스위트)
tests 338 · pass 338 · fail 0

$ npm run build
✓ Compiled successfully, /urgent-orders 라우트 생성 확인(1.93 kB)

$ PGOPTIONS='-c timezone=UTC' bash supabase/tests/urgent_order/run-all.sh
scenarios: PASS 33 · FAIL/ERROR 0
  S1 PASS 4  S2 PASS 6  S3 PASS 4  S4 PASS 4  S5 PASS 3
  S6 PASS 3  S7 PASS 3  S8 PASS 3  S9 PASS 3
결과: 전부 통과

$ git diff --check
(출력 없음 — 통과)
```

### 회귀 확인 — 기존 DB 스위트(전체 마이그레이션을 다시 적용하므로 새 마이그레이션이 함께 적용됨)

```
sales_order_allocation : scenarios 208 · concurrency 26 · invariants 10 — 전부 통과
item_policy            : scenarios 50 — 전부 통과
procurement_schedule   : scenarios ~65 — 전부 통과
```

세 스위트 모두 부트스트랩 과정에서 `20260911001100_...sql`을 포함한 전체 마이그레이션을 적용하지만
아무 시나리오도 깨지지 않았다.

## 변경 파일

**신규**
- `supabase/migrations/20260911001100_stage1_department_screens.sql`
- `supabase/tests/urgent_order/{bootstrap.sh,run-all.sh,lib.sh,guard.psql,auth-stub.psql,fixtures.psql,scenarios.psql,README.md}`
- `lib/urgent-orders/{model.ts,repository.ts,actions.ts,model.test.ts}`
- `app/(user)/urgent-orders/page.tsx`
- `components/orders/urgent-order-table.tsx`
- `components/orders/manual-allocation-queue.tsx`

**수정**
- `lib/menu.ts` — 긴급발주 메뉴 1줄
- `lib/permission.ts` — `/urgent-orders` route permission
- `lib/permission.test.ts` — 업무 메뉴 라벨셋 · 직책별 기대 메뉴에 `긴급발주` 반영
- `lib/auth-policy.test.ts` — `/urgent-orders` 라우트 접근 테스트 추가, 진입 페이지 존재 목록에 추가
- `lib/orders/model.ts` · `lib/orders/repository.ts` — `ManualAllocationCandidateRow` · `getManualAllocationCandidates`
- `app/(user)/allocations/page.tsx` — MANUAL 품목 대기 순번 섹션 연결
- `styles/components.css` — `.urgent-order-actions`, `.manual-allocation-group*`
- `error.md` — `#28 MapIterator를 바로 스프레드할 수 없다`

## 자체 검토(Self-Review) 발견 사항

- 초안에서 `components/orders/urgent-order-table.tsx`의 확장 영역에 인라인 `style={{ display: 'grid', ... }}`를
  썼다가 `design.md`/`AGENTS.md`의 "화면 컴포넌트 안에 스타일 직접 작성 금지" 원칙에 맞춰
  `.urgent-order-actions` 클래스로 옮겼다(커밋 전 수정 완료, 별도 커밋 없음).
- `app/(user)/allocations/page.tsx`에서 `[...map.entries()]` 스프레드가 `tsconfig.json`의 `es5` 타깃과
  충돌해 빌드가 실패했다 — `Array.from(...)`으로 교체(`error.md #28`).
- 브리프가 지정한 파일 중 3개(`marketing-stock-view.tsx` · `service-stock-view.tsx` · `sales-atp-view.tsx`)와
  `priority-editor.tsx`는 기존 화면이 이미 충족해 만들지 않았다 — 컨트롤러 룰링 2번을 따른 의도적 생략이며
  위 "브리프 파일 목록과 실제 결과" 표에 근거를 남겼다.
- `components/shell/sidebar.tsx` · `styles/shell.css`는 실제로 변경이 필요 없어 손대지 않았다(AGENTS.md
  "기존 파일을 함부로 고치지 않는다" 원칙과 일치).

## 우려 사항 · 수동 Supabase 작업

- 이 작업의 SQL은 로컬 검증 DB에서만 실행했다. **원격 Supabase 프로젝트에는 아무것도 적용하지
  않았다** — 사용자가 SQL Editor에서 `20260911001100_stage1_department_screens.sql`을 실행해야 한다
  (파일 안 §3에 확인용 쿼리 예시를 주석으로 남겨 두었다).
- 긴급발주 상태값은 `REQUESTED → IN_PROGRESS → COMPLETED`(또는 `CANCELLED`)만 지원한다. stage1
  문서에 긴급발주의 세부 상태 전이 규칙이 명시되어 있지 않아 "종료 상태에서는 더 바꿀 수 없다"는
  최소 규칙만 넣었다 — 실제 운영에서 더 세분화된 전이 규칙(예: IN_PROGRESS에서 REQUESTED로 되돌리기
  금지 등)이 필요하면 추가 컨트롤러 판정이 필요하다.
- `analytics.v_urgent_order_history`는 `core.audit_log`를 재사용하므로 구조상 다른 도메인(마스터
  변경 이력 등)과 같은 테이블을 공유한다 — 데이터량이 커지면(운영 경고 수준은 아니지만) `target_type`
  인덱스(`audit_log_target_idx`, 기존에 이미 있음)로 조회 성능은 보장된다.
