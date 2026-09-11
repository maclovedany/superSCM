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

---

## fix round 1 (리뷰 반영)

리뷰에서 5건을 지적받았다. 전부 고쳤다. 마이그레이션 파일(`20260911000500_stage1_inventory_availability.sql`)을 전면 재작성했고, STEP 4의 원본 파일(`20260828000300_step4_import_pipeline.sql`)은 건드리지 않았다 — `core.commit_import_batch`를 Task 4 파일에서 `create or replace`로 다시 정의했다.

### 무엇을 고쳤나

**1) `core.commit_import_batch`가 신규 컬럼을 raw에 실어 나르지 않던 문제(critical)**

STEP 4의 하드코딩된 `jsonb_build_object` 두 곳을 확장했다.

- `inventory` 분기: `inventory_status`·`warehouse_code`·`snapshot_at`를 payload에 추가.
- `goods_receipt` 분기: `receipt_status`를 payload에 추가.
- `lib/import/schema.ts`의 `goods_receipt` 스키마에 `receipt_status` 필드(필수, `enumValues:
  ['COMPLETED','PENDING']`)와 별칭을 추가했다. `FieldRule`에 `enumValues`를 새로 추가하고
  `lib/import/validate.ts`가 등록되지 않은 값을 `UNKNOWN_RECEIPT_STATUS`로 거절하도록 확장했다
  (필드명을 대문자로 올려 코드를 만드는 일반화된 규칙이라 다른 enum 필드에도 재사용된다).
- 기존 4개 분기(item_master·supplier_master·purchase_order 자체 필드, upsert 백업, replace
  삭제, 최종 `IMPORTED` 전환, forecast stale 처리)는 한 글자도 바꾸지 않았다.

**2) `core.refresh_stock_balance`를 아무도 부르지 않던 문제(important)**

계산 로직을 `core.apply_stock_balance_from_batch(uuid)`라는 내부 함수(권한 검사 없음,
`authenticated`에도 직접 실행 권한을 주지 않음)로 분리했다. `core.refresh_stock_balance`(수동
재반영, 권한 검사 있음)와 `core.commit_import_batch`(정상 커밋 경로, 함수 자체가 이미
`core.is_admin()` 게이트)가 둘 다 이 내부 함수를 부른다. `commit_import_batch`는 `inventory`
배치를 적재한 직후 같은 트랜잭션에서 `perform core.apply_stock_balance_from_batch(p_batch_id)`를
호출한다 — DB 쪽에서 원자적으로 반영된다(리뷰가 요청한 대로 앱 쪽에서 별도 API 호출을
추가하지 않았다). `goods_receipt`는 지금 `stock_balance`를 직접 늘리지 않는다 — 이유는
아래 "미해결/후속" 참고.

**3) `snapshot_at`이 NORMAL 행만이 아니라 전체 최댓값이었던 문제(important)**

`max(snapshot_at)` → `max(snapshot_at) filter (where scope_code = 'NORMAL')`로 바꿨다. 이
값이 있으려면 `core.stock_balance.snapshot_at` 컬럼을 nullable로 바꿔야 했다 — 한 품목에
분류 가능한 행은 있지만 그중 NORMAL이 하나도 없으면(예: DEFECT만 있음) `normal_qty=0`은
확정된 사실이지만 "언제 그 0을 확인했는지"는 모를 수 있기 때문이다. 컬럼 코멘트에 이유를
적어 뒀다. 이 마이그레이션은 아직 어디에도 적용되지 않았으므로 `ALTER COLUMN DROP NOT NULL`
대신 `CREATE TABLE` 정의 자체를 고쳤다.

**4) ATP_VIEW 전용 사용자가 재고 상세를 보던 문제 — 컨트롤러 결정 반영(important)**

