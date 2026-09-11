# Task 10b 보고서 — 발주일 · 출항일 · 입고 차이

커밋: (아래 "커밋" 절 참고, main, push 안 함)

## 무엇을 구현했는가

### DB — `supabase/migrations/20260911001000_stage1_procurement_schedule.sql`

| 객체 | 역할 |
|---|---|
| `core.procurement_schedule` | 승인된 계획 1개월차 라인 × 공급처 출항일 한 줄. 중간에 계산이 막히면 그때까지 계산된 값(예: 출항일)만 남기고 `calculation_status='EXCLUDED'` + `reason_code`로 남긴다 |
| `core.receipt_schedule_result` | 확정 계획 입고일 스냅샷 · 실제 입고일 · `gap_days`(generated column, `실제 − 확정`) |
| `core.build_procurement_schedule(p_plan_id)` | PLAN_CONFIRM. APPROVED 계획만 허용, 1개월차·최종발주량>0 라인마다 일정 생성. `plan_line_id` unique + `ON CONFLICT`로 재실행해도 행이 늘지 않고 실제 입고일은 보존 |
| `core.confirm_kr_business_day(date)` | 내부 헬퍼(authenticated 실행 권한 회수). `previous_business_day`로 당긴 뒤, 원래 날짜~당겨진 날짜가 걸친 모든 달이 `business_calendar_readiness`에서 준비됨이어야 그 날짜를 돌려준다. 하나라도 미준비면 null |
| `core.record_actual_receipt_date(schedule_id, date, note)` | PLAN_CONFIRM. 계산된(SCHEDULED) 일정에만 실제 입고일 입력·수정(null이면 지움). actor·시각은 `core.audit_log`(append-only)에 기록 |
| `analytics.v_procurement_schedule` | 화면이 읽는 일정 한 줄 — 출항일 · 발주 · 입고 · 실제 · 차이 · `bundle_key`(ISO 주차) · `gap_reason_code`(EXCLUDED 사유 또는 실제 미입력 시 `ACTUAL_RECEIPT_UNSET`) |
| `analytics.v_receipt_gap_entity` / `_item` / `_month` | 모두 `core.receipt_schedule_result`의 `calculation_status='SCHEDULED'` 행만 집계(같은 원천). 평균·합계는 실제 입고일이 있는 행만, 미기록 건수는 별도 열 |

RLS: 두 표 모두 SELECT만 — PLAN_CONFIRM · PLAN_APPROVE · ADMIN(procurement_plan과 같은 모양). 쓰기는 두 함수 경유만(`authenticated`에서 INSERT/UPDATE/DELETE 회수).

### 컨트롤러 판정별 구현

