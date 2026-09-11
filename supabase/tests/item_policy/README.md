# 품목 정책 변경·승인 DB 검증 (Task 9a)

`supabase/migrations/20260911000850_stage1_item_policy_revision.sql`의 품목 정책 변경안 제출,
SCM팀장 승인·반려, 운영값 반영 시점, 승인 전 직접 쓰기 차단 규칙을 **로컬 PostgreSQL 임시 DB**에서
실제로 실행해 확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는
절대 실행하지 않습니다. 구조는 `supabase/tests/approved_demand`(Task 8)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 ·
  품목 · 품목 정책 초기값을 넣습니다.

## 실행

```bash
bash supabase/tests/item_policy/run-all.sh
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션 → 0850(Task 9a) 재적용(재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) — 다른 스위트와 동일 |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 — 동일 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) — 동일 |
| `fixtures.psql` | 검증용 사용자 5명(SCM 품목담당자 2명 · SCM팀장 · 마케팅 · ADMIN) · 품목 2개(core.item_policy 슈퍼유저 직접 삽입), 검증 헬퍼 스키마 `itempolicy_test` |
| `scenarios.psql` | S1 권한 검증 · S2 입력 검증 · S3 정상 요청(승인 요청 연결) · S4 승인 전 운영값 불변·목표 DoS 미승인 · S5 대기 중 중복 요청 차단 · S6 요청자 본인 승인 차단 · S7 승인 권한 없는 사용자 차단 · S8 정상 승인(운영값 반영·이력·알림) · S9 반려(운영값 유지) · S10 미제안 항목은 승인 후에도 기존값 유지(null로 지우지 않는다) · S11 운영값 컬럼 직접 UPDATE 차단(허용 컬럼은 그대로 가능) · S12 RLS |

## 핵심 설계 — "빈 칸은 변경하지 않는다"

`core.request_item_policy_change`에 넘긴 값이 `null`이면 "그 항목은 이번 변경안이 건드리지 않는다"는
뜻입니다. 승인 시 `core.apply_item_policy_decision()`은 `coalesce(제안값, 현재 운영값)`으로 반영하므로
승인해도 제안하지 않은 항목은 `null`로 지워지지 않고 기존값을 유지합니다(S10). `allocation_mode`만
매 요청마다 필수로 지정해야 하는 컬럼이라 항상 제안값 그대로 반영됩니다.

## 안전장치

- DB 이름은 `scm_test_`로 시작해야 하고, `PGHOST`가 소켓 디렉터리 · `localhost`가 아니거나
  `PGHOSTADDR` · `PGSERVICE`가 설정돼 있으면 셸 스크립트가 실행 전에 거절합니다(`lib.sh`).
- 모든 `.psql` 파일은 `\ir guard.psql`로 시작해, 접속한 DB 이름이 `scm_test_*`이고 TCP라면 루프백일 때만
  계속합니다.
- 확장자를 `.sql`이 아니라 `.psql`로 둔 이유: `supabase test db`(pg_prove)가 `supabase/tests`의 `.sql`을
  테스트로 실행하지 않게 하기 위해서입니다.
- 사용자 컨텍스트가 필요한 구간은 `set role authenticated`로 실제 GRANT·RLS가 적용되는 상태에서
  `itempolicy_test.as_user()`로 `auth.uid()`를 지정합니다. 결과를 다시 읽는 구간은 `reset role`(슈퍼유저)로
  돌아가 원본 값을 직접 확인합니다 — RLS 자체를 검증하는 S12만 확인도 `authenticated` 롤 안에서 합니다.
- `core.item_policy`의 최초 행은 Task 1부터 authenticated의 직접 INSERT가 막혀 있어, fixture도 운영과
  같은 방식(관리 도구·슈퍼유저)으로 직접 넣습니다.
- 이 스위트는 자신이 만든 DB(이름이 `scm_test_itempolicy_`로 시작)만 정리합니다. 다른 스위트의 DB는
  건드리지 않습니다.
