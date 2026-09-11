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

## 8. Fix round 1 — 리뷰 발견 사항 수정

리뷰에서 Critical 1건 · Important 2건이 나왔다. 셋 다 고쳤다.

### 1) [Critical] 세션 timezone에 따라 반복 알림 시작 시각 · is_overdue가 달라지던 버그

**원인.** `(v_cycle.submission_deadline + 1) at time zone 'Asia/Seoul'`처럼 `date` 값에 바로
`AT TIME ZONE`을 걸면, PostgreSQL이 그 `date`를 먼저 **세션 `timezone` GUC**로 `timestamptz`로
암시적 캐스팅한 뒤(첫 번째 변환), 그 순간을 `'Asia/Seoul'` 벽시계로 바꿔 `timestamp`(시간대 없음)를
얻고(`AT TIME ZONE`의 timestamptz→timestamp 오버로드), 이 값을 다시 `timestamptz` 변수에 대입할 때
**세션 timezone으로 한 번 더** 해석한다(두 번째 변환). 두 변환 모두 세션 timezone에 좌우되므로,
Supabase 기본값인 UTC 세션에서는 결과가 최대 18시간까지 밀린다. 로컬 검증 클러스터의 기본
timezone이 `Asia/Seoul`이었던 우연 때문에(`show timezone;` → `Asia/Seoul`) 최초 라운드의 S8 · S9가
버그를 가린 채 통과했다.

**고침.** `date`를 먼저 명시적으로 `::timestamp`로 캐스팅한 뒤(이 캐스팅은 세션 timezone과 무관 —
그냥 자정을 붙인다) `AT TIME ZONE 'Asia/Seoul'`을 건다. 이러면 변환이 정확히 한 번, "이 벽시계
시각은 Asia/Seoul 것이다"라는 의미로만 일어나 세션 timezone과 완전히 무관해진다.

```sql
-- before (버그)
v_first_at := (v_cycle.submission_deadline + 1) at time zone 'Asia/Seoul';
-- after (고침)
v_first_at := (v_cycle.submission_deadline + 1)::timestamp at time zone 'Asia/Seoul';
```

두 곳을 고쳤다(`supabase/migrations/20260911000700_stage1_demand_submission.sql`):
`core.raise_demand_submission_reminders`의 `v_first_at` 계산, `analytics.v_demand_submission_status`의
`is_overdue`. **같은 패턴을 이 마이그레이션 전체에서 감사**했다 — 남은 두 곳
(`core.withdraw_demand_submission`과 `core.raise_demand_submission_reminders`의
`(clock_timestamp() at time zone 'Asia/Seoul')::date > submission_deadline`)은 반대 방향
(`timestamptz → timestamp`, absolute instant를 이미 들고 있는 `clock_timestamp()`를 벽시계로
바꾸는 것)이라 세션 timezone과 무관하며 버그가 없다 — 그대로 두었다. `lib/demand/model.ts`도
감사했다: `submissionDeadline`은 `Date.UTC`로만 계산하는 순수 달력 연산(시간대 개념이 없는 날짜라
문제 없음), `formatDemandDateTime`은 이미 절대 instant(ISO 문자열)를 `Intl.DateTimeFormat`의
명시적 `timeZone`으로 표시만 하는 함수라 문제 없음 — TS 쪽에는 같은 유형의 버그가 없었다.

**재현·회귀 방지.**
- `supabase/tests/demand_submission/lib.sh`에 `export PGOPTIONS="${PGOPTIONS:--c timezone=UTC}"`를
  추가해, 이 스위트가 항상 **명시적인** 세션 timezone(기본 UTC)에서 돈다 — 로컬 클러스터의 우연한
  기본값에 다시 가려지지 않는다.
- `scenarios.psql` S9에 세션 timezone과 완전히 무관한 절대 instant 회귀 검증을 추가했다: 기대값을
  `AT TIME ZONE` 변환을 전혀 거치지 않고 `'+09'` 오프셋 리터럴로 직접 만든다(Asia/Seoul은 연중
  DST가 없어 고정 +09).
  ```sql
  select demand_test.check(
    (select min(scheduled_at) from core.notification_outbox where payload ->> 'series_id' = ... )
    = ((select (submission_deadline + 1) from core.planning_cycle where cycle_id = :'cur_cycle')::text || ' 00:00:00+09')::timestamptz,
    'S9 첫 예약 시각(절대 instant) = 마감일+1일 00:00 Asia/Seoul — 세션 timezone과 무관하게 항상 같다');
  ```
