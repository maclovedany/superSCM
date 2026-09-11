# 관리자 마스터 편집 DB 검증 (Task 10a)

`supabase/migrations/20260911000950_stage1_master_edit.sql`의 해외법인·공급처·출항일 규칙·영업일
달력 편집(ADMIN 전용), 변경 이력, `core.previous_business_day()`(주말·공휴일 이전 영업일) 규칙을
**로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는 테스트 전용 스크립트입니다. 마이그레이션이
아니며, Supabase(원격) 프로젝트에는 절대 실행하지 않습니다. 구조는 `supabase/tests/item_policy`(Task 9a)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다.

## 실행

```bash
bash supabase/tests/master_edit/run-all.sh
# 다른 세션 timezone에서도(배포 환경은 보통 UTC):
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/master_edit/run-all.sh
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션(0950(Task 10a)은 자기 순서 자리에서 곧바로 한 번 더 적용 — 재실행 안전성, error.md #24) |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 다른 스위트와 동일(로컬 대상 확인 · 안전장치 · 최소 auth 스텁) |
| `fixtures.psql` | 검증용 ADMIN 1명 · USER 1명, 검증 전용 법인(T10)·공급처(SUP-T10-1), 검증 헬퍼 스키마 `masteredit_test` |
| `scenarios.psql` | S1 ADMIN 아니면 7개 명령 함수 모두 거절 · S2 해외법인 입력 검증 · S3 정상 변경(조회값·이력) · S4 신규 법인 추가 · S5 공급처 소속 법인 변경·퇴출(종료일 필수) · S6 출항일 규칙 3가지 인코딩(요일·주차·매월 일자) · S7 규칙 교체·비활성화는 행을 지우지 않는다 · S8~S12 `previous_business_day`(주말→금요일 · 금요일 공휴일+주말→목요일 · 월 경계 · 연 경계 · 연속 공휴일 3일) · S13 공휴일 제거 · S14 달력 월 준비 상태 표시/해제 · S15 RLS가 비관리자 직접 UPDATE를 막는다 · S16 같은 값 재호출도 오류 없음(idempotent) |

## 안전장치

다른 스위트(`item_policy` 등)와 동일합니다 — DB 이름은 `scm_test_`로 시작해야 하고, 로컬 소켓/루프백이
아니면 거절하며, 이 스위트는 자신이 만든 DB(`scm_test_masteredit_`로 시작)만 정리합니다.

## 알아 둘 것 — `\gset`과 NULL(error.md #26)

`\gset`은 컬럼값이 NULL이거나 결과행이 0건이면 그 psql 변수를 설정하지 않습니다. 그래서 이 스위트는
NULL이 될 수 있는 값이나 존재 여부 자체를 확인할 때 `\gset` 대신
`masteredit_test.check((select ... from ...), '설명')`처럼 조건을 서브쿼리 안에서 통째로 판정합니다.
