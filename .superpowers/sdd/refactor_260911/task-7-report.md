# Task 7 보고서 — 부서별 월간 수요 제출과 마감 관리

## 1. 구현 내용 — 규칙별 반영

### 브리프 체크리스트

- **28·29·30·31일 말일 제출 마감 테스트를 먼저 작성** — `lib/demand/model.test.ts`의
  `submissionDeadline` 테스트(31일=stage1 예시, 28일 평년 2월, 29일 윤년 2월, 30일 4월,
  연도 경계 1월)를 `model.ts` 구현보다 먼저 커밋 순서로 작성·실행해 RED를 확인했다(§3 TDD 근거).
  같은 값을 `supabase/migrations/.../core.submission_deadline`에도 구현하고
  `supabase/tests/demand_submission/scenarios.psql` S1에서 SQL 쪽으로 같은 다섯 케이스를
  재확인한다 — 공식은 `date_trunc('month', p_plan_month)::date - 2`(대상월 1일 − 2일 = 전월
  말일 − 1일) 하나로 4가지 말일 길이를 모두 처리한다.
- **DEMAND_SUBMIT 권한이 있는 사용자는 자기 부서 자료만 작성** — `core.start_demand_submission` ·
  `core.save_demand_submission_lines` · `core.submit_demand_submission` ·
  `core.withdraw_demand_submission`이 모두 `auth.uid()`의 `core.app_user.department`와
  제출본의 `department`를 비교해 다르면 42501로 거절한다(함수 내부 가드). 부서 소속이므로
  같은 부서의 다른 사용자(마케팅1·마케팅2)는 같은 제출본을 함께 본다(get-or-create).
