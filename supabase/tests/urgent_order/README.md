# 긴급발주 DB 검증 (Task 11)

`supabase/migrations/20260911001100_stage1_department_screens.sql`의 긴급발주 등록·수정·상태 변경
(`core.create_urgent_order` · `update_urgent_order` · `change_urgent_order_status`)과 조회 범위
(`analytics.v_urgent_order` · `v_urgent_order_history`)를 **로컬 PostgreSQL 임시 DB**에서 실제로
실행해 확인하는 테스트 전용 스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는
절대 실행하지 않습니다. 구조는 `supabase/tests/master_edit`(Task 10a)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다.

## 실행

```bash
bash supabase/tests/urgent_order/run-all.sh
# 다른 세션 timezone에서도(배포 환경은 보통 UTC):
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/urgent_order/run-all.sh
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
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션(1100(Task 11)은 자기 순서 자리에서 곧바로 한 번 더 적용 — 재실행 안전성, error.md #24) |
| `lib.sh` · `guard.psql` · `auth-stub.psql` | 다른 스위트와 동일(로컬 대상 확인 · 안전장치 · 최소 auth 스텁) |
| `fixtures.psql` | STEP 19의 실제 직책(SCM_PLANNER · SCM_LEAD · SERVICE · MARKETING · ADMIN)을 그대로 쓰는 계정 5명, 소모품(URGT001) · 용지(URGT002) 품목, 검증 헬퍼 스키마 `urgentorder_test` |
| `scenarios.psql` | S1 ALLOC_MANUAL 없으면(마케팅·SCM팀장·관리자·서비스부) 등록 거절 · S2 등록 입력 검증(품목 · 수량 · 필요일 · 사유) · S3 정상 등록은 조회 · 이력(before=null)에 남는다 · S4 조회 범위(SCM 전체 · 서비스부 소모품만 · 마케팅 0행) · S5 이력 뷰도 같은 범위 · S6 서비스부는 수정 · 상태 변경 · 직접 INSERT 모두 거절(DB 수준) · S7 수정(변경 사유 필수, before/after 이력) · S8 상태 변경(같은 상태 재변경 거절) · S9 종료(COMPLETED) 이후 수정 · 상태 변경 모두 거절 |

## 안전장치

다른 스위트(`item_policy` · `master_edit` 등)와 동일합니다 — DB 이름은 `scm_test_`로 시작해야 하고,
로컬 소켓/루프백이 아니면 거절하며, 이 스위트는 자신이 만든 DB(`scm_test_urgentorder_`로 시작)만
정리합니다.

## 컨트롤러 판정 1과의 대응

- 등록 · 수정 · 상태 변경은 SCM 품목담당자(`ALLOC_MANUAL`)만 한다 — S1 · S6에서 확인.
- 서비스부(`URGENT_ORDER_VIEW`)는 `analytics.v_urgent_order`로 조회만 하고, 범위는 소모품
  (`core.item_visibility_scope = 'CONSUMABLE'`)으로 좁힌다 — S4 · S5에서 확인.
- 상태 변경 · 수정은 append-only 이력(`core.audit_log`, `target_type='urgent_order'`)으로 남는다
  — S3 · S7 · S8에서 before/after 값을 직접 확인한다.
