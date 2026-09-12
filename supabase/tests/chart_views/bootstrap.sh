#!/bin/bash
# 로컬 PostgreSQL에 검증 DB를 만든다 — error.md #14 · #15 · #21 절차, supabase/tests/inventory_kpi와 동일 구조
#   클러스터 역할 확인 → createdb → auth 스텁 → schema-dump → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션
#   → 20260912001000(차트 데이터 뷰) 한 번 더 적용(재실행 안전성)
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
TARGET_MIGRATION="$REPO/supabase/migrations/20260912001000_chart_demand_shipment_views.sql"

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

# Task 14(20260912000100)는 pg_cron·pg_net 확장을 요구하는데, 이 두 확장은 Supabase 전용이라
# 일반 로컬 PostgreSQL(Homebrew postgresql@17)에는 설치돼 있지 않다(error.md #31,
# supabase/tests/migration_rerun/run-all.sh와 같은 처리). 이 스위트는 pg_cron과 무관하므로
# "정확히 그 파일이 그 이유로만" 실패하면 건너뛰고 계속 진행한다.
PG_CRON_MIGRATION_NAME="20260912000100_stage1_pg_cron_jobs.sql"

# 전체 마이그레이션 적용. 20260912001000(차트 데이터 뷰)은 자기 순서 자리에서 곧바로 한 번 더
# 적용한다(재실행 안전성 — 이 뷰들은 전부 신규라 create or replace가 열 구성 충돌 없이 재적용돼야 한다).
for migration in "$REPO"/supabase/migrations/*.sql; do
  name=$(basename "$migration")
  if ! "${PSQL[@]}" -d "$DB" -f "$migration" > "$LOG_DIR/migration-$name.log" 2>&1; then
    if [ "$name" = "$PG_CRON_MIGRATION_NAME" ] && grep -qE 'extension "pg_(cron|net)" is not available' "$LOG_DIR/migration-$name.log"; then
      echo "건너뜀(로컬에 pg_cron/pg_net 확장 없음, 이 스위트와 무관): $name"
      continue
    fi
    echo "마이그레이션 실패: $name" >&2
    tail -5 "$LOG_DIR/migration-$name.log" >&2
    exit 1
  fi
  if [ "$migration" = "$TARGET_MIGRATION" ] && ! "${PSQL[@]}" -d "$DB" -f "$TARGET_MIGRATION" > "$LOG_DIR/migration-rerun.log" 2>&1; then
    echo "재적용 실패: $(basename "$TARGET_MIGRATION")" >&2
    tail -5 "$LOG_DIR/migration-rerun.log" >&2
    exit 1
  fi
done
echo "bootstrap 완료: $DB (마이그레이션 전체 적용, $(basename "$TARGET_MIGRATION")은 자기 순서에서 재적용)"
