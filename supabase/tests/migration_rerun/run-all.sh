#!/bin/bash
# 마이그레이션 재실행 안전성 검증 — supabase/migrations/*.sql 전체를 파일명 순서로 두 번 적용한다.
# 사용: bash supabase/tests/migration_rerun/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp 임시 디렉터리)
#
# 왜 필요한가 — 이 저장소의 SQL은 사용자가 Supabase SQL Editor에서 직접 적용하고, 문제가 생기면
# "전체를 순서대로 다시 적용"하는 것이 표준 복구 절차다(docs/stage1-supabase-수동적용.md §0).
# 그런데 뒤 마이그레이션이 앞 마이그레이션의 뷰에 열을 덧붙이거나(create or replace view는 열을
# 뺄 수 없다 — error.md #16 · #24) 정책을 drop 없이 다시 만들면, 두 번째 적용이 중간에서 멈춘다.
# 이 스위트는 그 재실행 경로 자체를 검증한다. 2026-09-12 최종 fix 이전에는 5개 파일이 멈췄다.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../.." && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_rerun_$(date +%Y%m%d%H%M%S)}
require_local_target "$DB"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_rerun.XXXXXX")}
mkdir -p "$LOG_DIR"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)

cleanup() {
  if [ "${KEEP_DB:-0}" = 1 ]; then
    echo "유지: $DB (KEEP_DB=1 — 확인 후 dropdb $DB)"
  else
    dropdb --if-exists "$DB" && echo "삭제: $DB"
  fi
}
trap cleanup EXIT

echo "DB: $DB · 로그: $LOG_DIR"

# 덤프 · 마이그레이션이 GRANT하는 역할. 클러스터 공용이라 없을 때만 만든다(error.md #14).
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

createdb "$DB" || { echo "결과: createdb 실패"; exit 1; }
"${PSQL[@]}" -d "$DB" -f "$HERE/auth-stub.psql" > "$LOG_DIR/auth-stub.log" 2>&1

# 스키마 전용 덤프는 기본 public 스키마를 다시 만들려 한다. 그 한 줄만 빼고 복원한다(error.md #21).
sed '/^CREATE SCHEMA public;$/d' "$REPO/supabase/schema-dump/2026-09-11.sql" \
  | psql -X -q -d "$DB" > "$LOG_DIR/schema-dump.log" 2>&1 || true

# ★ 다른 스위트의 bootstrap.sh와 달리 STEP 4 · STEP 7 정책을 미리 지우지 않는다 — 그 정책 재생성이
#   재실행에서 안전한지(drop policy if exists가 있는지)까지 이 스위트가 확인해야 하기 때문이다.

STATUS=0
for pass in 1 2; do
  OK=0
  FAILED=0
  for migration in "$REPO"/supabase/migrations/*.sql; do
    name=$(basename "$migration")
    if "${PSQL[@]}" -d "$DB" -f "$migration" > "$LOG_DIR/pass$pass-$name.log" 2>&1; then
      OK=$((OK + 1))
    else
      FAILED=$((FAILED + 1))
      STATUS=1
      echo "  FAIL $name"
      grep -E '^psql:.*ERROR' "$LOG_DIR/pass$pass-$name.log" | head -2 | sed 's/^/    /'
    fi
  done
  echo "pass$pass: PASS $OK · FAIL/ERROR $FAILED"
done

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패 — 마이그레이션 전체 재실행이 안전하지 않습니다 (로그 $LOG_DIR)"
else
  echo "결과: 전부 통과"
fi
exit "$STATUS"
