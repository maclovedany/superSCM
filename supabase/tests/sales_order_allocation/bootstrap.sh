#!/bin/bash
# 로컬 PostgreSQL에 검증 DB를 만든다 — error.md #14 · #15 · #21 절차
#   클러스터 역할 확인 → createdb → auth 스텁 → schema-dump → STEP 4 · 7 정책 선삭제 → 전체 마이그레이션
#   (0600 · 0610은 각자 자기 순서 자리에서 한 번 더 적용 — 재실행 안전성, error.md #24)
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
TARGET_MIGRATION="$REPO/supabase/migrations/20260911000600_stage1_sales_order_allocation.sql"
TARGET_MIGRATION_2="$REPO/supabase/migrations/20260911000610_stage1_allocation_jobs.sql"

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

# Task 14(20260912000100)는 pg_cron·pg_net 확장을 요구하는데, 이 두 확장은 Supabase 전용이라
# 일반 로컬 PostgreSQL(Homebrew postgresql@17)에는 설치돼 있지 않다(error.md #31). 이 스위트는
# pg_cron과 무관하므로, "정확히 그 파일이 그 이유로만" 실패하면 건너뛰고 계속 진행한다 — 다른
# 파일이 같은 오류 문구를 우연히 내거나, 그 파일이 다른 이유로 실패하면 지금까지와 같이 즉시 멈춘다
# (user_admin/bootstrap.sh의 fix round 1 · M1과 같은 패턴).
PG_CRON_MIGRATION_NAME="20260912000100_stage1_pg_cron_jobs.sql"
# ★ 2026-09-12 라운드 1 — TARGET_MIGRATION · TARGET_MIGRATION_2를 전체 적용 뒤 따로 재적용하지
#   않고, 아래에서 자기 순서 자리에 도달한 바로 그 시점에 한 번 더 적용한다. 두 가지 이유가
#   모두 있다(어느 한쪽이 없어져도 나머지 때문에 이 방식이 필요하다).
#   1) 뒤 마이그레이션이 이 두 파일이 정의한 뷰의 열을 넓히면, 전체 적용 뒤 재적용 시
#      "cannot drop columns from view"로 실패한다(error.md #24). 지금은 Task 16이
#      analytics.v_available_stock·core.v_open_po_qty에 열을 더하지 않으므로 이 사유는
#      해당하지 않는다.
#   2) ★ 여전히 유효 — Task 16(20260912000800)이 TARGET_MIGRATION_2(0610)가 정의한
#      core.apply_stock_receipts_from_batch를 다시 정의한다(관대한 파서 + 배치 거부).
#      전체 적용 뒤 0610을 따로 재적용하면 0610의 **옛(하드 캐스트) 정의**가 0800의 최종
#      정의를 덮어써, 이 스위트가 고쳐진 함수가 아니라 옛 함수를 테스트하게 된다 — 실제로
#      겪었다(S15 (g)가 "select * from ... (콤마 값)"이 아니라 22P02로 실패했다). 자기 순서
#      자리에서 재적용하면 0800이 항상 마지막에 적용돼 최종 정의가 유지된다.
for migration in "$REPO"/supabase/migrations/*.sql; do
  name=$(basename "$migration")
  if ! "${PSQL[@]}" -d "$DB" -f "$migration" > "$LOG_DIR/migration-$name.log" 2>&1; then
    if [ "$name" = "$PG_CRON_MIGRATION_NAME" ] && grep -qE 'extension "pg_(cron|net)" is not available' "$LOG_DIR/migration-$name.log"; then
      echo "건너뜀(로컬에 pg_cron/pg_net 확장 없음, 이 스위트와 무관): $name" >&2
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
  if [ "$migration" = "$TARGET_MIGRATION_2" ] && ! "${PSQL[@]}" -d "$DB" -f "$TARGET_MIGRATION_2" > "$LOG_DIR/migration-rerun-2.log" 2>&1; then
    echo "재적용 실패: $(basename "$TARGET_MIGRATION_2")" >&2
    tail -5 "$LOG_DIR/migration-rerun-2.log" >&2
    exit 1
  fi
done
echo "bootstrap 완료: $DB (마이그레이션 전체 적용, $(basename "$TARGET_MIGRATION") · $(basename "$TARGET_MIGRATION_2")는 자기 순서에서 재적용)"