- S8에도 `analytics.v_demand_submission_status.is_overdue`를 마감 경과(WITHDRAWN, true)와 마감
  전(WITHDRAWN, false) 양쪽으로 검증하는 assertion을 추가했다.

**증거 — 같은 스위트를 UTC와 America/Los_Angeles 세션 timezone에서 각각 실행(둘 다 전부 통과):**

```bash
$ LOG_DIR=/tmp/t7-fix1-utc bash supabase/tests/demand_submission/run-all.sh
scenarios: PASS 70 · FAIL/ERROR 2   # (S5 라벨 문자열의 "ERROR" 단어를 잡은 거짓 양성 — deferred 항목)
  S1 PASS 5 … S9 PASS 5 … S13 PASS 12
결과: 전부 통과

$ PGOPTIONS="-c timezone=America/Los_Angeles" LOG_DIR=/tmp/t7-fix1-la bash supabase/tests/demand_submission/run-all.sh
scenarios: PASS 70 · FAIL/ERROR 2
  S1 PASS 5 … S9 PASS 5 … S13 PASS 12
결과: 전부 통과
```

고치기 전(원래 방식으로 되돌려) 같은 UTC 세션에서 실행하면 S9의 새 절대 instant 검증이
"FAIL: S9 첫 예약 시각 …"으로 실패하며 정확히 18시간 어긋난 값을 보여준다는 것을 직접 확인했다
(리뷰가 지적한 방향·크기와 일치).

### 2) [Important] 취합 주기를 닫아도 진행 중인 제출본이 계속 편집·제출되던 문제

**원인.** `core.save_demand_submission_lines` · `core.submit_demand_submission` ·
`core.withdraw_demand_submission`이 제출본의 **상태**(DRAFT/WITHDRAWN/SUBMITTED)만 보고, 그
제출본이 속한 `core.planning_cycle`이 아직 열려 있는지는 전혀 확인하지 않았다. `close_planning_cycle`도
그 주기에 걸린 반복 미제출 알림을 정리하지 않았다.

**정책 결정(리뷰가 제시한 두 선택지 중 택1).** *닫힌 취합 주기에 묶인 미완료 제출본은 그 상태
그대로 얼어붙고, 다시 살아나지 않는다.* 같은 달을 다시 열면(`open_planning_cycle`) 항상 **새
`cycle_id`**로 새 취합 주기가 열리고, 부서가 재개 후 `start_demand_submission`을 부르면 그 새
`cycle_id`에 묶인 **새 제출본 행**이 만들어진다. 얼어붙은 옛 행은 `unique(cycle_id, department)`
제약 덕분에 여전히 부서·주기별로 유일하지만, 그 주기의 `is_active=false`라 더 이상 저장·제출·회수가
안 되는 읽기 전용 이력으로 남는다. "이전 미완료 제출본을 새 주기로 이어 붙인다"는 선택지는 채택하지
않았다 — 이력 왜곡(어느 주기에서 무엇을 했는지 뒤섞임)과 복사 로직의 예외 케이스가 늘어나는 데
비해, 부서 입장에서는 새로 시작해 다시 저장하는 비용이 거의 없기 때문이다.

**고침.**
- `core.save_demand_submission_lines` · `core.submit_demand_submission` · `core.withdraw_demand_submission`
  모두 부서 소유권 확인 직후 `exists (select 1 from core.planning_cycle c where c.cycle_id = ... and c.is_active)`를
  확인하고, 아니면 각각 "취합 주기가 닫혀 더 이상 수정/제출/회수할 수 없습니다."로 거절한다(함수
  안 — UI가 아니라).
- `core.close_planning_cycle`이 닫은 뒤, 그 주기의 필수 제출 부서(DEMAND_SUBMIT 활성 사용자가 있는
  부서)마다 `core.cancel_notification_series('DEMAND_SUBMISSION', cycle_id || ':' || department)`를
  불러 남아 있던 반복 미제출 알림을 전부 중단한다.
