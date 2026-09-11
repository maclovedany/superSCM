# 영업 주문 · 재고 배정 DB 검증 (Task 5 · Task 6)

`supabase/migrations/20260911000600_stage1_sales_order_allocation.sql`(Task 5)와
`supabase/migrations/20260911000610_stage1_allocation_jobs.sql`(Task 6 · 30일 자동 만료와
입고 후 자동 배정)의 배정 규칙 · 동시성 · 권한을 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해
확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대
실행하지 않습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 · 품목 ·
  정상 창고재고를 넣으며, S9는 만료 직전 주문을 만들기 위해 최초 검토 요청 시각을 소급 기록합니다.

## 실행

```bash
bash supabase/tests/sales_order_allocation/run-all.sh
```

출력 예:

```text
scenarios:   PASS 153 · FAIL/ERROR 0
  S2 PASS 12 … S9 PASS 12
concurrency: PASS 16 · FAIL/ERROR 0
  PASS: C2 재고 행 잠금을 기다리는 검토 요청 수 — 10건이 동시에 진행 중 (10)
invariants:  PASS 8 · FAIL/ERROR 0
결과: 전부 통과
삭제: scm_test_order_alloc_20260912…
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션 → 0600 재적용(재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) |
| `fixtures.psql` | 검증용 사용자 7명(직책별) · 품목 · 정상 창고재고, 검증 헬퍼 스키마 `order_test` |
| `scenarios.psql` | S2 PARTIAL/WAIT_FULL · S3 만료 불변 · S4 확정/확정배정 취소/재등록 · S5 수동배정/승인 · S6 우선순위 · S7 권한/직접 쓰기 차단 · S8 주문 취소 · S9 만료 시각 이후 차단 · S10 만료 뒤 FIRM · 확보만 남은 주문의 수주 확정 · **S11(Task 6) 30일 자동 만료 경계 · 재실행 · FIRM 유지 · 배정 0건 WAITING_FULL 만료** · **S12(Task 6) 입고 후 AUTO 자동 배정 대기 순번 · CONFIRMED FIRM · WAIT_FULL 스킵 · 만료 주문 건너뜀** · **S13(Task 6) MANUAL 품목 자동 배정 0건 · 처리 필요 알림 · 대기 순번 조회** |
| `concurrency.sh` | 별도 psql 연결 C1(60+60) · C2(잠금 게이트 뒤 10건 동시) · C3(다른 품목 비차단) · C4(게이트 없는 10건) · **C5(Task 6) 만료 작업 · 입고 커밋 · 검토 요청 동시 실행** · **C6(Task 6) lock_timeout으로 한 주문 실패를 강제해 다른 주문 처리가 막히지 않는지 확인** |
| `invariants.psql` | 초과 배정 0 · 줄 합계 = 배정 원장 · 이력 누락 0 · 만료 = 최초 검토 요청 + 30일 |

## 안전장치

- DB 이름은 `scm_test_`로 시작해야 하고, `PGHOST`가 소켓 디렉터리 · `localhost`가 아니거나
  `PGHOSTADDR` · `PGSERVICE`가 설정돼 있으면 셸 스크립트가 실행 전에 거절합니다(`lib.sh`).
- 모든 `.psql` 파일은 `\ir guard.psql`로 시작해, 접속한 DB 이름이 `scm_test_*`이고 TCP라면 루프백일 때만
  계속합니다. 원격 Supabase(DB 이름 `postgres`)에 붙여 넣어도 첫 문장에서 멈춥니다.
- 확장자를 `.sql`이 아니라 `.psql`로 둔 이유: `supabase test db`(pg_prove)가 `supabase/tests`의 `.sql`을
  테스트로 실행하지 않게 하기 위해서입니다.
- fixture와 헬퍼는 임시 DB 안에서만 만들어지며 `supabase/migrations`에 들어가지 않습니다.

## 정리

- `run-all.sh`는 성공 · 실패 · 중단(Ctrl+C) 모두에서 임시 DB를 `dropdb`합니다(`KEEP_DB=1`이 아니면).
- 로그는 `LOG_DIR`에 남습니다(기본 임시 디렉터리 — 필요 없으면 지웁니다).
- `bootstrap.sh`는 클러스터에 없던 역할(`anon` · `authenticated` · `service_role` · `postgres` ·
  `supabase_admin`)만 로그인 불가(`nologin`) 역할로 만듭니다. 역할은 클러스터 공용이라 남지만 데이터가 없습니다
  (error.md #14 · #21).

## 함수를 바꿀 때 (Task 6 등)

1. 바꾼 규칙의 시나리오를 `scenarios.psql`에 새 절(`== S10 …`)로 추가하고, 필요한 품목 · 재고는 `fixtures.psql`에 넣습니다.
2. 동시성에 영향이 있으면 `concurrency.sh`에 경우를 추가합니다.
3. `run-all.sh`를 다시 실행해 기존 S2~S9 · C1~C4 · 불변식이 그대로 통과하는지 확인합니다.