`analytics.v_available_stock`의 WHERE 절에서 `core.has_permission('ATP_VIEW')` 분기를
제거했다. 대신 열 4개(`item_id`·`item_name`·`available_qty`·`reason_code`)만 가진
`analytics.v_order_available_stock`(security_invoker, `ATP_VIEW` 보유자만)을 새로 만들었다
— Task 5가 이 뷰를 확장할 것이므로 열 이름·순서를 여기서 고정했다. `/inventory`는
`WORK_ROUTE_PERMISSIONS`에서 여전히 `ATP_VIEW`로 진입 가능하지만, 화면(`app/(user)/
inventory/page.tsx`)이 `STOCK_VIEW_ALL`·`STOCK_VIEW_PAPER`·`STOCK_VIEW_SUPPLY` 중 하나라도
있는지 서버에서 먼저 확인해, 없으면 `getOrderAvailableStock()` + 신규
`components/inventory/order-available-table.tsx`(품목·주문 가능 수량 두 열만)를 렌더링하고,
있으면 기존 상세 표를 렌더링한다. SCM(`STOCK_VIEW_ALL`)은 `ATP_VIEW`도 함께 갖고 있지만
상세 권한이 우선이라 기존 상세 화면을 계속 본다.

**5) 창고 기준 매핑을 지원하지 않던 문제 — 컨트롤러 결정 반영(important)**

`core.inventory_scope_rule`을 `raw_status text primary key` 단일 열 표에서
`(warehouse_code, raw_status)` 조합 표로 바꿨다(둘 다 nullable, 최소 하나는 필수 — CHECK
제약). `UNIQUE ... NULLS NOT DISTINCT (warehouse_code, raw_status)` 인덱스로 모호한 중복
등록을 막는다. 새 함수 `core.classify_inventory_scope(p_warehouse_code, p_raw_status)`가
가장 구체적인 규칙을 고른다 — 창고+상태 모두 일치(3순위) > 창고전용 규칙(2순위) > 상태전용
규칙(1순위), 매칭이 없으면 null(분류 불가). 실제 창고 표기를 아직 모르므로(메모리: 실데이터에
재고 없음) 창고전용 규칙은 예시로 `SERVICE_CENTER`·`PARTNER` 두 개만 시드했다 — 실제 표기가
확인되면 이 표에 행을 더하기만 하면 된다.

### Deferred 항목 (지시대로 동작은 바꾸지 않고 주석만 추가)

`core.stock_balance`와 `core.apply_stock_balance_from_batch`의 코멘트에 "이 배치에 담긴
품목만 갱신하며, 배치에 없는 기존 품목은 이전 확정값을 그대로 유지한다 — 품목별 최신값
누적이며 전체 재계산이 아니다"를 명시했다. 동작 자체는 1차 구현과 동일하다.

### 다시 테스트한 것

**TDD — `lib/import/validate.test.ts`의 goods_receipt 케이스**

```
$ node --test lib/import/validate.test.ts
✔ usage history의 잘못된 품목, 날짜, 필수 수량을 오류 행으로 보존한다
✔ 같은 source record와 비정상 음수 수량을 별도 reason code로 검출한다
✔ 재고 스냅샷은 재고상태·창고·스냅샷일자가 모두 있어야 하며 등록되지 않은 상태는 거절한다
✔ 입고는 완료 상태가 필수이며 등록된 두 값(COMPLETED/PENDING) 밖은 거절한다
✔ 오류와 경고 행만 원본 값과 함께 CSV로 내보낸다
ℹ tests 5 · pass 5 · fail 0
```

**TDD — `lib/inventory/model.test.ts`의 `OrderAvailableStockRow` 정규화 (RED 확인 후 구현)**

```
$ node --test lib/inventory/model.test.ts   # 구현 전
SyntaxError: The requested module './model.ts' does not provide an export named 'normalizeOrderAvailableStockRow'
✖ fail 1

$ node --test lib/inventory/model.test.ts   # 구현 후
✔ 조회 범위는 세 가지 업무 코드만 허용하고, 그 외 값은 GENERAL로 취급한다
✔ analytics.v_available_stock 행을 화면 모델로 옮긴다 — 정상 분류된 행
✔ 분류할 수 없는 행은 0이 아니라 null과 사유 코드를 유지한다
✔ 숫자 컬럼이 문자열(Supabase numeric)로 와도 숫자로 변환한다
✔ 한국어 컬럼 별칭도 읽는다
✔ analytics.v_order_available_stock 행은 주문 가능 수량 네 열만 옮긴다 — 재고 상세는 없다
✔ 분류할 수 없는 품목의 주문 가능 수량도 0이 아니라 null과 사유 코드를 유지한다
ℹ tests 7 · pass 7 · fail 0
```

