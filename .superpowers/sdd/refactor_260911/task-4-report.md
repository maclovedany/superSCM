# Task 4 · 정상 창고재고와 가용재고 기준 확정 — 구현 보고

## 무엇을 만들었나

**DB (`supabase/migrations/20260911000500_stage1_inventory_availability.sql`, 신규)**

- `raw.inventory`에 nullable `inventory_status` · `snapshot_at` · `warehouse_code`를 ALTER로 추가.
  기존 43행(5회차 더미)은 이 값이 전부 null이며, NORMAL로 추정하지 않는다.
- `raw.goods_receipt`에 nullable `receipt_status`를 ALTER로 추가 ("창고 입고 완료일과 완료
  상태가 모두 확인된 건"의 "완료일"은 기존 `입고일` 컬럼, "완료 상태"가 이 신규 컬럼).
- `core.inventory_scope_rule` — `raw_status → NORMAL/INSPECTION/DEFECT/SERVICE_CENTER/PARTNER/IN_TRANSIT`
  alias 매핑 표(`core.supplier_alias`와 같은 모양). 한글·영문 표기 15종을 시드했다.
- `core.item_visibility_rule` — `raw_item_type → PAPER_CARD_READER/CONSUMABLE/GENERAL` 매핑 표.
  매핑에 없는 품목구분은 제외가 아니라 GENERAL로 취급한다.
- `core.stock_balance` — 품목별 확정 정상 창고재고(`item_id` PK). **분류 가능한 행이 하나도
  없는 품목은 이 표에 아예 올리지 않는다** — 0이 아니라 "아직 모른다"를 뜻하기 때문.
- `core.refresh_stock_balance(p_batch_id)` — SECURITY DEFINER. 로그인 + 활성 사용자 +
  `STOCK_VIEW_ALL`(또는 관리자) 권한을 요구하고, `inventory` 타입의 `VALIDATED`/`IMPORTED`
  배치만 반영한다. 배치 안에서 `warehouse_code`와 매핑 가능한 `inventory_status`를 모두 가진
  행만 집계하고, `NORMAL` 합계만 `stock_balance.normal_qty`로 upsert한다.
- `core.v_open_po_qty` — Open PO 참고 열 계산을 `raw.purchase_order`/`raw.goods_receipt`에서
  분리한 소유자 권한 뷰(`core.v_inbound_qty`와 같은 자리). security_invoker 뷰가 raw를 직접
  읽을 수 없어서 필요했다 (아래 이슈 참고).
- `analytics.v_available_stock` (`security_invoker = true`) — `core.v_item_master`를 기준으로
  `stock_balance` · `item_visibility_rule` · `v_inbound_qty`(이동 중, 기존 뷰) · `v_open_po_qty`를
  LEFT JOIN. `available_qty = normal_warehouse_qty - temporary_allocated_qty - firm_allocated_qty
  - approval_hold_qty`. 배정 세 열은 Task 5(`core.stock_allocation`)가 아직 없어 지금은 0으로
  고정 — 배정 이력이 0건이라는 사실 그대로이므로 추정이 아니다. `stock_balance` 행이 없는
  품목은 `normal_warehouse_qty`/`available_qty`가 `null`이고 `reason_code =
  INVENTORY_SCOPE_UNCLASSIFIED`. 조회 범위는 `STOCK_VIEW_ALL`·`ATP_VIEW`는 전체,
  `STOCK_VIEW_PAPER`는 `PAPER_CARD_READER`만, `STOCK_VIEW_SUPPLY`는 `CONSUMABLE`만.
- RLS: `stock_balance`는 위 네 권한 보유자만 SELECT, INSERT/UPDATE/DELETE는 authenticated에도
  주지 않는다(갱신은 오직 `refresh_stock_balance` 함수). `inventory_scope_rule`/
  `item_visibility_rule`은 조회는 전체 authenticated, 쓰기는 관리자만. `anon`/`public`은 모두 revoke.

**Import (`lib/import/schema.ts` · `validate.ts` · `types.ts` · `repository.ts`)**

- `inventory` 스키마에 `inventory_status`(필수, DB 등록 상태만 허용) · `warehouse_code`(필수) ·
  `snapshot_at`(필수, 날짜)을 추가.
- `ImportReferences`에 `inventoryStatuses: Set<string>` 추가, `validateRows`가 등록되지 않은
  상태 텍스트를 `UNKNOWN_INVENTORY_STATUS` ERROR로 거절.
- `importReferences()`가 `core.inventory_scope_rule`에서 유효 상태 목록을 읽어온다.

**화면 (`lib/inventory/*`, `app/(user)/inventory/page.tsx`, `components/inventory/stock-table.tsx`)**

- `lib/inventory/model.ts` — `AvailableStockRow` 타입과 `normalizeAvailableStockRow`. null은
  0으로 채우지 않고 그대로 유지, 배정 세 열(임시·확정·승인대기)만 "0건이 사실"이므로 0.
- `lib/inventory/repository.ts` — `getAvailableStock()`이 `analytics.v_available_stock`만 조회.
- `app/(user)/inventory/page.tsx` — `requireAnyPermission(...WORK_ROUTE_PERMISSIONS['/inventory'])`
  가드를 첫 줄에 두고, 조회 실패/빈 결과/정상 결과 세 상태를 구분해 렌더링.
- `components/inventory/stock-table.tsx` — 검색·조회범위 필터, `EmptyValue` + reasonCode로
  계산 불가 표시, Open PO·이동 중 열은 "(참고)"로 표시해 가용재고와 구분.
- `lib/permission.ts` — `WORK_ROUTE_PERMISSIONS['/inventory']`에 `ATP_VIEW` 추가(영업담당자가
  실제 주문 가능 수량을 보려면 이 경로에 들어와야 한다, stage1 §2).
- `lib/scm.ts` — `export { getAvailableStock } from './inventory/repository'` 재노출(화면과
  향후 Agent 툴이 같은 함수를 쓰도록 하는 이 프로젝트의 규칙, AGENTS.md 9번).
- `lib/menu.ts` — 변경 없음. Task 1에서 이미 `/inventory` 항목과 `anyOf:
  WORK_ROUTE_PERMISSIONS['/inventory']`가 정확히 들어가 있었다(placeholder 문구도 없었다).
  `permission.ts`의 배열 변경이 그대로 반영되므로 별도 수정이 필요 없었다.
- 기존 `app/(user)/analysis/stockout/page.tsx`는 이미 `NoRealDataNotice`로 계산 불가 사유를
  보여주고 있었고 더미 `v_stockout_risk`를 참조하지 않는다(사전 확인, 변경 없음).

## 무엇을 테스트했나

### TDD 증거

**RED — `lib/inventory/model.ts`가 없는 상태에서 테스트 먼저 작성**

```
$ node --test lib/inventory/model.test.ts
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/inventory/model.ts'
✖ fail 1
```

**GREEN — `lib/inventory/model.ts` 구현 후**

```
$ node --test lib/inventory/model.test.ts
✔ 조회 범위는 세 가지 업무 코드만 허용하고, 그 외 값은 GENERAL로 취급한다
✔ analytics.v_available_stock 행을 화면 모델로 옮긴다 — 정상 분류된 행
✔ 분류할 수 없는 행은 0이 아니라 null과 사유 코드를 유지한다
✔ 숫자 컬럼이 문자열(Supabase numeric)로 와도 숫자로 변환한다
✔ 한국어 컬럼 별칭도 읽는다
ℹ tests 5 · pass 5 · fail 0
```

`lib/import/validate.test.ts`에도 `UNKNOWN_INVENTORY_STATUS` 검증 테스트를 새로 추가하고
`schema.ts`/`validate.ts` 구현과 함께 확인했다(`npm test -- lib/import/validate.test.ts` →
4/4 통과).

### 임시 PostgreSQL 검증 (전체 로그: 세션 기록)

절차: 세션 5-user PostgreSQL 17(`/tmp:5432`)에 `scm_task4_<timestamp>` DB를 새로 만들고,
①최소 `auth` 스텁(`auth.uid()`, `auth.users` + `raw_user_meta_data`/`created_at`) →
②`supabase/schema-dump/2026-09-11.sql`(public 스키마 재생성 줄만 제거) → ③`postgres`/
`supabase_admin` 롤 생성 → ④`supabase/migrations/*.sql`을 파일명 순서대로 전부 적용(STEP4·
STEP7의 기존 비-멱등 RLS 정책 블록만 `drop policy if exists`로 선처리) 순서로 재구성했다.
겪은 문제와 해결은 `error.md` #21·#22에 기록했다(다음 Task도 재사용 가능).

1. **검사대기 10 · 정상 20 · 이동 중 30 → 정상 20**
   - SCM_PLANNER 세션으로 ITEM901에 세 행(검사대기/정상/이동중)을 `VALIDATED` 배치로 적재하고
     `core.refresh_stock_balance()` 호출.
   - 결과: `core.stock_balance.normal_qty = 20`, `analytics.v_available_stock.available_qty = 20`.

2. **상태 미입력은 0이 아니라 사유 코드로 제외**
   - ITEM902에 `inventory_status`/`warehouse_code`/`snapshot_at`을 전부 비운 행(5회차 더미와
     동일한 모양)만 적재하고 같은 배치로 refresh.
   - 결과: `refresh_stock_balance`가 ITEM902를 `stock_balance`에 올리지 않음(1행만 upsert).
     `v_available_stock`에서 ITEM902는 `normal_warehouse_qty = null`, `available_qty = null`,
     `reason_code = 'INVENTORY_SCOPE_UNCLASSIFIED'`.

3. **익명 사용자는 조회·갱신 불가**
   - `set role anon;` 세션에서 `analytics.v_available_stock` · `core.stock_balance` 조회,
     `core.refresh_stock_balance()` 실행 모두 `permission denied for schema core/analytics`로
     거절(스키마 USAGE 자체가 anon에 없다 — 표/뷰 GRANT보다 앞선 방어선).

4. **(구현 체크리스트 보너스) 부서별 품목 범위 제한**
   - MARKETING 세션 → `v_available_stock`에 ITEM902(PAPER_CARD_READER)만 보임.
   - SERVICE 세션 → ITEM901(CONSUMABLE)만 보임.
   - MARKETING 세션으로 `refresh_stock_balance()` 호출 → `정상 창고재고 반영 권한이 없습니다`
     거절 확인(STOCK_VIEW_ALL 없는 계정은 갱신 불가).

검증 후 스크래치 DB와 임시로 만든 `postgres`/`supabase_admin` 롤을 모두 삭제했다.

### 전체 스위트 · 빌드

```
$ npm test
ℹ tests 129 · pass 129 · fail 0
```

(주의: `lib/permission.ts`의 `/inventory` 권한 배열에 `ATP_VIEW`를 추가하며 기존
`lib/auth-policy.test.ts`·`lib/permission.test.ts`의 하드코딩된 기대값 2건이 깨졌다 — 영업이
이제 /inventory에 들어갈 수 있다는 의도된 행동 변화였으므로 두 테스트를 새 기대값으로 고쳤다.
자세한 내용은 "자체 검토" 참고.)

```
$ npm run build
✓ Compiled successfully
✓ Generating static pages (22/22)
/inventory  ƒ  1.69 kB  (이전 placeholder 199 B에서 증가 — 실제 화면이 빌드됨)
```

```
$ git diff --check
(출력 없음 — 공백 오류 없음)
```

## 변경 파일

- 신규: `supabase/migrations/20260911000500_stage1_inventory_availability.sql`
- 신규: `lib/inventory/model.ts`, `lib/inventory/model.test.ts`, `lib/inventory/repository.ts`
- 신규: `app/(user)/inventory/page.tsx`(교체), `components/inventory/stock-table.tsx`
- 수정: `lib/scm.ts`, `lib/permission.ts`
- 수정: `lib/import/schema.ts`, `lib/import/validate.ts`, `lib/import/types.ts`,
  `lib/import/repository.ts`, `lib/import/validate.test.ts`
- 수정(기존 테스트를 새 의도된 동작에 맞춤): `lib/auth-policy.test.ts`, `lib/permission.test.ts`
- 수정: `error.md` (#21 schema-dump 부트스트랩, #22 security_invoker 뷰의 raw 직접 참조 오류)

## 자체 검토

- **완전성**: 브리프의 DB 객체 6개(스코프 규칙 2개, stock_balance, refresh 함수, 가용재고 뷰,
  raw ALTER) 전부 구현. 구현 체크리스트 4개(NORMAL 검증 데이터, import 스키마, 부서별 뷰 범위
  제한, Stockout 화면 무영향) 전부 확인. 검증 체크리스트 3개 전부 임시 DB에서 실행 확인.
- **품질**: 기존 코드 스타일(approvals/notifications 마이그레이션의 주석 밀도, `revoke/grant`
  순서, `security_invoker` 패턴, 검증 쿼리를 파일 끝에 주석으로 두는 관례)을 그대로 따랐다.
- **발견하고 고친 문제**: 처음에는 `analytics.v_available_stock`이 Open PO 참고 열을
  `raw.purchase_order`/`raw.goods_receipt`에 직접 상관 서브쿼리로 접근했는데, 임시 DB 검증에서
  `permission denied for table purchase_order`로 실패했다. `security_invoker=true` 뷰는 호출자
  권한으로 raw를 읽는데, 이 프로젝트는 `authenticated`에 raw 테이블 GRANT를 주지 않기
  때문이다(SCHEMA.md). `core.v_open_po_qty`(소유자 권한 뷰, `core.v_inbound_qty`와 같은 자리)로
  분리해 해결했고, `error.md` #22에 기록해 다음 사람이 같은 실수를 반복하지 않게 했다.
- **의도적 설계 결정 (사용자 확인 필요)**:
  1. `core.inventory_scope_rule`은 지금 `inventory_status`(재고상태) 텍스트만으로 여섯 범위를
     정한다. 브리프 원문("원본 창고·재고상태를 매핑한다")은 창고까지 매핑 키에 넣는 것도
     읽히지만, 실데이터의 실제 창고 표기 종류를 전혀 모르는 상태(memory: 실데이터에 재고 없음)
     라 지금은 `warehouse_code`가 **존재하는지**만 분류 가능 여부의 조건으로 쓰고, 실제 범위
     판정은 상태값 하나로만 한다. 창고별로 다른 판정이 필요해지면(예: 특정 창고는 상태와
     무관하게 SERVICE_CENTER) 이 표에 `(warehouse_code, raw_status)` 복합키로 확장하면 된다.
  2. `core.v_open_po_qty`는 발주수량 합 - (완료 입고수량 합)을 0에서 clamp한 단순 근사치다.
     참고 열이라 가용재고 계산에는 영향이 없고 검증 체크리스트에도 없어 더 정교화하지 않았다.
  3. `refresh_stock_balance()`는 새 권한 코드를 추가하지 않고 기존 `STOCK_VIEW_ALL`을
     반영 권한으로 재사용했다(SCM_PLANNER·SCM_LEAD만 보유). 전용 권한이 필요하면 후속 Task에서
     추가한다.
- **미해결/후속 Task로 넘긴 것**: `analytics.v_available_stock`의 `temporary_allocated_qty`·
  `firm_allocated_qty`·`approval_hold_qty`는 Task 5(`core.stock_allocation`)가 실제 값을 채울
  때까지 0 고정이다. Task 5는 기존 12개 열 순서를 바꾸지 않고 `create or replace view`로
  확장해야 한다(error.md #16).

## 사용자가 수동으로 할 일 (Supabase)

1. SQL Editor에서 `supabase/migrations/20260911000500_stage1_inventory_availability.sql`을
   실행한다(이미 적용된 이전 Task 마이그레이션 뒤에 이어서).
2. 파일 하단 확인 쿼리 (a)~(d)를 그대로 실행해 재적용 여부를 확인할 수 있다. (a)는 검증용
   `insert`가 주석 처리되어 있으니 실제로 넣어 보려면 주석을 풀고 실행한 뒤 되돌린다.
3. Exposed schemas에는 이미 `core`, `analytics`가 있어야 한다(이전 Task에서 완료). 신규
   테이블/뷰이므로 추가 설정은 필요 없다.
4. 실데이터에는 아직 `inventory_status`/`warehouse_code`/`snapshot_at`가 있는 재고 파일이
   없으므로, 적용 직후 `/inventory` 화면은 모든 품목이 `INVENTORY_SCOPE_UNCLASSIFIED`로 보일
   것이다 — 이것이 올바른 동작이다(0으로 채우지 않는다는 규칙).