1. **KR 영업일 달력, 준비 안 된 달은 CALENDAR_NOT_READY** — `core.confirm_kr_business_day`가 매번 "당겨진 날짜~원래 날짜가 걸친 모든 달"의 준비 상태를 확인한다(월/연 경계를 넘는 조정도 커버). 발주일·입고일 둘 다 이 함수 하나로 통일했다.
2. **최신 승인 계획의 1개월차 · 발주량>0만, 제외는 조용히 빼지 않는다** — `core.procurement_plan_line where month_no=1 and final_order_qty>0`을 루프 대상으로 하고, 공급처 매핑이 없으면 `SUPPLIER_UNSET`으로 행 자체는 만든다. `core.v_item_master.supplier_id`가 `core.supplier`에 실재하는 코드여야 매핑으로 본다(아래 "품목→공급처 매핑" 절).
3. **출항일 = 계획 월 1일 이후 첫 날짜 중 활성 규칙이 정확히 하나 맞는 날** — 요일/요일+주차/매월 일자 세 인코딩을 day-by-day 스캔(최대 400일)으로 판정한다. 0개면 `DEPARTURE_RULE_UNSET`, 2개 이상이면 `DEPARTURE_RULE_AMBIGUOUS`(어느 쪽도 고르지 않는다). 그 뒤 출항일 기준 공급처 유효성(`SUPPLIER_INACTIVE`), 법인 준비기간(`PREP_DAYS_UNSET`, `prep_days=0` 포함) 순서로 확인한다.
4. **브리프 계산식 그대로** — 기준 발주일 = 출항일 − 준비기간, 요청 발주일 = KR 영업일 확정, 계획 입고일 = 요청 발주일 + 7일, 확정 계획 입고일 = KR 영업일 확정, 입고 차이 = 실제 − 확정(부호 있는 정수, generated column). 묶음 키는 `extract(isoyear/week from 출항일)`. `발주마감일` 컬럼·상태는 만들지 않았다.
5. **실제 입고일은 SCM 품목담당자(PLAN_CONFIRM)만, 입고 실적 자동 매칭 없음** — `core.record_actual_receipt_date`가 유일한 입력 경로다. actor·시각은 기존 `core.audit_log`에 `before`/`after` 스냅샷으로 append-only 기록한다(Task 10a와 같은 방식, 별도 표 없음).
6. **build 함수는 non-APPROVED 거절, 재실행 안전, 실제 입고일 보존** — `plan_id`의 상태를 확인한 뒤에만 진행하고, `procurement_schedule`은 `plan_line_id` unique + `ON CONFLICT DO UPDATE`(계산값만 갱신), `receipt_schedule_result`는 `schedule_id` unique + `ON CONFLICT DO UPDATE SET confirmed_receipt_date만`(actual_receipt_date·recorded_*는 절대 건드리지 않는다).
7. **세 집계 뷰는 같은 원천 행** — 셋 다 `core.procurement_schedule join core.receipt_schedule_result where calculation_status='SCHEDULED'`만 쓴다. 월별은 `date_trunc('month', confirmed_receipt_date)`(확정 계획 입고일) 기준. `EXCLUDED` 행은 세 집계 뷰가 아니라 `v_procurement_schedule`에서 사유와 함께 보인다(집계 뷰에 섞으면 "같은 원천 행" 비교의 분모가 애매해진다고 판단).
8. 더미 데이터 없음(운영 표는 seed 0행), 재실행 안전(bootstrap이 전체 마이그레이션 뒤 대상 파일을 한 번 더 적용), 원격 미적용, 확인 쿼리는 파일 끝 주석. "오늘" 계산은 이 마이그레이션에 없다(모든 날짜가 계획·마스터 데이터에서 온다).

### 품목 → 공급처 매핑은 어디서 왔는가

`core.v_item_master`(schema-dump에 이미 있는 뷰, `raw.item_master`를 품목코드 정규화 + 중복 제거만 해서 보여준다)의 `supplier_id` 열을 그대로 썼다 — STEP 4 적재 파이프라인이 `item_master` 임포트 시 이미 `supplier_id` 필드를 받고 있고(20260828000300 §item_master payload), 다른 매핑 표는 존재하지 않는다(`core.item_policy`에는 공급처 열이 없다). 다만 이 값은 **alias 없이 그대로** 쓴다 — `core.supplier_alias`는 `raw.purchase_order`의 25종 표기를 정규화하기 위한 표이지 `item_master.supplier_id`용이 아니고(SCHEMA.md), item_master의 `supplier_id`가 옛 5회차 더미 공급처(`SUP001~013`) 표기인지 실제 공급처 코드인지도 확인할 수 없었다. 그래서 `core.v_item_master.supplier_id`가 **실제로 `core.supplier`(Task 10a 신규 마스터)에 존재하는 코드일 때만** 매핑으로 인정하고, 아니면 `SUPPLIER_UNSET`으로 남긴다 — 값을 지어내지 않는다는 원칙을 그대로 따른 것이다.

**실데이터 현재 상태**: `core.supplier`는 Task 10a까지 시드 데이터가 전혀 없다(관리자가 화면에서 하나씩 등록해야 한다). 그래서 실제 배포 DB에서 지금 이 함수를 돌리면 **모든 품목이 `SUPPLIER_UNSET`**이다 — 더미 숫자를 보여주지 않는다는 원칙대로다(메모리: `realdata-has-no-inventory-or-leadtime`와 같은 결). 검증 스위트는 이 상태를 fixture로 그대로 재현했다(S6).

## 테스트와 결과

### DB 스위트 `supabase/tests/procurement_schedule/run-all.sh` (S1~S23, 63 checks)

```
$ bash supabase/tests/procurement_schedule/run-all.sh
scenarios: PASS 63 · FAIL/ERROR 0
  S1 2 · S2 3 · S3 2 · S4 10 · S5 5 · S6 2 · S7 1 · S8 1 · S9 1 · S10 2
  S11 2 · S12 5 · S13 2 · S14 5 · S14b 1 · S15 1 · S16 1 · S17 2 · S18 1
  S19 5 · S20 3 · S21 2 · S22 3 · S23 1
결과: 전부 통과

$ PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/procurement_schedule/run-all.sh
scenarios: PASS 63 · FAIL/ERROR 0 (시나리오별 수 동일)
결과: 전부 통과
```

