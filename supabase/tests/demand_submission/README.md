# 부서별 월간 수요 제출 · 마감 관리 DB 검증 (Task 7)

`supabase/migrations/20260911000700_stage1_demand_submission.sql`의 취합 주기 · 제출 · 저장 ·
제출 · 회수 · 합의 · 마감 경과 알림 규칙을 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는
테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대 실행하지
않습니다. 구조는 `supabase/tests/sales_order_allocation`(Task 5 · 6)과 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 ·
  품목을 넣습니다.

## 실행

```bash
bash supabase/tests/demand_submission/run-all.sh
```

출력 예:

```text
scenarios: PASS 46 · FAIL/ERROR 0
  S1 PASS 5 … S12 PASS 4
결과: 전부 통과
삭제: scm_test_demand_20260912…
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션 → 0700(Task 7) 재적용(재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) — `sales_order_allocation`과 동일 |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 — 동일 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) — 동일 |
| `fixtures.psql` | 검증용 사용자 7명(SCM 품목담당자 · SCM팀장 · 마케팅 2명 · 서비스 · ADMIN · 부서 미설정) · 품목 2개, 검증 헬퍼 스키마 `demand_test` |
| `scenarios.psql` | S1 마감일 계산(28·29·30·31일 말일 + stage1 예시) · S2 취합 주기 열기(권한·중복 월) · S3 제출 시작(권한·열린 주기·부서·멱등) · S4 항목 저장(품목코드 불일치·null 수량·잘못된 필요월을 행 오류로) · S5 제출(ERROR 행 차단) · S6 합의 확정(권한·잠금) · S7 회수(마감 전) · S8 회수(마감 후 알림 재개) · S9 Cron 함수(마감 경과 미제출 알림·중복 없음·제출 시 중단) · S10 RLS(다른 부서 차단·SCM/ADMIN 전체) · S11 이력 append-only·유일성 · S12 취합 주기 닫기·재개 |

## 안전장치

- DB 이름은 `scm_test_`로 시작해야 하고, `PGHOST`가 소켓 디렉터리 · `localhost`가 아니거나
  `PGHOSTADDR` · `PGSERVICE`가 설정돼 있으면 셸 스크립트가 실행 전에 거절합니다(`lib.sh`).
- 모든 `.psql` 파일은 `\ir guard.psql`로 시작해, 접속한 DB 이름이 `scm_test_*`이고 TCP라면 루프백일 때만
  계속합니다. 원격 Supabase(DB 이름 `postgres`)에 붙여 넣어도 첫 문장에서 멈춥니다.
- 확장자를 `.sql`이 아니라 `.psql`로 둔 이유: `supabase test db`(pg_prove)가 `supabase/tests`의 `.sql`을
  테스트로 실행하지 않게 하기 위해서입니다.
- fixture와 헬퍼는 임시 DB 안에서만 만들어지며 `supabase/migrations`에 들어가지 않습니다.
- 마감 경과 시나리오는 실제 시간을 기다리지 않습니다. 이번 달(`cur_month`)의 마감일은 항상
  "대상월 1일 - 2일"이라 오늘보다 반드시 과거이고, 두 달 뒤(`future_month`)는 반드시 미래입니다 —
  둘 다 스크립트 실행 시점의 `current_date`에서 결정론적으로 계산합니다.

## 정리

- `run-all.sh`는 성공 · 실패 · 중단(Ctrl+C) 모두에서 임시 DB를 `dropdb`합니다(`KEEP_DB=1`이 아니면).
- 로그는 `LOG_DIR`에 남습니다(기본 임시 디렉터리 — 필요 없으면 지웁니다).

## 함수를 바꿀 때

1. 바꾼 규칙의 시나리오를 `scenarios.psql`에 새 절(`== S13 …`)로 추가하고, 필요한 사용자 · 품목은
   `fixtures.psql`에 넣습니다.
2. `run-all.sh`를 다시 실행해 기존 S1~S12가 그대로 통과하는지 확인합니다.
