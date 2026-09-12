# 관리자 계정 관리 DB 검증

`supabase/migrations/20260912000300_stage1_user_admin.sql`의 계정 생성 확정·편집
(`core.admin_upsert_app_user_profile`) · 활성/비활성 전환(`core.admin_set_app_user_active`) ·
완전 삭제(`core.admin_delete_app_user_profile`) · 업무 이력 참조 확인
(`core.app_user_blocking_tables`)을 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는
테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대 실행하지
않습니다. 구조는 `supabase/tests/master_edit`(Task 10a)와 같습니다.

## 이 스위트가 검증하지 않는 것 — Auth Admin API

`auth.admin.createUser` · `auth.admin.deleteUser`(Supabase Auth Admin API)는 로컬 PostgreSQL만
있는 이 임시 DB에는 존재하지 않습니다(Supabase 플랫폼의 GoTrue 서비스가 처리하는 REST API이며
SQL 함수가 아닙니다). 그래서 이 스위트는 **core.app_user 프로필 쪽만** 검증합니다 —
"Auth 사용자 생성이 실패하면 롤백한다" · "완전 삭제 뒤 Auth 사용자도 지운다" 같은
`app/(admin)/admin/users/actions.ts`의 롤백·순서 로직은 실제 Supabase 프로젝트(또는 최소
Supabase CLI의 `auth` 컨테이너)에 대해 수동으로만 확인할 수 있습니다 — report에 그렇게
기록합니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다.

## 실행

```bash
bash supabase/tests/user_admin/run-all.sh
# 다른 세션 timezone에서도(배포 환경은 보통 UTC):
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/user_admin/run-all.sh
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션(0300은 자기 순서 자리에서 곧바로 한 번 더 적용 — 재실행 안전성) |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 다른 스위트와 동일(로컬 대상 확인 · 안전장치 · 최소 auth 스텁) |
| `fixtures.psql` | ADMIN 2명 · USER 1명 · 업무 이력 없는 계정 1명 · `core.audit_log`에 이력이 있는 계정 1명 · "auth.users만 있고 프로필 없음" 상태를 만든 계정 1명, 검증 헬퍼 스키마 `user_admin_test` |
| `scenarios.psql` | S1 ADMIN 아니면 4개 함수 모두 거절 · S2 입력 검증 · S3 신규 프로필 확정(USER_CREATED) · S4 기존 계정 편집(USER_PROFILE_UPDATED) · S5 자기 자신 강등 거절 · S6 자기 자신 비활성화 거절(두 함수 모두) · S7 정상 비활성화·재활성화 · S8 사유 없음·대상 없음 거절 · S9 완전 삭제 자기 자신 거절 · S10 업무 이력(audit_log) 있으면 완전 삭제 거절 · S11 이력 없는 계정은 프로필만 삭제되고 auth.users는 남는다 · S12 job_role·department 직접 UPDATE는 GRANT가 없어 거절 · S13 CHECK 제약(RLS 우회해도) · S14 idempotent 재호출 · S15 직접 INSERT·DELETE 거절 |

## 안전장치

다른 스위트(`item_policy` · `master_edit` 등)와 동일합니다 — DB 이름은 `scm_test_`로 시작해야
하고, 로컬 소켓/루프백이 아니면 거절하며, 이 스위트는 자신이 만든 DB(`scm_test_useradmin_`로
시작)만 정리합니다.

## 알아 둘 것 — 완전 삭제의 참조 확인 범위

`core.app_user_blocking_tables()`는 `auth.users(id)`를 참조하는 **모든 단일 컬럼 FK**를
`pg_constraint`에서 훑습니다(표 이름을 나열하지 않습니다). S10은 일부러 업무 도메인 표(주문·
배정 등, fixture로 채우기 번거로운 복잡한 FK 체인) 대신 `core.audit_log.actor`(가장 채우기 쉬운
참조)로 "참조가 하나라도 있으면 거절된다"는 것만 검증합니다 — `ON DELETE SET NULL`이라 DB
자신은 삭제를 막지 않는데도 이 함수는 막아야 한다는 것이 핵심입니다(주석 참고). 실제 배포
DB에서 새 업무 표가 늘어도 이 함수는 표 이름을 다시 나열할 필요가 없습니다.