- **파일 업로드와 직접 입력 모두 STEP 4의 품목코드 검증 재사용** — `lib/import/types.ts`에
  `demand_line` import type을 추가하고, `lib/import/schema.ts`에 `item_id(reference:'item')` ·
  `qty(kind:'number')` · `need_month(kind:'month'` — 새 kind)` 필드를 등록했다.
  `lib/import/validate.ts`에 `validMonth()`를 추가해 `kind==='month'`를 처리한다.
  `lib/demand/actions.ts`의 `persistDemandLines()`가 파일 업로드(`uploadDemandLinesAction`,
  `suggestColumnMapping`으로 한글 헤더도 매핑)와 직접 입력(`saveDemandLinesAction`) 양쪽에서
  **같은** `validateRows('demand_line', rows, references)` 경로를 탄다. `references.itemIds`는
  `lib/import/repository.ts`의 기존 `importReferences()`(→ `core.v_item_master`)를 그대로
  재사용한다.
- **품목코드 불일치·null 수량·잘못된 날짜를 행 오류로 남긴다(조용히 제외 X)** —
  `core.save_demand_submission_lines`가 매 저장마다 기존 행을 지우고 새로 넣되, 문제 있는 행도
  `item_id`/`qty`/`need_month`를 `null`로 두고 `issues jsonb`에 `{field_name, code, message}`를
  남긴다. 컨트롤러 판정 4에 따라 품목코드는 **DB에서 `core.v_item_master`로 다시** 확인한다
  (클라이언트 `validateRows` 결과를 신뢰하지 않고, DB 함수가 `core.normalize_item_id` +
  존재 확인을 자체적으로 수행 — DB측 매칭).
- **제출 완료 시 해당 부서 반복 미제출 알림 중단** — `core.submit_demand_submission`이 트랜잭션
  안에서 `core.cancel_notification_series('DEMAND_SUBMISSION', cycle_id || ':' || department)`를
  호출한다(Task 3 함수 재사용).
- **SCM 취합 화면 — 제출 여부·오류 건수·마지막 수정자와 시각을 한 화면에** —
  `analytics.v_demand_submission_status`(security_invoker) 한 뷰에 모두 담고,
  `components/demand/submission-status-table.tsx` 하나로 `/demand-submissions`(SCM/ADMIN
  분기 시 전체, 부서 사용자는 RLS로 본인 부서만)와 `/admin/demand`(ADMIN 오버뷰)가 공유한다.

### 컨트롤러 판정 1~7

1. **마감일 공식·재발송 시작 시각** — §3 공식 채택(위 참고). 미제출 반복 알림은
   `core.raise_demand_submission_reminders()`가 "마감일 + 1일 00:00 Asia/Seoul"을 **고정 시각**
   으로 계산해 `core.schedule_demand_submission_reminder`를 부른다. 고정 시각이라
   `core.enqueue_notification`의 `dedupe_key`가 10분마다 재호출해도 겹쳐 중복 예약되지 않는다
   (S9로 검증). 10분 반복 자체는 Task 3의 `core.finish_notification`이
   `DEMAND_SUBMISSION_OVERDUE` 템플릿을 계속 재예약하며 이어간다(수정하지 않음).
2. **필수 제출 부서 = DEMAND_SUBMIT 활성 사용자가 있는 부서** — 별도 부서 마스터를 두지 않고,
   `raise_demand_submission_reminders()`와 `withdraw_demand_submission()` 둘 다
   `core.app_user ⋈ core.role_permission`에서 그때그때 계산한다(S9에서 마케팅1·마케팅2 두 명 ×
   2채널 = 4건으로 확인).
3. **취합 주기는 시딩하지 않고 화면에서 연다** — `core.open_planning_cycle`(`PLAN_CONFIRM` 또는
   ADMIN, 월별 유니크 부분 인덱스로 "활성 주기 1개/월" 보장) + `core.close_planning_cycle`.
   닫은 뒤 같은 달을 다시 열 수 있다(이력 보존, S12로 확인).
4. **부서 사용자는 관리자 전용 import batch를 거치지 않는다** — `core.upload_batch` /
   `core.commit_import_batch`(ADMIN 전용, STEP 4)는 전혀 손대지 않았다. 대신 서버 액션이
   파일을 직접 읽어(`lib/import/parse.ts`의 `parseCsv`/`parseExcel` 재사용) 파싱하고,
   `core.demand_submission_line`에 바로 저장한다. 직접 입력도 같은 저장 함수를 탄다.
5. **상태 전이와 이력** — `DRAFT → SUBMITTED → WITHDRAWN → (편집) → SUBMITTED → AGREED`를
   `core.demand_submission.status` CHECK로 강제하고, 모든 전이가
   `core.demand_submission_event`(append-only, BEFORE UPDATE/DELETE 트리거로 차단, S11 확인)에
   `version · actor · actor_name · at · reason(있으면)`을 함께 남긴다. AGREED는
   `core.agree_demand_submission`(`PLAN_CONFIRM` 또는 ADMIN)만 호출할 수 있고 성공하면
   `save_demand_submission_lines`가 더 이상 허용하지 않는다(잠금, S6로 확인). 마감 후 회수는
   `withdraw_demand_submission`이 같은 트랜잭션에서 즉시 알림을 재개한다(S8로 확인).
6. **부서는 자기 제출본만, SCM/ADMIN은 전체** — RLS(`demand_submission_read_own_or_scm`)가
   `DEMAND_SUBMIT ∧ 같은 부서` 또는 `DEMAND_CONSOLIDATE ∨ PLAN_CONFIRM ∨ is_admin()`만
   SELECT를 통과시킨다(S10로 확인). 쓰기는 RLS가 아니라 **테이블 GRANT 자체를 authenticated에서
   회수**하고 모든 변경을 security definer 함수로만 허용하며, 각 함수가 부서를 다시 비교한다
   (서버 함수 가드가 최종 방어선 — S4·S5에서 "다른 부서" 호출이 42501로 거절됨을 확인).
7. **더미 데이터 금지 · 재실행 안전 · 검증 쿼리** — 운영 테이블에는 아무 것도 넣지 않았다(더미 데이터는
   `supabase/tests/demand_submission/fixtures.psql`에만, 로컬 임시 DB 전용). 마이그레이션은
   `create table if not exists` / `create or replace function|view` / `drop policy if
   exists` 조합으로 재실행 안전하며, `bootstrap.sh`가 전체 마이그레이션 적용 뒤 0700을 한 번 더
   재적용해 이를 실측 검증한다. 파일 맨 끝에 수동 적용 후 확인 쿼리(마감일 4종 · 유일성 · 취합
   현황 · 실패 검증 스니펫)를 주석으로 남겼다.

## 2. 테스트와 결과

### TDD 증거 — RED → GREEN

```bash
$ npx --no-install node --test "lib/demand/model.test.ts"   # model.ts 작성 전
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../lib/demand/model.ts'
✖ lib/demand/model.test.ts … fail 1
```

`lib/demand/model.ts` 구현 후:

```bash
$ npx --no-install node --test "lib/demand/model.test.ts"
✔ 제출 마감일 — 31일 말일(3월) → stage1 예시와 동일하게 3월 30일
✔ 제출 마감일 — 30일 말일(4월) → 4월 29일
✔ 제출 마감일 — 28일 말일(평년 2월) → 2월 27일
✔ 제출 마감일 — 29일 말일(윤년 2월) → 2월 28일
✔ 제출 마감일 — 연도 경계(1월 대상월)도 전년 12월 기준으로 계산한다
… (총 17개)
ℹ tests 17 · pass 17 · fail 0
```

동일 값을 SQL에서도(`core.submission_deadline`) `supabase/tests/demand_submission/scenarios.psql`
S1에서 재확인(아래 DB 스위트 결과).

### 커밋된 스크래치 DB 스위트 실행 결과

```bash
$ bash supabase/tests/demand_submission/run-all.sh
DB: scm_test_demand_20260912024343 · 로그: /tmp/t7-demand-logs3
bootstrap 완료: scm_test_demand_20260912024343 (마이그레이션 전체 적용 + 20260911000700_stage1_demand_submission.sql 재적용)
scenarios: PASS 55 · FAIL/ERROR 2   ← "FAIL|ERROR" grep이 S5 라벨 문자열 속 "ERROR"까지 잡은
                                       거짓 양성. 종료 코드/아래 "전부 통과"가 실제 판정이다.
  S1 PASS 5   S2 PASS 5   S3 PASS 7   S4 PASS 8   S5 PASS 6   S6 PASS 4
  S7 PASS 5   S8 PASS 1   S9 PASS 4   S10 PASS 3  S11 PASS 4  S12 PASS 3