- "부서마다 활성 취합 주기에 묶인 제출본은 하나뿐"이라는 불변식은 기존 `unique(cycle_id,
  department)` 제약과 "활성 주기는 월별로 하나"(부분 유니크 인덱스)의 조합으로 **구조적으로**
  보장된다 — 별도 트리거 없이 자연히 성립한다.

**검증.** `scenarios.psql` S13(신규)이 앞의 S1~S12와 완전히 분리된 세 번째 달(오늘 + 4개월)로:
1. 닫기 전 반복 알림 4건을 미리 예약해 두고, `close_planning_cycle` 뒤 0건으로 정리됨을 확인.
2. 닫힌 주기의 DRAFT 제출본에 저장 · 제출을 시도하면 새 오류 메시지로 거절됨을 확인.
3. 거절 뒤에도 그 제출본 상태가 DRAFT로 그대로 얼어붙어 있음을 확인.
4. 같은 달을 다시 열면 새 `cycle_id`가 나오고(이전 것과 다름), 부서가 다시 시작하면 얼어붙은 것과
   다른 새 제출본이 생기며, "plan_month당 활성 취합 주기 1개" · "활성 주기당 부서 제출본 1개"가
   유지되고, 얼어붙은 행과 새 행이 이력으로 함께 남음을 확인(총 2건).

`run-all.sh`에 `S13`을 카운트 목록에 추가했다. UTC · America/Los_Angeles 두 번의 전체 실행 로그
(`S13 PASS 12`)로 이미 위에서 함께 확인했다.

### 3) [Important] 관리자 STEP 4 배치 업로드가 `demand_line`을 받아 원시 500을 내던 문제

**원인.** `lib/import/types.ts`의 `IMPORT_TYPES`에 `demand_line`을 추가하면서, 이 상수를 그대로
게이트로 쓰는 `app/api/admin/imports/parse/route.ts`도 `importType=demand_line`을 통과시키게
됐다. 그런데 `core.upload_batch.import_type` CHECK 제약(STEP 4)은 원래 8종류만 알고 `demand_line`은
모른다 — 통과된 요청은 `createImportBatch` 안의 INSERT에서 CHECK 위반(23514)으로 죽고, 그 오류가
route의 공통 `catch`를 타 **원시 500**으로 나간다(정상적인 400 검증 실패가 아니라).

**고침.** "검증 스키마 종류 전체"(`IMPORT_TYPES`, `IMPORT_SCHEMAS`/`validateRows`가 쓰는 것 — 9종,
`demand_line` 포함)와 "관리자 배치 업로드가 받는 종류"(`ADMIN_BATCH_IMPORT_TYPES` — 신설, 원래 8종,
`core.upload_batch` CHECK와 정확히 같음)를 `lib/import/types.ts`에서 분리했다.
`app/api/admin/imports/parse/route.ts`의 게이트를 `ADMIN_BATCH_IMPORT_TYPES`로 바꿔, `demand_line`을
포함한 목록 밖 값은 이제 평범한 400(`파일, 데이터 종류 또는 모드가 올바르지 않습니다.`)으로
거절되고 DB까지 가지 않는다. 같은 드리프트가 다시 생기지 않도록 `components/admin/import-manager.tsx`의
하드코딩된 종류 드롭다운도 이 상수를 참조하도록 바꿨다(전엔 route와 별개로 8종을 직접 나열하고
있었다 — 우연히 `demand_line`이 없었을 뿐 같은 상수를 안 쓰고 있었다).

**검증.** `lib/import/validate.test.ts`에 `ADMIN_BATCH_IMPORT_TYPES`가 `demand_line`을 포함하지
않고 `IMPORT_TYPES`에서 `demand_line`만 뺀 것과 정확히 같은 집합인지 확인하는 테스트를 추가했다
(`npm test` 186/186, 이 파일만 7/7). API 라우트 자체를 실행하는 테스트 하네스는 이 저장소에 없어
(`app/api/**/*.test.ts`가 `package.json`의 `node --test "lib/**/*.test.ts"` 글롭에 잡히지 않음 —
기존 관행도 route가 아니라 그 아래 `lib/` 순수 함수만 테스트한다), 실제로 게이트를 결정하는 상수
관계를 테스트했다.