**임시 PostgreSQL 검증 (새 스크래치 DB, 같은 부트스트랩 절차)**

절차는 1차와 동일(`error.md` #21 참고) — 새 `scm_task4_fix1_<timestamp>` DB에 auth 스텁 →
`schema-dump/2026-09-11.sql` → `supabase/migrations/*.sql` 전체를 파일명 순서로 적용, STEP4·
STEP7의 기존 비-멱등 정책만 선처리. Task 4 마이그레이션 파일을 **두 번 연속 적용**해 재실행
안전성도 함께 확인했다(둘 다 exit 0, 같은 결과).

1. **검사대기10·정상20·이동중30 → 정상20 (원본 3항목 재확인)** — 그대로 통과.
   `core.stock_balance.normal_qty = 20`.
2. **상태 미입력 → null + INVENTORY_SCOPE_UNCLASSIFIED (원본 3항목 재확인)** — 그대로 통과.
3. **익명 사용자는 조회·갱신 불가 (원본 3항목 재확인, 뷰 2개로 확장)** — `analytics.
   v_available_stock`·`analytics.v_order_available_stock`·`core.stock_balance` 조회와
   `core.refresh_stock_balance()` 실행 모두 `permission denied for schema core/analytics`.
4. **(fix #1+#2) 정식 경로 end-to-end** — `refresh_stock_balance`를 전혀 부르지 않고
   `core.import_staging.mapped_data`에 `inventory_status='정상'`·`warehouse_code='MAIN'`·
   `snapshot_at='2026-09-08'`를 넣은 뒤 ADMIN 세션에서 `core.commit_import_batch()`만 호출.
   결과: `raw.inventory`에 네 컬럼이 실제로 적재됐고, `core.stock_balance.normal_qty = 42`가
   **자동으로** 채워졌다(`source_batch_id`도 그 배치를 가리킴). `core.upload_batch.status =
   'IMPORTED'`.
   같은 방식으로 `goods_receipt` 배치(`receipt_status='COMPLETED'`, 수량 20)를 커밋하자
   `raw.goods_receipt.receipt_status`가 실제로 `'COMPLETED'`로 적재됐고, `core.v_open_po_qty`가
   50(발주) → 30(발주-입고완료)으로 줄었다.
5. **(fix #3) snapshot_at은 NORMAL 전용** — 한 품목에 INSPECTION 행(스냅샷 09-05)과 NORMAL
   행(스냅샷 09-01, 더 이른 시각)을 같이 넣고 refresh. `stock_balance.snapshot_at`이 더 늦은
   INSPECTION 시각이 아니라 더 이른 NORMAL 시각으로 저장됨을 확인 — `filter (where
   scope_code='NORMAL')`가 실제로 동작함을 "둘 중 더 늦은 게 이겼다면 틀렸을" 케이스로 증명.
6. **(fix #4) ATP_VIEW 전용은 상세를 못 본다** — SALES_REP(직책상 `ATP_VIEW`만 보유) 세션에서
   `analytics.v_available_stock` → 0행. `analytics.v_order_available_stock` → `item_id`·
   `item_name`·`available_qty`·`reason_code` 네 열만 있는 행 3건(정상 20건짜리 · 미분류
   품목 · 정상 9건짜리) 확인. 같은 세션에서 SCM_PLANNER는 여전히 `v_available_stock`에서
   `open_po_qty`·`in_transit_qty`까지 포함한 상세를 본다(회귀 없음).
7. **(fix #5) 창고 규칙이 상태 규칙을 이긴다** — `core.classify_inventory_scope('SERVICE_CENTER',
   '정상')` → `SERVICE_CENTER`(NORMAL이 아니다). 마이그레이션 파일 자체의 확인 쿼리로도
   재현되고(적용 로그에 그대로 찍힘), 별도 호출로도 재확인했다.
8. **모호한 규칙 등록 차단** — `insert into core.inventory_scope_rule (warehouse_code,
   raw_status, ...) values (null, '정상', ...)`를 이미 있는 조합으로 다시 시도하면
   `duplicate key value violates unique constraint "inventory_scope_rule_key_uq"`로 거절됨을
   확인.

검증 후 스크래치 DB를 삭제했다.

### 전체 스위트 · 빌드 (재실행)

```
$ npm test
ℹ tests 132 · pass 132 · fail 0

$ npm run build
✓ Compiled successfully
✓ Generating static pages (22/22)
/inventory  ƒ  1.8 kB

$ git diff --check
(출력 없음)
```

### 변경 파일 (fix round 1)

- 수정: `supabase/migrations/20260911000500_stage1_inventory_availability.sql` (전면 재작성)
- 수정: `lib/import/schema.ts`, `lib/import/validate.ts`, `lib/import/validate.test.ts`
- 수정: `lib/inventory/model.ts`, `lib/inventory/model.test.ts`, `lib/inventory/repository.ts`
- 수정: `lib/scm.ts` (`getOrderAvailableStock` 재노출)
- 수정: `app/(user)/inventory/page.tsx` (ATP 전용/상세 분기)
- 신규: `components/inventory/order-available-table.tsx`

### 남은 이슈

- `goods_receipt`는 여전히 `core.stock_balance`를 직접 늘리지 않는다(리뷰의 "if it affects
  the balance" 문구를 조건부로 읽어, 참고 열 축소만 구현). 브리프 원문("stock_balance 증가
  원장으로 연결한다")을 문자 그대로 구현하면 `raw.inventory` 스냅샷 기반 재계산과 입고 건별
  증가가 같은 배치에서 이중 계산될 위험이 있어, 이번 라운드에서는 손대지 않고 위 "Deferred"
  섹션과 함께 후속 Task에서 설계하도록 남겨 뒀다.
- `core.inventory_scope_rule`의 창고전용 시드(`SERVICE_CENTER`·`PARTNER`)는 실제 창고 표기가
  아니라 예시 코드다. 실데이터의 진짜 창고 표기가 확인되면 이 표에 행을 추가해야 실제로
  동작한다. **→ fix round 2에서 컨트롤러 지시로 제거했다. 아래 참고.**

---

## fix round 2 (컨트롤러 판정 반영)

라운드 1에서 남겨 둔 두 우려(a·b)에 대해 컨트롤러가 판정을 내렸다. 둘 다 반영했다.

### 1) 완료된 입고가 `core.stock_balance`를 실제로 늘려야 한다 (판정: 확정된 gap)

브리프 원문("`raw.goods_receipt`는 창고 입고 완료일과 완료 상태가 모두 확인된 건만
`stock_balance` 증가 원장으로 연결한다")과 Task 6의 `core.allocate_new_stock(p_item_id,
p_receipt_id)`가 이 값에 의존한다는 지적을 그대로 구현했다.

**계산식** — 이중 계산 방지를 위해 컨트롤러가 제시한 그대로:

```
normal_qty = 최신 NORMAL 스냅샷 수량(snapshot_qty)
           + 그 스냅샷 시각(snapshot_at) 이후 완료된 입고 합
```

**구현**

- `core.stock_balance`에 `snapshot_qty`(실사 수량 그 자체) 열을 추가했다. `normal_qty`는
  화면·뷰가 읽는 최종값으로 의미가 바뀌었다 — `snapshot_qty` + 자격 있는 완료 입고 합.
- `core.stock_receipt_ledger` — 완료된 입고를 건별로 기록하는 append-only 표.
  `source_record_id`에 유니크 제약을 걸어 같은 입고가 두 번 반영되지 않는다(`on conflict
  (source_record_id) do nothing`). 행을 지우거나 고치지 않는다 — 반영 시점의 사실을 그대로
  보존한다.
- `core.recompute_stock_balance_totals(p_item_ids)` — `normal_qty = snapshot_qty +
  sum(원장.qty where completed_at > snapshot_at)`을 다시 계산하는 내부 함수. 새 스냅샷이나
  새 완료 입고가 반영될 때마다 영향받은 품목만 다시 계산한다. 이 방식이라면 "새 스냅샷이
  이전 입고를 흡수한다"가 저절로 성립한다 — 새 스냅샷의 `snapshot_at`이 이전 입고의
  `completed_at`보다 뒤라면 그 비교식이 자동으로 그 입고를 빼기 때문이다(원장 행 자체는
  지우지 않는다 — 감사 이력).
- `core.apply_stock_receipts_from_batch(p_batch_id)` — goods_receipt 배치에서 완료
  (`receipt_status='COMPLETED'`) + 입고일 확인된 행만 원장에 기록하고 영향받은 품목을
  재계산한다. `core.commit_import_batch`가 `goods_receipt` 타입 배치를 적재한 직후 같은
  트랜잭션에서 호출한다(라운드 1과 같은 자리 — inventory는
  `core.apply_stock_balance_from_batch`, goods_receipt는 이 함수).
- **원장 기록은 `core.stock_balance` 존재 여부와 무관하게 조건 없이 한다** — 처음에는 "이미
  확정 정상 창고재고 행이 있는 품목만" 조건을 걸었는데, 그러면 실사 스냅샷보다 입고가 먼저
  도착한 품목의 입고가 영원히 누락되는 순서 의존 버그가 생긴다는 것을 스크래치 DB 검증
  중 스스로 발견해 고쳤다. 지금은 원장에는 항상 기록하고, `core.stock_balance`에 그 품목
  행이 아직 없으면 `recompute_stock_balance_totals`의 UPDATE가 그냥 0행에 적용돼 아무 일도
  하지 않는다 — 나중에 그 품목의 실사 스냅샷이 들어오면 그 시점에 자동으로 반영된다("입고만
  으로 기준선을 추정하지 않는다"는 원칙은 그대로 지켜진다).

### 2) 창고전용 예시 시드 제거 (판정: 확정)

`core.inventory_scope_rule` 시드에서 `('SERVICE_CENTER', null, ...)` · `('PARTNER', null,
...)` 두 행을 지웠다. 표 구조·유니크 제약·`core.classify_inventory_scope`의 우선순위 로직은
그대로 둬서, 실제 창고 표기가 확인되면 행만 추가하면 되도록 했다. `docs/데이터-요청목록.md`
"1-1. 재고 스냅샷" 절에 창고코드 → 범위 매핑표 요청 한 줄을 추가했다.

창고전용 규칙이 실제로 상태전용 규칙을 이기는지는 이제 운영 시드가 아니라 스크래치 DB
안에서 임시로 행을 넣고(`begin` ~ `rollback`) 확인한다 — 마이그레이션 파일의 확인 쿼리
섹션에 그 절차를 주석으로 남겼다.

### 다시 테스트한 것

TS 변경은 없었다(이번 라운드는 SQL과 `docs/데이터-요청목록.md`만 수정). 기존 스위트가
그대로 통과하는지만 재확인했다.

```
$ npm test
ℹ tests 132 · pass 132 · fail 0

$ npm run build
✓ Compiled successfully
✓ Generating static pages (22/22)

$ git diff --check
(출력 없음)
```

**임시 PostgreSQL 검증 (새 스크래치 DB, 같은 부트스트랩 절차)**

`scm_task4_fix2_<timestamp>` DB에 같은 절차(stub → schema-dump → 전체 migrations 순서 적용,
STEP4·STEP7 비-멱등 정책 선처리)로 재구성했다. Task 4 마이그레이션을 두 번 연속 적용해
재실행 안전성도 재확인(둘 다 exit 0, 시드 15행 — 창고전용 2행이 빠진 개수가 맞다).

1. **(i) 스냅샷 NORMAL 20(T0) + 완료 입고 5, 완료 시각 T1(T1>T0) → 25** — ADMIN 세션에서
   `core.commit_import_batch`로 inventory 배치(정상 20, 2026-09-01) 커밋 →
   `snapshot_qty=20, normal_qty=20`. 이어서 goods_receipt 배치(`source_record_id='GR-1'`,
   수량 5, `입고일=2026-09-05`, `receipt_status='COMPLETED'`) 커밋 → `normal_qty=25`,
   원장에 `GR-1` 1행(수량 5, `completed_at=2026-09-05`).
2. **(ii) 같은 입고 재반영/재커밋 → 그대로 25** — 두 방식 모두 확인.
   - `core.refresh_stock_balance()`를 같은 inventory 배치 ID로 재호출 → `normal_qty=25`
     그대로(`snapshot_qty` 재계산도 20으로 동일, 원장 합도 5로 동일).
   - `GR-1`과 똑같은 `source_record_id`로 새 goods_receipt 배치를 만들어 다시 커밋 →
     `normal_qty=25` 그대로, `core.stock_receipt_ledger`에서 `source_record_id='GR-1'`
     행 수는 여전히 1행(유니크 제약이 두 번째 반영을 막음).
3. **(iii) 완료 아닌 입고는 반영되지 않는다** — 별도 품목(ITEM902, 정상 12)에
   `receipt_status='PENDING'`인 입고 7을 커밋 → `normal_qty=12` 그대로, 원장에 그 품목 행
   0개(반영 자체가 안 됨 — 나중에 상태가 바뀌어 재업로드되면 그때 새 `source_record_id`로
   들어올 수 있다).
4. **(iv) 새 스냅샷이 이전 입고를 흡수한다** — 같은 품목(ITEM901)에 정상 30, 스냅샷 시각
   T2=2026-09-10(T2>T1) 배치를 커밋 → `snapshot_qty=30, normal_qty=30` (T1=09-05 입고는
   이미 스냅샷에 잡혔다고 보고 다시 더하지 않는다 — 원장 행 자체는 남아 있다).
5. **(보너스) 스냅샷보다 입고가 먼저 도착해도 값이 사라지지 않는다** — 신규 품목(ITEM903)에
   실사 스냅샷 없이 완료 입고(수량 8, `완료=2026-09-02`)부터 커밋 →
   `core.stock_balance`에 그 품목 행이 생기지 않음(원장에는 기록됨, "입고만으로 기준선을
   추정하지 않는다" 원칙 유지). 이어서 같은 품목에 정상 10, 스냅샷 시각 2026-09-01(입고보다
   이른 시각) 배치를 커밋 → `snapshot_qty=10, normal_qty=18`(10+8) — 순서와 무관하게 자격
   있는 입고가 자동으로 반영됨을 확인. 처음에는 "이미 `stock_balance` 행이 있는 품목만
   원장에 기록"하도록 짰었는데, 이 케이스로 순서 의존 버그를 직접 찾아내 고쳤다(위 "구현"
   설명 참고).
6. **창고 규칙 우선순위 재확인** — 창고전용 시드가 없는 상태에서
   `classify_inventory_scope('SERVICE_CENTER', '정상')` → `NORMAL`(상태전용 규칙만 적용).
   `begin`으로 감싸 임시 창고전용 규칙 1행을 넣고 같은 호출 → `SERVICE_CENTER`(창고전용이
   이김). `rollback` 후 `warehouse_code='SERVICE_CENTER'`인 행 0개 — 운영 시드에 남지
   않음을 확인.
7. **원본 3항목 재확인** — 상태 미입력(ITEM999) → `null + INVENTORY_SCOPE_UNCLASSIFIED`.
   ATP_VIEW 전용(SALES_REP) → `v_available_stock` 0행, `v_order_available_stock`은 최소
   4열로 ITEM901(30)·ITEM902(12)·ITEM903(18) 정상 표시(라운드 2에서 달라진 숫자가 그대로
   반영됨 — 회귀 없음 확인). anon → `analytics`·`core` 스키마 자체가 permission denied.

검증 후 스크래치 DB를 삭제했다.

### 변경 파일 (fix round 2)

- 수정: `supabase/migrations/20260911000500_stage1_inventory_availability.sql`
- 수정: `docs/데이터-요청목록.md` (창고코드 → 범위 매핑표 요청 추가)

### 남은 이슈 (업데이트)

- `core.inventory_scope_rule`의 창고전용 규칙은 이제 시드가 하나도 없다 — 실제 창고 표기가
  오기 전까지 창고 단독으로는 아무 것도 SERVICE_CENTER/PARTNER로 분류되지 않는다(상태전용
  규칙만 적용된다). 표기가 확정되면 `insert ... (warehouse_code, null, ...)` 행만 추가하면
  된다.
- `raw.goods_receipt`의 `입고일`은 날짜만 있고 시각이 없다(`date` 정밀도). 스냅샷 `snapshot_at`
  은 timestamptz라 시각까지 있을 수 있다 — 같은 날 안에서 스냅샷과 입고의 선후 관계가
  달력일 단위로만 비교된다(자정 기준). 이 정밀도 차이는 raw 스키마 자체의 한계이며 이번
  라운드에서 손대지 않았다.

---

## fix round 3 (재리뷰 반영)

라운드 2 재리뷰에서 라운드 2 항목 두 개는 모두 해결로 확인됐고, 라운드 2의 diff 자체가 새로
만든 Important 결함 두 건이 나왔다. 둘 다 고쳤다.

### 1) 수량 0인 완료 입고가 배치 전체를 롤백시키던 문제

`core.apply_stock_receipts_from_batch`의 `completed` CTE가 `receipt_status='COMPLETED'` ·
입고일 존재 · 입고수량 존재만 걸렀고 수량이 0인지는 보지 않았다. `lib/import/validate.ts`는
음수만 `NEGATIVE_QUANTITY`로 막고 0은 통과시키므로, 검증을 통과한 수량 0 COMPLETED 행이
그대로 `core.stock_receipt_ledger`에 들어가려다 그 표의 `check (qty > 0)`에 걸려 예외가
났다. `commit_import_batch`는 배치 전체가 한 트랜잭션이라, 이 예외 하나가 같은 배치의
다른 정상 입고 행까지 전부 롤백시키고 배치는 `VALIDATED`에 멈춘 채 남았다.

**수정** — `completed` CTE의 WHERE 절에 `and nullif(g."입고수량", '')::numeric > 0`을
추가했다. 수량 0인 완료 입고는 잔액을 바꾸지 않는 게 맞으므로, 원장에 아예 넣지 않는 것이
정확한 동작이다(원장의 `qty > 0` 체크는 그대로 둬서 향후 다른 경로로 0이 들어오는 것도
계속 막는다).

### 2) 같은 입고번호에 품목이 여러 줄이면 두 번째 품목부터 사라지던 문제

`core.stock_receipt_ledger`의 유니크 인덱스가 `source_record_id` 단독이었다. 입고 한 건
(입고번호)에 품목이 여러 줄로 딸린 ERP 문서가 흔한데, 그 경우 같은 배치 안에서 두 번째
품목부터 `on conflict (source_record_id) do nothing`에 걸려 영원히 원장에 들어가지 못했다
— 잔액도, 향후 Task 6의 `core.allocate_new_stock(p_item_id, p_receipt_id)`도 그 품목의
입고를 볼 수 없었다.

**수정** — 유니크 인덱스를 `source_record_id` 단독에서 `(source_record_id, item_id)` 조합으로
바꿨다(`drop index if exists ... ; create unique index if not exists
stock_receipt_ledger_source_item_uq ...`). `INSERT ... ON CONFLICT` 대상과 관련 코멘트도
모두 맞춰 고쳤다. 원장 행 자체(`ledger_id`)는 여전히 단일 대리키이므로 스키마 변경은
인덱스 교체만으로 끝난다.

**STEP 4 raw 키잉에 대한 확인 (리뷰 지시대로 조사만 하고 손대지 않음)**

지시대로 STEP 4의 `core.commit_import_batch`가 `raw.goods_receipt`를 어떻게 적재하는지
스크래치 DB에서 직접 확인했다.

- **`import_mode = 'append'`** (첫 업로드의 기본값) — 행마다 그냥 INSERT만 하고 삭제하지
  않는다. 같은 `입고번호`(source_record_id)에 품목이 여러 줄이어도 `raw.goods_receipt`에
  둘 다 그대로 남는다. 확인: `GR-DOC-1`에 ITEMA 5 · ITEMB 7을 append로 커밋 →
  `raw.goods_receipt`에 두 행 모두 존재, 원장에도 둘 다 반영(A→15, B→17).
- **`import_mode = 'upsert'`** — 배치 안에서 한 줄씩 처리하며 매번 "같은
  `source_record_id`를 가진 기존 raw 행을 지우고 새로 넣는다"(`delete ... where
  source_record_id=$1` 후 insert). 이 delete는 **같은 배치, 같은 트랜잭션 안에서 방금 넣은
  형제 행까지 지운다.** 확인: `GR-DOC-UPSERT`에 ITEMA 3 · ITEMB 4를 upsert로 커밋 →
  `raw.goods_receipt`에는 **ITEMB 한 행만** 남는다(ITEMA는 ITEMB 처리 시 삭제됨). 내 원장
  로직은 커밋이 끝난 뒤 `raw.goods_receipt`를 읽으므로, 이 경우 원장에도 ITEMB만 반영되고
  ITEMA는 애초에 보이지 않는다.

**결론 — 이것은 내가 이번에 건드린 코드의 버그가 아니라 STEP 4(20260828000300)의 기존 동작이다.**
`import_mode='upsert'`로 입고를 올리면서 여러 품목이 같은 `입고번호`를 공유하면, 내 Task 4
확장과 무관하게 마지막 품목만 `raw.goods_receipt`에 남는다 — 재고 원장뿐 아니라
Open PO 참고 열(`core.v_open_po_qty`)도 같은 영향을 받는다. 지시대로 이번 라운드에서는
STEP 4의 raw 적재 키를 바꾸지 않았다. 이 문제는 goods_receipt의 `import_mode`로
`upsert`가 아니라 `append`를 쓰도록 화면 안내를 남기거나, STEP 4 자체의 raw 키를
`(source_record_id, 품목코드)` 조합으로 바꾸는 별도 Task로 넘겨야 한다.

### 다시 테스트한 것

TS 변경은 없었다(이번 라운드도 SQL만 수정). `npm test` 132/132, `npm run build` 성공,
`git diff --check` 출력 없음 — 기존과 동일.

**임시 PostgreSQL 검증 (새 스크래치 DB, 같은 부트스트랩 절차)**

`scm_task4_fix3_<timestamp>` DB를 같은 절차로 재구성했다(stub → schema-dump → 전체
migrations 순서 적용, STEP4·STEP7 비-멱등 정책 선처리). Task 4 마이그레이션을 두 번 연속
적용해 재실행 안전성도 재확인했고, `stock_receipt_ledger_source_uq`(구) 인덱스는 사라지고
`stock_receipt_ledger_source_item_uq`(신)만 남는 것을 `pg_indexes`로 확인했다.

1. **finding 1 확인** — ITEM901에 정상 20 스냅샷을 반영한 뒤, 같은 goods_receipt 배치에
   `GR-ZERO`(수량 0, COMPLETED) · `GR-FIVE`(수량 5, COMPLETED)를 함께 커밋. 결과:
   `commit_import_batch`가 예외 없이 끝나고 배치 상태는 `IMPORTED`(멈추지 않음), 잔액은
   정확히 25(20+5), 원장에는 `GR-FIVE`만 있고 `GR-ZERO`는 없음.
2. **finding 2 확인** — ITEMA·ITEMB에 각각 정상 10 스냅샷을 반영한 뒤, 같은 `입고번호
   GR-DOC-1`로 ITEMA 5 · ITEMB 7을 `append` 모드로 같은 배치에 커밋. 결과: A=15, B=17
   (둘 다 반영). 같은 내용을 새 배치로 다시 커밋(재업로드 시나리오) → A=15, B=17 그대로,
   `GR-DOC-1` 원장 행 수는 여전히 2행(품목당 1행, 중복 없음).
3. **STEP 4 raw 키잉 조사** — 위 "확인" 문단 그대로. `append`는 다품목 보존, `upsert`는
   같은 배치 안에서 형제 행을 서로 지운다(STEP 4 기존 동작, 이번 범위 밖).
4. **회귀 확인** — 상태 미입력 → `INVENTORY_SCOPE_UNCLASSIFIED`, `analytics.v_available_stock`
   ·`analytics.v_order_available_stock` 둘 다 `security_invoker=true` 유지, `anon`은
   `core.stock_receipt_ledger` 조회 시도에서 `permission denied for schema core`.

검증 후 스크래치 DB를 삭제했다.

### 변경 파일 (fix round 3)

- 수정: `supabase/migrations/20260911000500_stage1_inventory_availability.sql`

### 남은 이슈 (업데이트)

- **(신규, Important 수준으로 보고)** `import_mode='upsert'`로 `goods_receipt`를 올리면
  같은 `입고번호`를 공유하는 여러 품목 줄 중 마지막 줄만 `raw.goods_receipt`에 남는다
  (STEP 4의 기존 delete-then-insert 로직). `append` 모드는 이 문제가 없다. 화면에서
  goods_receipt 업로드 시 `upsert`를 기본값으로 두지 않거나, STEP 4의 raw 키를
  `(source_record_id, 품목코드)` 조합으로 바꾸는 별도 작업이 필요하다.