필수 사례 → 시나리오: 주말 발주·입고일 이전 영업일 S4·S5, 공휴일+주말(금요일) S4, 월 경계 S5,
연 경계 ISO 주차(2026-12-31→2026-W53) S12, 법인·품목·월 집계 동일 원천 S19, 실제 입고일
null→ACTUAL_RECEIPT_UNSET S16, CALENDAR_NOT_READY S11, SUPPLIER_UNSET S6, SUPPLIER_INACTIVE S9,
DEPARTURE_RULE_UNSET S7, DEPARTURE_RULE_AMBIGUOUS S8, PREP_DAYS_UNSET(실제 JP 시드값) S10,
non-APPROVED 거절 S2, idempotent+실제 입고일 보존 S13·S15, 비-PLAN_CONFIRM 거절 S1·S17, RLS S22,
하드 쓰기 금지 S23.

### 회귀(다른 DB 스위트 — 이 마이그레이션이 전체 목록에 추가되므로 재실행)

```
master_edit       scenarios PASS 48 · FAIL/ERROR 0 · 전부 통과
procurement_plan  scenarios PASS 132 · FAIL/ERROR 0 · 전부 통과
```

### 모델 테스트

```
$ node --test lib/schedule/model.test.ts
ℹ tests 39 · pass 39 · fail 0
$ npm test
ℹ tests 323 · pass 323 · fail 0   (Task 10a 기준 284 + 이번 39)
```

### 빌드 · 정적 검사

```
$ npm run build
✓ Compiled successfully · Linting and checking validity of types
├ ƒ /procurement-plans/schedule   1.52 kB   104 kB
├ ƒ /analysis/receipt-gap          190 B    103 kB
$ git diff --check   → 출력 없음
```

## TDD Evidence — RED와 GREEN

**모델 RED** — `model.ts` 없이 테스트 먼저:
```
$ node --test lib/schedule/model.test.ts
ℹ pass 0 · fail 1
✖ lib/schedule/model.test.ts … ERR_MODULE_NOT_FOUND (./model.ts 모듈 없음)
```
**모델 GREEN** — `model.ts` 구현 후 `ℹ tests 39 · pass 39 · fail 0`(연 경계 ISO 주차 · 요일+주차 규칙 ·
KR 영업일 확정의 월 경계 등 핵심 계산을 손으로 검산해 하드코딩한 기대값과 일치).

**DB RED** — 마이그레이션 · fixture · scenarios를 먼저 쓰고 bootstrap 먼저 실행:
```
$ bash supabase/tests/procurement_schedule/run-all.sh   (마이그레이션 파일 작성 전 상태에서 첫 시도)
ERROR: column reference "schedule_id" is ambiguous   ← 실제로 부딪힌 첫 버그(아래 참고)
```
**DB GREEN** — 버그 수정 후 `scenarios: PASS 63 · FAIL/ERROR 0`.

**변이 검증(시나리오가 실제로 실패를 잡는지)** — `v_planned_receipt_date := v_requested_order_date + 7`을
`+ 6`으로 바꿔 재실행:
```
psql:scenarios.psql:83: ERROR:  FAIL: S4 계획 입고일 = 요청 발주일 + 7일
결과: 실패
```
(그 전까지 S1~S3 통과, S4 첫 날짜 검사에서 정확히 잡힌다). 변이를 되돌리고 재실행해 다시
`63 · 0`으로 확인했다.

## 실제로 부딪힌 버그 (error.md에 기록)

1. **`ON CONFLICT (schedule_id)`에서 `column reference is ambiguous`** — `core.build_procurement_schedule`가
   `RETURNS TABLE (schedule_id uuid, ...)`인데 `core.receipt_schedule_result` upsert의
   `ON CONFLICT (schedule_id)`가 그 출력 열과 이름이 겹쳐 모호해졌다(error.md #20과 같은 종류, 자리가
   다르다 — `RETURNING`이 아니라 `ON CONFLICT` 대상 열 목록). `ON CONFLICT ON CONSTRAINT
   receipt_schedule_result_schedule_id_key`로 고쳤다. error.md #27로 기록했다.
