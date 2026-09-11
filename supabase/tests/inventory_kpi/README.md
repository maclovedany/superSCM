# 월말 재고 성과 · 운영 기준월 DB 검증 (Task 12)

`supabase/migrations/20260911001150_stage1_inventory_kpi.sql`의 월말 재고 스냅샷 반영,
`analytics.v_current_planning_cycle` · `v_inventory_performance` · `v_inventory_performance_kpi`
계산 규칙과 RLS를 **로컬 PostgreSQL 임시 DB**에서 실제로 실행해 확인하는 테스트 전용
스크립트입니다. 마이그레이션이 아니며, Supabase(원격) 프로젝트에는 절대 실행하지 않습니다.
구조는 `supabase/tests/item_policy`(Task 9a)와 같습니다.

## 준비

- PostgreSQL 17과 `psql` · `createdb` · `dropdb` (예: Homebrew `postgresql@17` + `libpq`).
- 기본 접속은 유닉스 소켓 `/tmp`, 포트 `5432`입니다. 다르면 `PGHOST`(소켓 디렉터리 또는 `localhost`)와
  `PGPORT`만 바꿉니다. 비밀번호 · 접속 문자열은 이 폴더에 두지 않습니다.
- 접속 계정은 **로컬 슈퍼유저**여야 합니다. DB를 만들고, fixture가 RLS를 우회해 검증용 사용자 ·
  품목 · 재고 초기값을 넣습니다.

## 실행

```bash
bash supabase/tests/inventory_kpi/run-all.sh
```

종료 코드 0이면 전부 통과입니다. 실패하면 요약 아래에 실패 줄이 나오고 로그 경로가 첫 줄에 있습니다.

기본은 UTC 세션 timezone입니다(`lib.sh`). 다른 timezone에서도 같은 결과가 나오는지 확인하려면:

```bash
PGOPTIONS="-c timezone=America/Los_Angeles" bash supabase/tests/inventory_kpi/run-all.sh
```

| 환경변수 | 뜻 |
|---|---|
| `KEEP_DB=1` | 끝난 뒤 임시 DB를 지우지 않는다(조사용, 직접 `dropdb`) |
| `LOG_DIR=…` | 로그 위치. 기본은 `mktemp`로 만든 임시 디렉터리 |

## 파일

| 파일 | 역할 |
|---|---|
| `run-all.sh` | 전체 실행과 요약, 종료 시 임시 DB 삭제(`trap`) |
| `bootstrap.sh` | 클러스터 역할 확인 → `createdb` → `auth-stub.psql` → `schema-dump/2026-09-11.sql` → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션(001150(Task 12)은 자기 순서 자리에서 곧바로 한 번 더 적용 — 재실행 안전성) |
| `lib.sh` | 로컬 대상 확인(`require_local_target`) — 다른 스위트와 동일 |
| `guard.psql` | 모든 `.psql`이 먼저 포함하는 대상 DB 확인 — 동일 |
| `auth-stub.psql` | 최소 `auth.users` · `auth.uid()` 스텁(JWT claim 대역) — 동일 |
| `fixtures.psql` | 검증용 사용자 4명(SCM 품목담당자 · SCM팀장 · 마케팅 · ADMIN) · 품목 4개(각각 다른 사유 코드 시나리오 전용), 검증 헬퍼 스키마 `invkpi_test` |
| `scenarios.psql` | S1 RLS(STOCK_VIEW_ALL 없는 사용자 · ADMIN도 0행) · S2 미분류 품목(INVENTORY_SCOPE_UNCLASSIFIED) · S3 이 달 스냅샷 없음(MONTH_END_SNAPSHOT_MISSING) · S4 활성 취합 주기 없음(PLANNING_CYCLE_NOT_OPEN) · S5 취합 주기를 열면 기준월이 바뀐다 · S6 여러 달 동시 활성 시 최근 달 우선 · S7 승인 전/후 단가·목표재고·차이(item_policy_revision 승인 흐름) · S8 `core.apply_month_end_inventory_snapshot_from_batch`(그 달 최신 스냅샷만 유지, 다운그레이드 안 됨) · S8b 다른 달은 별도 행 · 비-NORMAL만 있으면 행 없음 · S8c `core.refresh_stock_balance`가 정상 창고재고와 월말 스냅샷을 함께 갱신 · S9 요약 뷰의 합계와 제외 건수 · S10 월 경계 스냅샷이 세션 timezone과 무관하게 Asia/Seoul 벽시계로 묶인다(UTC · America/Los_Angeles 양쪽 실행 전용 회귀 테스트) |

## 이 스위트가 확인하지 않는 것

- `core.commit_import_batch`(파일 업로드 전체 파이프라인)를 통한 end-to-end 적재는 확인하지 않습니다 —
  STEP 4 · Task 4가 이미 그 경로를 검증했고, 이 마이그레이션은 그 함수 안에 한 줄
  (`perform core.apply_month_end_inventory_snapshot_from_batch(...)`)만 추가합니다. 대신 그 한 줄이
  실제로 하는 일(분류 · 그 달 최신값 유지)은 S8 · S8b · S8c가 직접 그 함수를 호출해 확인합니다.
- 대시보드 화면(`lib/kpi/repository.ts`의 `getDashboardSummary`)이 재사용하는 기존 뷰
  (`v_demand_submission_status` · `v_my_approval_inbox` · `v_allocation_queue` · `v_procurement_plan`)의
  동작 자체는 각자의 Task 스위트(Task 5 · 6 · 7 · 8 · 9b)가 이미 검증했습니다 — 여기서 다시 검증하지
  않습니다.
