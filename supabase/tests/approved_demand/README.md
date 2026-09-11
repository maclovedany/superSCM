# 확정 수요 구성 DB 검증 (Task 8)

`supabase/migrations/20260911000800_stage1_approved_demand.sql`의 수급회의 결과 대리 입력, 이벤트
추가 수요 등록·승인, 확정 수요 집계(analytics.v_approved_demand_detail · v_approved_demand_monthly)
규칙을 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는 테스트 전용 스크립트입니다. 마이그레이션이
아니며, Supabase(원격) 프로젝트에는 절대 실행하지 않습니다. 구조는
`supabase/tests/demand_submission`(Task 7)과 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 ·
  품목 · 부서 제출을 넣습니다.

## 실행

```bash
bash supabase/tests/approved_demand/run-all.sh
```

출력 예:

```text
scenarios: PASS 39 · FAIL/ERROR 0
  S1 PASS 3 … S14 PASS 1
결과: 전부 통과
삭제: scm_test_approved_20260912…
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션 → 0800(Task 8) 재적용(재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) — `demand_submission`과 동일 |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 — 동일 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) — 동일 |
| `fixtures.psql` | 검증용 사용자 5명(SCM 품목담당자 · SCM팀장 · 마케팅 · ADMIN · 겸직 합성 계정) · 품목 2개, 근거로 쓸 AGREED/SUBMITTED 부서 제출 줄, 검증 헬퍼 스키마 `approved_test` |
| `scenarios.psql` | S1 수급회의 결과 입력(권한·검증) · S2 수정 이력(append-only) · S3 근거 제출 항목 검증 · S4 이벤트 등록 검증 · S5 승인 전 0건 · S6 요청자 자기승인 차단 · S7 승인 후 전량 반영 · S8 반려 후 0건 · S9 수급회의 미승인 제외 · S10 확정 전 주문 0건(확률 100%라도) · S11 확정 주문 집계(수량·월) · S12 취소 주문 0건(주문번호 보존) · S13 RLS · S14 SQL 계약(확률·파트너 선주문·레거시 테이블 미참조) |

## 안전장치

- DB 이름은 `scm_test_`로 시작해야 하고, `PGHOST`가 소켓 디렉터리 · `localhost`가 아니거나
  `PGHOSTADDR` · `PGSERVICE`가 설정돼 있으면 셸 스크립트가 실행 전에 거절합니다(`lib.sh`).
- 모든 `.psql` 파일은 `\ir guard.psql`로 시작해, 접속한 DB 이름이 `scm_test_*`이고 TCP라면 루프백일 때만
  계속합니다. 원격 Supabase(DB 이름 `postgres`)에 붙여 넣어도 첫 문장에서 멈춥니다.
- 확장자를 `.sql`이 아니라 `.psql`로 둔 이유: `supabase test db`(pg_prove)가 `supabase/tests`의 `.sql`을
  테스트로 실행하지 않게 하기 위해서입니다.
- 사용자 컨텍스트가 필요한 구간은 `set role authenticated`로 실제 GRANT·RLS가 적용되는 상태에서
  `approved_test.as_user()`로 `auth.uid()`를 지정합니다. 결과를 다시 읽는 구간은 `reset role`(슈퍼유저)로
  돌아가 원본 값을 직접 확인합니다 — RLS 자체를 검증하는 S13만 확인도 `authenticated` 롤 안에서 합니다.
- fixture와 헬퍼는 임시 DB 안에서만 만들어지며 `supabase/migrations`에 들어가지 않습니다.
- S10 · S11 · S12는 Task 5(`core.sales_order` · `core.sales_order_line`)의 배정·승인 로직을 다시
  돌리지 않고, "확정(CONFIRMED) 상태"라는 사실 자체만 슈퍼유저로 직접 구성해 테스트합니다. 배정·만료
  로직은 `supabase/tests/sales_order_allocation`이 이미 검증합니다.
- 이 스위트는 자신이 만든 DB(이름이 `scm_test_approved_`로 시작)만 정리합니다. 다른 스위트(예:
  `sales_order_allocation`, `demand_submission`)의 DB는 건드리지 않습니다.

## 두 번째 timezone에서 재실행(재현성 확인)

```bash
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/approved_demand/run-all.sh
```

CONFIRMED_ORDER 월 계산은 `timestamptz at time zone 'Asia/Seoul'`로 고정되어 있어 세션 timezone과
무관하게 같은 결과가 나와야 합니다(S11).
