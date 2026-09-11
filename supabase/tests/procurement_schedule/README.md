# 발주 일정 · 입고 차이 DB 검증 (Task 10b)

`supabase/migrations/20260911001000_stage1_procurement_schedule.sql`의 `core.build_procurement_schedule`
(승인된 발주계획 1개월차 라인 → 공급처 출항일 → 발주 · 입고 일정), `core.record_actual_receipt_date`
(실제 입고일 입력), 세 집계 뷰(`analytics.v_receipt_gap_entity/_item/_month`)를 **로컬 PostgreSQL 임시
DB**에서 실제로 실행해 확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격)
프로젝트에는 절대 실행하지 않습니다. 구조는 `supabase/tests/master_edit`(Task 10a)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다.

## 실행

```bash
bash supabase/tests/procurement_schedule/run-all.sh
# 다른 세션 timezone에서도(배포 환경은 보통 UTC):
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/procurement_schedule/run-all.sh
```

종료 코드 0이면 전부 통과입니다. 실패하면 요약 아래에 실패 줄이 나오고 로그 경로가 첫 줄에 있습니다.

| 환경변수 | 뜻 |
|---|---|
| `KEEP_DB=1` | 끝난 뒤 임시 DB를 지우지 않는다(조사용, 직접 `dropdb`) |
| `LOG_DIR=…` | 로그 위치. 기본은 `mktemp`로 만든 임시 디렉터리 |

## 파일

| 파일 | 역할 |
|---|---|
| `run-all.sh` | 전체 실행과 요약, 종료 시 임시 DB 삭제(`trap`) |
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션(대상 마이그레이션은 자기 순서 자리에서 곧바로 한 번 더 적용 — 재실행 안전성) |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 다른 스위트와 동일(로컬 대상 확인 · 안전장치 · 최소 auth 스텁) |
| `fixtures.psql` | SCM 품목담당자 1명 · SCM팀장 1명 · 권한 없는 사용자 1명, 검증 전용 해외법인 2곳(T10B·T10B2, JP는 STEP 18 시드값 그대로 사용) · 공급처 7곳(정상 · 규칙 없음 · 규칙 중복 · 기간 만료 · JP 준비기간 미확인 · 법인2 · 매월 31일) · KR 영업일 달력 준비 상태(10~12월 준비, 8월은 의도적으로 미준비) · 공휴일 1건(2026-11-20) · 품목 10개(`raw.item_master`) · 승인된 발주계획 3건(11월 · 8월 · 12월) + 미승인 계획 2건(DRAFT · PENDING_APPROVAL). 계획은 Task 9b 확정 · 승인 함수와 같은 최종 상태를 직접 만든다(그 파이프라인 자체는 `supabase/tests/procurement_plan`이 검증한다) |
| `scenarios.psql` | 아래 표 |

## 시나리오

| # | 확인 내용 |
|---|---|
| S1 | 권한 없음(MARKETING) · PLAN_APPROVE만 있는 사용자는 `build_procurement_schedule` 거절 |
| S2 | DRAFT · PENDING_APPROVAL · 존재하지 않는 계획은 거절 |
| S3 | 승인된 계획(11월) → 1개월차 · 발주량>0 라인 8개 전부 일정 행이 생긴다(조용히 안 빠진다) |
| S4 | 정상 계산(T10BITM1) — 출항일 · 기준/요청 발주일 · 계획/확정 입고일이 브리프 공식대로(금요일 공휴일+주말 → 목요일), ISO 주차 묶음, `gap_reason_code=ACTUAL_RECEIPT_UNSET` |
| S5 | 주말 조정(T10BITM9) — 기준 발주일이 일요일이면 이전 금요일로(월 경계를 넘는다), 입고일은 조정 없음 |
| S6 | SUPPLIER_UNSET — 매핑 없음 · 존재하지 않는 공급처 코드 |
| S7 | DEPARTURE_RULE_UNSET — 규칙 없음 |
| S8 | DEPARTURE_RULE_AMBIGUOUS — 활성 규칙 중복(고르지 않는다) |
| S9 | SUPPLIER_INACTIVE — 출항일 기준 공급처 적용 기간 밖(출항일 자체는 남는다) |
| S10 | PREP_DAYS_UNSET — 실제 JP 법인(STEP 18 시드값 준비기간 0)으로 재현 |
| S11 | CALENDAR_NOT_READY — KR 달력 미준비 달(8월)은 주말만으로 추정하지 않는다 |
| S12 | 연 경계 ISO 주차 — 2026-12-31 출항 → `2026-W53`, 정상 계산 |
| S13 | 재실행(idempotent) — 행 수 · `schedule_id` 불변 |
| S14 · S14b | 실제 입고일 입력 — 지연(양수) · 조기(음수) 모두 부호 있는 일수로만 저장(상태 코드 없음), 입력자 · 이력(`core.audit_log`) 기록 |
| S15 | 재실행 뒤에도 실제 입고일이 보존된다 |
| S16 | 실제 입고일 null → 차이 null + `ACTUAL_RECEIPT_UNSET` |
| S17 | PLAN_CONFIRM이 아니면 실제 입고일 입력 거절 |
| S18 | 계산되지 않은(EXCLUDED) 일정에는 실제 입고일을 입력할 수 없다 |
| S19 | 법인 · 품목 · 월별 집계(`v_receipt_gap_*`)가 같은 원천 행을 쓴다(합이 서로 같다) |
| S20 | 평균 · 합계는 실제 입고일이 있는 행만 쓴다(미기록 행은 섞지 않는다) |
| S21 | 월별 집계는 확정 계획 입고일 기준이다 |
| S22 | RLS — 권한 없는 사용자는 테이블 · 뷰 모두 0건 |
| S23 | 하드 쓰기 금지 — `authenticated`는 함수 없이 테이블을 직접 쓸 수 없다 |

## 안전장치

다른 스위트(`master_edit` 등)와 동일합니다 — DB 이름은 `scm_test_`로 시작해야 하고, 로컬 소켓/루프백이
아니면 거절하며, 이 스위트는 자신이 만든 DB(`scm_test_procsched_`로 시작)만 정리합니다.

## 알아 둘 것 — `\gset`과 NULL(error.md #26)

`\gset`은 컬럼값이 NULL이거나 결과행이 0건이면 그 psql 변수를 설정하지 않습니다. 이 스위트도 처음에는
`reason_code`(SCHEDULED면 NULL)와 `gap_reason_code`(실제 입고일이 있으면 NULL)를 `\gset`으로 받으려다
`syntax error at or near ":"`를 만났습니다 — NULL이 될 수 있는 열은 `sched_test.check((select ... from
...), '설명')`처럼 조건을 서브쿼리 안에서 통째로 판정하도록 고쳤습니다.