### 재실행 결과

```bash
$ npx --no-install node --test "lib/demand/model.test.ts"            # 17/17
$ npx --no-install node --test "lib/import/validate.test.ts"         # 7/7 (신규 fix round 1 테스트 포함)
$ npx --no-install node --test "lib/permission.test.ts"              # 변화 없음, 그대로 통과
$ LOG_DIR=/tmp/t7-fix1-utc bash supabase/tests/demand_submission/run-all.sh                                    # 전부 통과 (UTC)
$ PGOPTIONS="-c timezone=America/Los_Angeles" LOG_DIR=/tmp/t7-fix1-la bash supabase/tests/demand_submission/run-all.sh  # 전부 통과 (LA)
$ npm test        # 186/186
$ npm run build   # 성공
$ git diff --check  # 출력 없음
```

### Deferred(이번에는 그대로 둠, 리뷰 지시대로)

- `run-all.sh`의 `FAIL|ERROR` grep이 "ERROR 행" 같은 한글 라벨 문자열 속 영단어까지 잡는 거짓 양성
  — 종료 코드와 "결과: 전부 통과" 줄이 실제 판정이다.
- 파일 업로드 크기 제한.
- 회수(withdraw)·합의(agree)의 타 부서 시나리오 추가.

## 9. Fix round 2 — 재검토에서 남은 문제 수정

라운드 1의 finding 1(timezone) · 3(관리자 배치 게이트)은 확인됐고, finding 2(취합 주기 닫기
잠금)는 **일부만** 고쳐져 있었다는 재검토 결과를 받았다.

### 남은 구멍 — `core.agree_demand_submission`에만 닫힌 주기 확인이 빠져 있었다

라운드 1에서 `save_demand_submission_lines` · `submit_demand_submission` · `withdraw_demand_submission`
세 곳에는 "제출본이 속한 취합 주기가 아직 열려 있는지" 확인을 추가했지만, **`agree_demand_submission`은
빠뜨렸다**(행 수 561~607, 라운드 1에서 손대지 않은 채로 남아 있었음 — 재검토가 정확히 지적한
범위). 그래서 재개(같은 달을 새 `cycle_id`로 다시 열기) 뒤에도, 옛(닫힌) 주기에 남아 있던
`SUBMITTED` 제출본을 SCM 품목담당자가 여전히 `AGREED`로 확정할 수 있었다 — "닫힌 주기의 행은
읽기 전용 이력"이라는 라운드 1의 정책을 실제로는 지키지 못하는 구멍이었다.

### 고침 1 — `agree_demand_submission`에 같은 확인 추가

다른 세 함수와 같은 위치(부서/권한 확인 뒤, 상태 확인 앞)에 같은 패턴으로 추가했다.

```sql
if not exists (select 1 from core.planning_cycle c where c.cycle_id = v_submission.cycle_id and c.is_active) then
  raise exception '취합 주기가 닫혀 더 이상 합의를 확정할 수 없습니다.' using errcode = '22023';
end if;
```

### 고침 2 — 구조적 안전장치(요청한 "no future path can break it")