결과: 전부 통과
삭제: scm_test_demand_20260912024343
```

3회 반복 실행(같은 결과, 종료 코드 0)으로 안정성을 확인했다. S1~S12가 브리프 검증 항목과
컨트롤러 판정을 각각 다룬다(README.md에 목록 정리).

### 포커스 테스트 · 전체 테스트 · 빌드

```bash
$ npx --no-install node --test "lib/import/validate.test.ts"
✔ 부서 수요 제출 줄 — 품목코드 불일치·null 수량·잘못된 필요월을 행 오류로 남긴다 (Task 7)
ℹ tests 6 · pass 6 · fail 0

$ npm test
ℹ tests 185 · pass 185 · fail 0

$ npm run build
✓ Compiled successfully
Route (app) … demand-submissions … demand-submissions/[submissionId] … api/cron/demand-submissions
```

`npm test`에서 기존 `lib/permission.test.ts`의 SCM_PLANNER 메뉴 스냅샷이 1건 깨졌다 —
`/demand-submissions`를 `PLAN_CONFIRM`에도 열어준 정당한 부작용이라 기대값에 `'수요 제출'`을
추가해 고쳤다(§3 참고).

```bash
$ git diff --check
(출력 없음 — 끝공백 없음)
```

## 3. TDD Evidence 요약 (재요청 형식)

- RED: `lib/demand/model.test.ts` 작성 → `node --test` 모듈 없음으로 실패.
- GREEN: `lib/demand/model.ts` 구현(마감일 포함 12개 함수) → 17/17 통과.
- 이어서 `lib/import/schema.ts` · `validate.ts`에 `demand_line` 타입을 추가하고
  `lib/import/validate.test.ts`에 케이스 추가 → 6/6 통과(재사용 검증).
- SQL 쪽은 마이그레이션 작성 후 `supabase/tests/demand_submission` 스위트로 51개 시나리오
  검증(1회차 실패 1건을 발견·수정 — 아래 self-review 참고).

## 4. 파일 변경

**생성**
- `supabase/migrations/20260911000700_stage1_demand_submission.sql`
- `lib/demand/{model.ts, model.test.ts, repository.ts, actions.ts}`
- `app/(user)/demand-submissions/[submissionId]/page.tsx`
- `app/api/cron/demand-submissions/route.ts`
- `components/demand/{submission-form.tsx, submission-status-table.tsx}`
- `supabase/tests/demand_submission/{README.md, guard.psql, lib.sh, auth-stub.psql, bootstrap.sh, fixtures.psql, scenarios.psql, run-all.sh}`

**수정**
- `app/(user)/demand-submissions/page.tsx` (placeholder → 실제 화면)
- `app/(admin)/admin/demand/page.tsx` (placeholder → ADMIN 취합 오버뷰)
- `lib/import/schema.ts` · `lib/import/types.ts` · `lib/import/validate.ts` · `lib/import/validate.test.ts` (`demand_line` import type 추가)
- `lib/permission.ts` (`/demand-submissions` anyOf에 `PLAN_CONFIRM` · `DEMAND_CONSOLIDATE` 추가 — 아래 5번 참고)
- `lib/permission.test.ts` (위 변경에 따른 SCM_PLANNER 메뉴 기대값 갱신)
- `docs/notification-operations.md`, `vercel.json` (새 Cron 라우트 문서화·등록)
- `styles/components.css` (기존 클래스로 부족한 `.demand-line-row` · `.demand-issue-list`만 끝에 추가)

## 5. 계획과 다른 결정 — WORK_ROUTE_PERMISSIONS 확장

브리프 파일 목록에는 없지만 필요해서 바꾼 것: `lib/permission.ts`의
`WORK_ROUTE_PERMISSIONS['/demand-submissions']`를 `['DEMAND_SUBMIT']`에서
`['DEMAND_SUBMIT', 'PLAN_CONFIRM', 'DEMAND_CONSOLIDATE']`로 넓혔다. 이유: `app/(admin)/layout.tsx`가
`requireAdmin()`으로 **ADMIN 역할만** 통과시키므로, `(admin)/admin/demand`는 SCM 품목담당자(역할은
USER, 업무 권한만 PLAN_CONFIRM)가 절대 들어올 수 없다. 컨트롤러 판정 5("SCM 품목담당자 또는
ADMIN이 합의를 확정")를 만족하려면 SCM 품목담당자가 실제로 쓰는 화면은 `(user)` 그룹의
`/demand-submissions`(+상세)여야 한다. 그래서:
- `/demand-submissions`·`/demand-submissions/[id]`는 DEMAND_SUBMIT(자기 부서 작성·제출·회수) ·
  PLAN_CONFIRM/DEMAND_CONSOLIDATE(전체 취합 현황·합의 확정)를 **같은 경로**에서, RLS로 조회
  범위만 가른다.
- `(admin)/admin/demand`는 ADMIN 전용 오버뷰(읽기)로 남기고, "수정: app/(admin)/admin/demand/page.tsx"
  지시는 그대로 지켰다(준비 중 → 실제 취합 상태 뷰).

## 6. Self-Review에서 찾은 문제와 수정

1. **파일 업로드가 한글 헤더(품목코드·수량·필요월)를 매핑하지 않던 버그.** 최초 구현에서
   `uploadDemandLinesAction`이 파싱된 행을 바로 `validateRows`에 넘겨, STEP 4 admin import
   흐름과 달리 `suggestColumnMapping`을 거치지 않았다 — 표준 이름(`item_id`/`qty`/`need_month`)이
   아닌 헤더는 전부 "필수값 없음"으로 오판정됐을 것이다. `admin/imports/validate` 라우트의 패턴을
   그대로 가져와 업로드 경로에서만 매핑을 적용하도록 고쳤다(직접 입력은 이미 표준 이름으로
   만들어지므로 매핑이 필요 없다). `npm run build`로 재확인.
2. **`core.close_planning_cycle`과 `ClosePlanningCycleForm`이 어느 화면에도 연결되지 않은
   죽은 코드였다.** `/demand-submissions`의 "열린 취합 주기" 패널에 닫기 버튼을 붙였다(커밋
   `ded874d`).
3. **`lib/demand/model.test.ts`의 버전 증가 기대값 오류**(직접 발견 — DB 스위트 1회차 실행에서
   드러남): S5에서 "저장 → 재저장 → 제출"을 거치며 버전이 1→4가 되는데 처음엔 1→3으로 잘못
   기대했다. 시나리오 주석을 버전 변화 순서와 함께 고쳤다.
4. 그 외 항목(권한 이중 검사, RLS와 서버 가드 분리, append-only 트리거, 마감일 공식)은 DB
   스위트가 실제로 실행해 통과했으므로 별도 발견 사항 없음.

## 7. 남은 우려 · 사용자가 수동으로 할 일

- **Supabase 적용은 수동입니다.** `supabase/migrations/20260911000700_stage1_demand_submission.sql`을
  SQL Editor에서 실행하세요. 재실행 안전하지만, 실행 후 파일 맨 끝의 확인 쿼리(마감일 4종 ·
  유일성 · 취합 현황)로 직접 확인하는 것을 권합니다.
- **Vercel Cron 등록**: `vercel.json`에 `/api/cron/demand-submissions`(10분)를 추가했지만, Vercel
  Hobby 플랜에서는 이 주기를 지원하지 않습니다(`docs/notification-operations.md` 기존 경고와 동일
  제약). Pro 이상이거나 동등한 외부 스케줄러가 필요합니다.
- **제출·회수 이력(모든 event) 화면은 아직 없습니다.** `core.demand_submission_event`는 이미
  append-only로 전부 기록되고 RLS로 읽을 수 있지만, orders 상세처럼 이력을 타임라인으로 보여주는
  UI는 Task 7 범위상 만들지 않았습니다(브리프 파일 목록에 없음). 필요하면 후속 작업에서
  `analytics.v_demand_submission_status`처럼 뷰 하나만 더 얹으면 됩니다.
- **Task 8과의 경계**: 이 Task에서 만든 제출·합의 자체는 조달 수요로 집계되지 않습니다(주석으로
  명시). Task 8이 "확정" 소스를 별도로 만들 때 `core.demand_submission`(AGREED)을 입력 중 하나로
  참조할 것으로 예상됩니다.
- **Task 12 연동**: `analytics.v_planning_cycle`(및 `core.planning_cycle` 직접 select도 권한
  부여됨)을 대시보드 기준월 조회에 쓸 수 있습니다.
- 새로 발견한 재현 가능한 오류는 없어 `error.md`에 추가하지 않았습니다(위 self-review 3건은 구현
  중 자체 발견·즉시 수정한 것으로, 사용자가 겪을 재현 오류가 아닙니다).