2. **psql `\gset` + NULL 컬럼** — 시나리오 초안이 `reason_code`(SCHEDULED면 NULL)와
   `gap_reason_code`(실제 입고일 입력 후 NULL)를 `\gset`으로 받으려다 `syntax error at or near ":"`를
   만났다(error.md #26과 같은 패턴). NULL이 될 수 있는 열은 `sched_test.check((select ... from ...), …)`
   서브쿼리 판정으로 바꿨다.

두 항목 모두 실제로 실행해서 잡은 버그다(정적 검토만으로는 두 번째 것은 특히 놓치기 쉽다 — SQL 문법
자체는 유효해 보이고 psql 변수 치환 단계에서만 깨진다).

## 파일

**DB**
- 생성: `supabase/migrations/20260911001000_stage1_procurement_schedule.sql`
- 생성: `supabase/tests/procurement_schedule/{README.md,run-all.sh,bootstrap.sh,lib.sh,guard.psql,auth-stub.psql,fixtures.psql,scenarios.psql}`

**lib**
- 생성: `lib/schedule/model.ts` · `model.test.ts` · `repository.ts` · `actions.ts`
- 수정: `lib/permission.ts`(`/procurement-plans/schedule`, `/analysis/receipt-gap` 경로 권한 추가)
- 수정: `lib/menu.ts`(발주 일정 · 입고 차이 메뉴 항목 추가)

**화면**
- 생성: `app/(user)/procurement-plans/schedule/page.tsx`
- 생성: `app/(user)/analysis/receipt-gap/page.tsx`
- 생성: `components/procurement/schedule-table.tsx` · `schedule-actions.tsx`
- 생성: `components/analysis/receipt-gap-table.tsx`
- 수정: `components/analysis/analysis-tabs.tsx`, `app/(user)/analysis/layout.tsx`(아래 self-review 1번)

**기타**
- 수정: `error.md`(#27 추가)

## Self-review 발견 사항(모두 반영)

1. **분석 탭이 권한과 무관하게 전부 보이고 있었다.** `components/analysis/analysis-tabs.tsx`는 지금까지
   `USER_MENU`의 `/analysis/*` 항목을 권한 필터 없이 그대로 나열했다 — 기존 분석 화면(수요 패턴 · 리드타임
   격차 등)이 전부 `anyOf` 없는 공개 화면이라 문제가 드러나지 않았을 뿐이다. `/analysis/receipt-gap`에
   `anyOf: ['PLAN_CONFIRM','PLAN_APPROVE']`를 붙이면서 이 틈이 처음으로 실제 문제가 됐다 — 권한 없는
   사용자에게도 탭 이름이 보이는 것은 사이드바 `menuFor()`가 이미 막고 있는 것과 다른 새는 구멍이다.
   `AnalysisTabs`가 `permissionCodes` prop을 받아 `anyOf`를 직접 거르도록 고치고(`app/(user)/analysis/layout.tsx`를
   서버 컴포넌트로 바꿔 `getPermissions()`를 넘긴다), 클릭해서 들어가면 서버가 다시 거절하는 2차 방어는
   그대로 둔다(기존 규칙 그대로 1차=메뉴 숨김, 2차=서버 액션·RLS).
2. **`core.procurement_schedule` 빌드 함수 초안이 rowtype 변수(`core.supplier%rowtype` 등)를 루프
   회차마다 다시 채우지 않고 재사용했다** — 조회를 아예 건너뛴 회차(예: `SUPPLIER_UNSET`이라 출항일
   규칙 조회 자체를 안 하는 경우)에 이전 품목의 값이 남아 있다가 실수로 쓰일 위험이 있었다. 스칼라
   변수로 바꾸고 매 회차 명시적으로 초기화해, "그 단계까지 도달해 조회했을 때만 값이 남는다"는 불변식을
   코드로 보이게 했다(주석에도 남겼다).
3. **`entity_id`를 EXCLUDED 행에 언제 남길지 초안 로직이 TS 거울과 어긋났다** — 처음에는
   "`SCHEDULED`이거나 `CALENDAR_NOT_READY`일 때만 남긴다"는 조건식이었는데, `PREP_DAYS_UNSET`(법인은
   찾았지만 준비기간이 0)도 법인 정보를 남겨야 한다는 걸 `lib/schedule/model.ts`의
   `computeProcurementScheduleLine` 거울을 먼저 완성하면서 깨달았다. SQL을 거울에 맞춰 단순화했다(스칼라
   변수가 자연히 null로 초기화되므로 별도 후처리 없이 올바르게 동작한다 — 2번과 맞물린 정리).
4. `lib/schedule/model.ts`에 만들어 두고 실제로는 어디서도 쓰지 않는 `scheduleReasonRank`(사유 우선순위
   정렬 헬퍼)가 있었다 — 브리프에 확정 차단 사유 정렬 같은 요구가 없어 YAGNI 위반이라 지웠다.
   `CALCULATION_STATUSES` 상수도 `normalizeScheduleRow`가 문자열 리터럴 비교로 우회하고 있어 죽은
   코드였다 — 실제로 그 상수를 쓰도록 정규화 로직을 고쳤다(procurement/model.ts의 `oneOf` 패턴과 같은 결).
5. `git diff --check` · `npm run build` · `npm test` 모두 이 수정들을 반영해 다시 통과를 확인했다.

## 우려 사항

1. **품목 → 공급처 매핑이 alias 없이 직결이다.** `core.v_item_master.supplier_id`가 실제 현업 자료에서
   어떤 형태(코드 · 이름 · 옛 표기)로 들어올지 확인하지 못했다. 만약 이름 표기라면 `core.supplier_alias`와
   비슷한 매핑 표가 하나 더 필요할 수 있다 — 지금은 그 표가 없으므로 만들지 않았다(YAGNI, 실제 자료
   확인 후 판단).
2. **실제 배포 데이터로는 전부 `SUPPLIER_UNSET`이다.** `core.supplier`가 아직 비어 있으므로(Task 10a
   관리자 화면에서 등록 대기) 지금 이 기능을 실제 DB에 적용해도 일정이 하나도 안 생긴다 — 버그가
   아니라 데이터 전제 미충족이다(아래 "데이터 전제" 참고).
3. **출항일 스캔 상한 400일.** 규칙의 `valid_from`이 계획 월보다 훨씬 뒤라면(예: 몇 년 뒤부터 유효)
   400일 안에 못 찾고 `DEPARTURE_RULE_UNSET`으로 떨어진다. 정상적인 마스터 데이터 운용(과거·현재
   규칙 위주)에서는 충분하다고 판단했다.
4. **`core.confirm_kr_business_day`의 "걸친 모든 달이 준비돼야 한다"는 내 해석이다.** 브리프는 "그 달이
   준비 안 되면"이라고만 했고 월 경계를 넘는 조정까지 명시하지 않았다 — 더 보수적으로(공휴일 공백을
   절대 숨기지 않는 쪽으로) 해석했다. 완화하려면(원래 날짜의 달만 확인) 이 함수만 고치면 된다.
5. **`core.record_actual_receipt_date`의 `p_note`는 필수가 아니다.** Task 10a의 마스터 편집 함수들은
   모두 사유를 필수로 받지만, 이건 "정책을 바꾸는" 편집이 아니라 실적 데이터를 있는 그대로 옮겨 적는
   행위라 판단해 선택으로 뒀다 — actor·시각은 어차피 기록된다.

## 실제 숫자가 나오기 전에 사용자가 해야 할 일(데이터 전제)

1. `core.supplier`를 관리자 화면(`/admin/master`, Task 10a)에서 실제 공급처로 채운다 — `supplier_id`가
   `raw.item_master.supplier_id`(→ `core.v_item_master.supplier_id`)와 정확히 같은 문자열이어야 매핑된다.
   다르면(옛 표기 등) 이 Task는 alias 매핑을 만들지 않았으므로 먼저 값을 맞추거나 후속 작업이 필요하다.
2. 공급처마다 출항일 규칙(`core.supplier_departure`, 요일/요일+주차/매월 일자 중 하나)을 등록한다 —
   없으면 `DEPARTURE_RULE_UNSET`.
3. 소속 해외법인의 출항 준비기간(`core.supply_entity.prep_days`)을 0이 아닌 값으로 확정한다 — 5개
   법인 모두 현재 0(미확인)이다.
4. KR `core.business_calendar_readiness`에 관련 월을 "준비됨"으로 표시하고(공휴일은
   `core.add_business_holiday`로 하나씩), 발주일 · 입고일이 걸치는 모든 달을 빠짐없이 준비한다(월
   경계를 넘는 조정도 있다).
5. Task 9b로 계획을 승인(APPROVED)한 뒤 `/procurement-plans/schedule`에서 SCM 품목담당자가 "발주 일정
   만들기"를 누른다. 이후 실제 입고가 확인되면 같은 화면에서 실제 입고일을 입력한다.

## 수동 Supabase 단계

- SQL Editor에서 `20260911000950` 다음에 `supabase/migrations/20260911001000_stage1_procurement_schedule.sql`을
  실행한다(원격에는 아무것도 적용하지 않았다).
- 적용 후 파일 끝 확인 쿼리로 `analytics.v_procurement_schedule` · `v_receipt_gap_*`를 확인한다 — 현재
  데이터에서는(공급처 미등록) 모든 라인이 `SUPPLIER_UNSET`으로 나오는 것이 정상이다.
- Exposed schemas(core · analytics)는 기존 설정 그대로 쓴다.

---

## Fix round 1 — 같은 달 옛 승인본으로 재빌드하면 독립된 일정 두 벌이 생기는 문제

### 리뷰 지적(요지)

`core.build_procurement_schedule`가 `status='APPROVED'`만 확인하고 `is_latest_approved`는 확인하지
않았다. Task 9b는 새 버전이 생겨도 이미 APPROVED인 계획을 SUPERSEDED로 바꾸지 않으므로(9b 우려 5),
한 달에 APPROVED 계획이 여러 개 있을 수 있다. 시나리오: 11월 v1 승인 → 일정 생성 → v2 확정·승인(이제
v2가 최신) → 누군가(직접 RPC 호출 또는 오래된 화면 탭에 남아 있던 plan_id로) v1을 다시 빌드하면, 같은
달에 독립된 `procurement_schedule`/`receipt_schedule_result` 행 두 벌이 생긴다(`plan_line_id`는 계획
버전마다 다른 UUID라 유니크 제약이 이를 막지 못한다). 세 집계 뷰가 이 옛 행까지 같이 집계해 판정 7
("같은 원천 행")과 월/법인/품목 합계가 깨진다. 기존 S1~S23은 DRAFT · PENDING_APPROVAL · 존재하지
않는 계획만 다뤘을 뿐 이 경로를 검증하지 않았다.

### 컨트롤러 판정에 따른 수정

1. **최신 승인본만 허용** — `core.build_procurement_schedule`가 상태 확인 뒤 `analytics.
   v_procurement_plan.is_latest_approved`를 한 번 더 확인한다(같은 판정을 뷰 한 곳에서만 하도록
   재구현하지 않고 그대로 읽는다 — procurement_plan 쪽 함수들이 이미 이 방식이다). 아니면 명확한 문구로
   거절한다: "이 발주계획은 승인됐지만 이 달의 최신 승인본이 아닙니다."
2. **옛 일정은 superseded로 남기고, 실제 입고일은 승계한다** — `core.procurement_schedule`에
   `superseded_at` · `superseded_by_plan_id` 두 열을 추가했다. 최신 승인본 확인을 통과하면, 이 계획이
   그 달의 옛(아직 대체되지 않은) 일정 행 전부를 superseded로 표시한다(지우지 않는다 — 같은 계획을
   다시 빌드하는 idempotent 재실행은 `plan_id <> p_plan_id` 조건 덕분에 영향받지 않는다). 그다음 품목마다
   새 행을 만들 때, 방금 대체한 옛 행 중 **같은 품목 · 같은 공급처**이고 실제 입고일이 있는 행을 찾아
   그 값(+ 입력자 · 입력 시각 · 메모)을 새 행으로 옮긴다. 공급처가 바뀌었으면 승계하지 않는다 — 값은
   옛(superseded) 행에 그대로 남아 데이터를 잃지 않는다. 옛 schedule_id의 원래 입력 이력
   (`RECEIPT_ACTUAL_DATE_RECORDED`)은 손대지 않고, 새 schedule_id에는 승계 사실 자체를 별도 이력
   (`RECEIPT_ACTUAL_DATE_CARRIED_OVER`, before에 `carried_from_schedule_id`)으로 남긴다 — 두 이력 모두
   `core.audit_log`(append-only)에 있으므로 "누가 언제 원래 입력했는가"와 "언제 어느 행으로 옮겨졌는가"를
   둘 다 추적할 수 있다.
3. **세 집계 뷰는 superseded 행을 뺀다** — `v_receipt_gap_entity/_item/_month`의 WHERE 절에
   `s.superseded_at is null`을 더했다. `v_procurement_schedule`에는 `superseded_at` ·
   `superseded_by_plan_id`를 끝에 추가해 노출한다(EXCLUDED 행과 마찬가지로 조용히 숨기지 않고 "옛
   행"이라는 사실 자체는 조회할 수 있게 한다).
4. **재빌드 idempotent 유지 + 승계 중복 방지** — 같은 계획을 다시 빌드해도 옛 행을 다시 superseded로
   만들지 않는다(`superseded_at is null` 조건). 승계도 마찬가지로, 이 행에 이미 실제 입고일이 있으면
   (처음 승계됐거나 직접 입력됐거나) 승계 조회 자체를 건너뛰어 이력이 중복 기록되지 않게 했다(구현
   중 실제로 이 문제를 만났다 — 아래 TDD Evidence 참고).

### 화면 쪽 따라간 수정 (범위를 벗어나지 않는 선에서)

`lib/schedule/repository.ts`의 `getProcurementSchedules()`(일정 목록 화면이 쓰는, 유일하게 실사용되는
조회 함수)에 `.is('superseded_at', null)` 필터를 추가했다 — 이러지 않으면 재빌드할 때마다 옛 행이 화면에
그대로 쌓여 같은 품목이 중복돼 보인다. 판정에 명시되진 않았지만 고치지 않으면 이번 수정 자체가
반쪽짜리가 된다고 판단했다(1라운드 self-review에서 analysis-tabs를 고친 것과 같은 종류의 판단).
`lib/schedule/model.ts`의 `ProcurementScheduleRow`에 `supersededAt` · `supersededByPlanId` 필드를
추가하고 `normalizeScheduleRow`가 옮기도록 했다(모델 테스트 1건 추가, `model.test.ts` 40 → 이번 라운드
포함 40건). **지시받은 대로 건드리지 않은 것**: `PREP_DAYS_UNSET` 분기가 0을 돌려주는 부분, 쓰이지 않는
`getProcurementScheduleByPlan`.

### 테스트와 결과

```
$ bash supabase/tests/procurement_schedule/run-all.sh
scenarios: PASS 88 · FAIL/ERROR 0
  (기존 S1~S23 63건 그대로 + 신규 S24~S29 25건)
  S24 3 · S25 6 · S26 4 · S27 3 · S28 5 · S29 4
결과: 전부 통과

$ PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/procurement_schedule/run-all.sh
scenarios: PASS 88 · FAIL/ERROR 0
결과: 전부 통과

$ bash supabase/tests/procurement_plan/run-all.sh   (v_procurement_plan.is_latest_approved를 읽으므로 재확인)
scenarios: PASS 132 · FAIL/ERROR 0 · 전부 통과

$ node --test lib/schedule/model.test.ts
ℹ tests 40 · pass 40 · fail 0
$ npm test
ℹ tests 324 · pass 324 · fail 0
$ npm run build
✓ Compiled successfully
$ git diff --check   → 출력 없음
```

### TDD Evidence

**리뷰 지적 재현(고치기 전, RED)** — 수정 전 코드로 같은 시나리오를 손으로 재현: v1 빌드 → v1의
T10BITM1에 실제 입고일 기록 → v2 확정·승인 → `build_procurement_schedule(v1)` 호출이 **성공**하고(거절돼야
하는데) v1·v2 각각의 `procurement_schedule` 행이 독립적으로 남아 `v_receipt_gap_month`의 11월 `n_total`이
2(v1의 T10BITM1+T10BITM9)에서 v2 빌드 후 3(v1 2건 + v2 1건, 옛 행이 안 빠짐)으로 늘어나는 것을 SQL Editor
동치의 psql 세션에서 직접 확인했다(고치기 전 상태이므로 이 재현 자체가 R ED다).

**시나리오 먼저 작성 → 실패 확인(RED)** — S24~S29를 작성한 뒤 최신 승인본 확인 코드만 빼고(supersede ·
승계 로직은 남긴) 상태로 실행:
```
psql:scenarios.psql:364: ERROR:  FAIL: S24 옛 승인본(v1)으로 다시 만들면 거절된다(최신 승인본이 아니다)
  — 오류가 나지 않았습니다: select core.build_procurement_schedule('e9e6f595-...')
```
**GREEN** — 최신 승인본 확인을 되돌린 뒤 `scenarios: PASS 88 · FAIL/ERROR 0`.

**두 번째 RED(구현 중 자체 발견)** — S25~S29를 처음 작성했을 때 S29("재실행해도 승계 이력이 중복
기록되지 않는다")가 실패했다:
```
FAIL: S29 재실행해도 승계 이력이 중복 기록되지 않는다   (count = 2, 기대 1)
```
원인: 첫 승계 뒤 `receipt_schedule_result`에 이미 실제 입고일이 있는데도, 재실행마다 `v_prev_schedule_id`를
다시 찾아 `RECEIPT_ACTUAL_DATE_CARRIED_OVER` 이력을 또 남기고 있었다(값 자체는 ON CONFLICT 덕분에
안 바뀌지만 이력만 계속 쌓였다). `v_existing_actual_date`를 먼저 확인해 이미 값이 있으면 승계 조회
자체를 건너뛰도록 고쳐 GREEN으로 옮겼다 — 아래 "실제로 부딪힌 버그"에 추가.

**변이 검증** — `is_latest_approved` 확인 블록을 통째로 주석 처리하고 재실행:
```
psql:scenarios.psql:364: ERROR:  FAIL: S24 옛 승인본(v1)으로 다시 만들면 거절된다(최신 승인본이 아니다)
  — 오류가 나지 않았습니다: select core.build_procurement_schedule('e9e6f595-bad9-47ee-bb02-6486344f02bd')
결과: 실패 (S25~S29는 그 앞 실패로 이어서 0건)
```
되돌린 뒤 재실행해 `88 · 0`으로 복귀 확인.

### 실제로 부딪힌 버그 (fix round 1)

**승계 이력 중복 기록** — 위 "두 번째 RED"와 같다. `INSERT ... ON CONFLICT DO UPDATE`는 값 자체의
중복 갱신은 막아 주지만, 그 앞에서 무조건 실행되는 "승계 대상 조회 + 이력 INSERT" 블록은 막아 주지
않는다는 것을 실제 재실행 테스트(S29)로만 잡을 수 있었다 — 정적 검토로는 "ON CONFLICT가 있으니
안전하다"고 오판하기 쉬운 지점이었다. 별도 표에 남길 정도로 일반적인 함정은 아니라고 판단해 error.md에는
추가하지 않았다(원인이 이 함수 고유의 로직 구조에 한정된다).

### 변경 파일 (fix round 1)

- `supabase/migrations/20260911001000_stage1_procurement_schedule.sql` — `superseded_at` ·
  `superseded_by_plan_id` 열 · 인덱스 2개, 최신 승인본 확인, supersede UPDATE, 실제 입고일 승계 +
  `RECEIPT_ACTUAL_DATE_CARRIED_OVER` 이력, 세 집계 뷰 · `v_procurement_schedule`에 반영
- `supabase/tests/procurement_schedule/{fixtures.psql,scenarios.psql,run-all.sh,README.md}` — `make_approved_plan`에
  `p_version` 매개변수, S24~S29
- `lib/schedule/model.ts` · `model.test.ts` — `ProcurementScheduleRow.supersededAt/supersededByPlanId`
- `lib/schedule/repository.ts` — `getProcurementSchedules()`가 superseded 행을 뺀다

### 우려 사항 (fix round 1)

1. **`getProcurementScheduleByPlan`(지시에 따라 그대로 둠)은 superseded 필터가 없다** — 아직 어디서도
   쓰이지 않는 함수라 당장 문제는 없지만, 나중에 실제로 쓰게 되면(예: 계획 상세 화면에서 그 계획 하나의
   일정만 보여줄 때) superseded 행까지 같이 나온다는 점을 그 시점에 판단해야 한다. 오히려 "옛 계획을
   특정해서 볼 때는 superseded 행도 보여야 한다"가 맞을 수도 있어(계획 상세는 이력 조회에 가깝다)
   일부러 손대지 않았다.
2. **승계는 품목 + 공급처로만 짝을 맞춘다** — 같은 품목이라도 공급처가 바뀌면(마스터 데이터 변경 등)
   승계하지 않는다. 이 경우 실제 입고일은 옛(superseded) 행에만 남고 새 행에는 다시 입력해야 한다 —
   컨트롤러 판정 문구("same item + supplier")를 그대로 따른 결과다.
3. **한 번에 한 세대만 대체한다** — v1 → v2 → v3처럼 여러 세대가 이어져도, 각 빌드는 그 시점에
   "superseded_at is null"인 행만 대체한다(이미 v2가 대체한 v1 행은 v3 빌드가 다시 건드리지 않는다).
   따라서 v3가 v1의 행에서 직접 승계를 시도하지는 않지만, v2 빌드 때 이미 v1→v2로 값이 옮겨졌다면
   v3 빌드는 v2→v3로 다시 옮긴다 — 연쇄적으로 최신 행까지 이어진다(직접 확인하지는 않았으나 로직상
   당연히 성립한다. 필요하면 v1→v3 직접 승계 같은 다세대 케이스를 별도로 검증할 수 있다).