"함수마다 확인을 빠짐없이 넣는다"는 방식 자체가 이번에 한 곳을 빠뜨려 뚫렸으므로, 애플리케이션
함수의 기억력에 기대지 않는 **DB 트리거**를 추가했다(리뷰가 제시한 선택지 중 "constraint trigger
that checks against active cycles"를 그대로 택함). "부서·기준월당 얼어붙지 않은 제출본은 하나뿐"을
`(plan_month, department)` 위의 부분 유니크 인덱스로 직접 강제하는 방식은 채택하지 않았다 —
PostgreSQL의 부분 인덱스 predicate은 다른 테이블(취합 주기의 `is_active`)을 참조하는 서브쿼리를
쓸 수 없어, "얼어붙었는가"를 판정하려면 `demand_submission`에 상태를 그때그때 동기화해야 하는
비정규화 컬럼이 필요하고, 그 동기화 자체가 또 다른 트리거라 트리거 방식보다 나을 게 없었다.

`core.demand_submission`과 `core.demand_submission_line` 각각에 BEFORE 트리거를 달았다
(`supabase/migrations/20260911000700_stage1_demand_submission.sql` §2-1, 신설):

- `core.guard_demand_submission_cycle_active()` — `demand_submission`의 모든 INSERT·UPDATE에서,
  그 행의 `cycle_id`가 가리키는 `planning_cycle.is_active`가 참이 아니면 무조건 거절한다
  (`'취합 주기가 닫힌 제출본은 더 이상 바꿀 수 없습니다.'`).
- `core.guard_demand_submission_line_cycle_active()` — `demand_submission_line`의 모든
  INSERT·UPDATE·DELETE에서, 그 줄이 속한 제출본의 취합 주기가 활성이 아니면 거절한다.

이 두 트리거는 애플리케이션 함수가 무엇을 확인했는지와 무관하게 **테이블 자체**에서 막기 때문에,
지금처럼 어느 함수 하나가 확인을 빠뜨리거나(이번 `agree_demand_submission`처럼), 앞으로 새 함수가
추가되거나, 권한이 잘못 넓어져 누군가 테이블에 직접 쓰더라도 규칙이 깨지지 않는다.

**이 트리거 + 기존 두 제약을 합치면 불변식이 구조적으로 성립한다.**
- "월(plan_month)당 활성 취합 주기는 하나"(§1, `planning_cycle(plan_month) where is_active` 부분
  유니크 인덱스 — 기존)
- "활성 주기당 부서 제출본은 하나"(§2, `unique(cycle_id, department)` — 기존)
- "닫힌 주기에 묶인 제출본은 절대 다시 바뀌지 않는다"(§2-1, 신설 트리거)

세 가지를 합치면 "부서·기준월당, 얼어붙지 않고 계속 바뀔 수 있는(=활성 주기에 묶인) 제출본은
항상 정확히 하나"가 어떤 실행 경로로도 깨지지 않는다 — 얼어붙은 옛 행이 몇 개가 이력으로 남아
있든, 그중 "살아있는" 것은 현재 활성 주기에 묶인 단 하나뿐이다.

### 검증 — `scenarios.psql` S13 확장

기존 S13(라운드 1, 취합 주기 닫기·재개)에 세 가지를 더했다:

1. **준비**: MARKETING의 DRAFT 제출본(`third_sub_a`)뿐 아니라, 같은 `third_cycle`에서 SERVICE가
   `SUBMITTED`까지 마친 제출본(`third_sub_svc`)도 미리 만들어 둔다(닫기 전).
2. **닫은 뒤 — 이번에 고친 구멍**: `third_sub_svc`(SUBMITTED)에 `agree_demand_submission`을
   부르면 `'취합 주기가 닫혀 더 이상 합의를 확정할 수 없습니다.'`로 거절되고, 상태는 SUBMITTED로
   그대로 남아 AGREED로 바뀌지 않음을 확인한다.
3. **재개 뒤 — 구조적 트리거 자체를 검증**: `core.start_demand_submission` 같은 애플리케이션
   함수를 거치지 않고, `core.demand_submission`에 **옛(닫힌) `third_cycle`**로 직접 `INSERT`를
   시도한다. `department`는 `BIZ_DEV`로 골라 `unique(cycle_id, department)`와는 무관하게(그
   조합엔 아직 행이 없다) 오직 "닫힌 주기" 판정만으로 거절되는지 확인하고, 실제로 행이 하나도
   남지 않았음을 재확인한다.

```bash
$ LOG_DIR=/tmp/t7-fix2-utc bash supabase/tests/demand_submission/run-all.sh
scenarios: PASS 75 · FAIL/ERROR 2   # (기존과 같은 라벨 문자열 거짓 양성, deferred)
  S1 PASS 5 … S9 PASS 5 … S13 PASS 17
결과: 전부 통과

$ PGOPTIONS="-c timezone=America/Los_Angeles" LOG_DIR=/tmp/t7-fix2-la bash supabase/tests/demand_submission/run-all.sh
scenarios: PASS 75 · FAIL/ERROR 2
  S1 PASS 5 … S9 PASS 5 … S13 PASS 17
결과: 전부 통과
```

로그에서 이번에 추가한 5개 assertion만 뽑아 직접 확인했다(전부 PASS):

```
PASS: S13 준비(fix round 2) — 닫기 전 SUBMITTED까지 마친 다른 부서 제출본
PASS: S13 (fix round 2) 닫힌 주기의 SUBMITTED 제출본은 합의 확정할 수 없다 → 22023 취합 주기가 닫혀 더 이상 합의를 확정할 수 없습니다.
PASS: S13 (fix round 2) 닫힌 주기의 SUBMITTED 제출본은 AGREED로 바뀌지 않고 그대로 얼어붙는다
PASS: S13 (fix round 2) 닫힌 주기로 새 제출본(unique 제약과 무관한 부서)을 직접 INSERT해도 구조적 트리거가 거절한다 → 22023 취합 주기가 닫힌 제출본은 더 이상 바꿀 수 없습니다.
PASS: S13 (fix round 2) 위 시도는 실제로 아무 행도 남기지 않는다(거절된 INSERT)
```

### 다른 경로 감사 결과 — 추가로 고칠 곳 없음

- `core.raise_demand_submission_reminders()`: 취합 주기를 순회하는 `for` 루프 자체가
  `where is_active and ...`로 시작해 닫힌 주기는 애초에 대상에 들지 않는다 — 별도 수정 불필요.
- `core.start_demand_submission()`: `select * into v_cycle from core.planning_cycle where
  plan_month = v_month and is_active for update`로 활성 주기만 골라 잠그므로, 닫힌 주기로는
  제출본을 만들 수도 이어서 쓸 수도 없다(신설 INSERT 트리거와도 이중으로 일치) — 별도 수정 불필요.
- `core.close_planning_cycle()`은 `planning_cycle`만 쓰고 `demand_submission`을 건드리지
  않으므로 새 트리거와 충돌하지 않는다.
- `core.demand_submission_event`는 append-only 이력 테이블이라 상태 변경 자체가 아니라 "무엇이
  있었는지"를 남기는 곳이다. 그 테이블에 쓰는 모든 코드 경로는 이미 성공한 `demand_submission`
  갱신 뒤에만 실행되므로(트리거가 막았다면 그 갱신도 실패해 이벤트도 안 남는다), 별도 가드가
  필요 없다.

### 재실행 결과

```bash
$ npx --no-install node --test "lib/demand/model.test.ts"      # 17/17 (변화 없음)
$ npx --no-install node --test "lib/import/validate.test.ts"   # 7/7 (변화 없음)
$ LOG_DIR=/tmp/t7-fix2-utc bash supabase/tests/demand_submission/run-all.sh                                    # 전부 통과 (UTC)
$ PGOPTIONS="-c timezone=America/Los_Angeles" LOG_DIR=/tmp/t7-fix2-la bash supabase/tests/demand_submission/run-all.sh  # 전부 통과 (LA)
$ npm test        # 186/186
$ npm run build   # 성공
$ git diff --check  # 출력 없음
```

### Deferred(이번에도 그대로 둠, 리뷰 지시대로)

- `lib.sh`의 `PGOPTIONS` 값을 호출자가 미리 설정해 뒀을 때 그대로 통과시키는지(passthrough) 별도
  손대지 않았다 — 이미 `export PGOPTIONS="${PGOPTIONS:--c timezone=UTC}"`로 호출자 값이 있으면
  그 값을 쓰고 없을 때만 UTC로 기본값을 채운다(라운드 1에서 이미 이 모양으로 구현됨). 이번
  라운드의 두 실행(UTC 기본값 · `PGOPTIONS="-c timezone=America/Los_Angeles"` 오버라이드)이 그
  동작을 그대로 증명한다.
- 관리자 `validate`/`commit` 라우트의 `importType` 재확인 — `parse` 단계에서 이미
  `ADMIN_BATCH_IMPORT_TYPES`로 막혀 그 이후 단계로 `demand_line`이 흘러갈 경로 자체가 없다.
