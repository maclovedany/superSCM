#!/bin/bash
# 로컬 PostgreSQL에 검증 DB를 만든다 — error.md #14 · #15 · #21 절차, supabase/tests/approved_demand와 동일 구조
#   클러스터 역할 확인 → createdb → auth 스텁 → schema-dump → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션
#   → 0900(Task 9b) 한 번 더 적용(재실행 안전성)
# 사용: bootstrap.sh <scm_test_* DB 이름> <로그 디렉터리>   (보통 run-all.sh가 부른다)
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:?usage: bootstrap.sh <scm_test_* db> <log dir>}
LOG_DIR=${2:?usage: bootstrap.sh <scm_test_* db> <log dir>}
require_local_target "$DB"
mkdir -p "$LOG_DIR"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
TARGET_MIGRATION="$REPO/supabase/migrations/20260911000900_stage1_procurement_plan.sql"

# 덤프 · 마이그레이션이 GRANT하는 역할. 클러스터 공용이라 없을 때만 로그인 불가 역할로 만든다(error.md #14).
"${PSQL[@]}" -d postgres > "$LOG_DIR/roles.log" 2>&1 <<'SQL'
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = v_role) then
      execute format('create role %I nologin', v_role);
    end if;
  end loop;
end $$;
SQL

createdb "$DB"
"${PSQL[@]}" -d "$DB" -f "$HERE/auth-stub.psql" > "$LOG_DIR/auth-stub.log" 2>&1

# 스키마 전용 덤프는 기본 public 스키마를 다시 만들려 한다. 그 한 줄만 빼고 복원한다(error.md #21).
# 덤프 안의 일부 문장(확장 · 소유자 등)은 로컬에서 실패할 수 있어 이 단계만 오류를 멈춤 조건으로 두지 않는다.
sed '/^CREATE SCHEMA public;$/d' "$REPO/supabase/schema-dump/2026-09-11.sql" \
  | psql -X -q -d "$DB" > "$LOG_DIR/schema-dump.log" 2>&1 || true

# STEP 4 · STEP 7 마이그레이션의 정책 생성 블록은 drop policy if exists가 없어 덤프 뒤 재적용하면 멈춘다.
"${PSQL[@]}" -d "$DB" > "$LOG_DIR/predrop.log" 2>&1 <<'SQL'
do $$
declare
  t text;
begin
  foreach t in array array['upload_batch', 'import_staging', 'validation_error', 'column_mapping', 'import_row_backup',
                           'backtest_run', 'model_performance', 'champion_model_selection'] loop
    execute format('drop policy if exists %I on core.%I', t || '_active_select', t);
    execute format('drop policy if exists %I on core.%I', t || '_admin_mutation', t);
  end loop;
end $$;
SQL

for migration in "$REPO"/supabase/migrations/*.sql; do
  name=$(basename "$migration")
  if ! "${PSQL[@]}" -d "$DB" -f "$migration" > "$LOG_DIR/migration-$name.log" 2>&1; then
    echo "마이그레이션 실패: $name" >&2
    tail -5 "$LOG_DIR/migration-$name.log" >&2
    exit 1
  fi
done

if ! "${PSQL[@]}" -d "$DB" -f "$TARGET_MIGRATION" > "$LOG_DIR/migration-rerun.log" 2>&1; then
  echo "재적용 실패: $(basename "$TARGET_MIGRATION")" >&2
  tail -5 "$LOG_DIR/migration-rerun.log" >&2
  exit 1
fi
echo "bootstrap 완료: $DB (마이그레이션 전체 적용 + $(basename "$TARGET_MIGRATION") 재적용)"
