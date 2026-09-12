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

# Task 14(20260912000100)는 pg_cron·pg_net 확장을 요구하는데, 이 두 확장은 Supabase 전용이라
# 일반 로컬 PostgreSQL(Homebrew postgresql@17)에는 설치돼 있지 않다(error.md #31). 이 스위트는
# pg_cron과 무관하므로, "정확히 그 파일이 그 이유로만" 실패하면 건너뛰고 계속 진행한다 — 다른
# 파일이 같은 오류 문구를 우연히 내거나, 그 파일이 다른 이유로 실패하면 지금까지와 같이 즉시
# 멈춘다(user_admin·sales_order_allocation 스위트의 같은 패턴 — fix round 1 · M1).
PG_CRON_MIGRATION_NAME="20260912000100_stage1_pg_cron_jobs.sql"

STATUS=0
for pass in 1 2; do
  OK=0
  FAILED=0
  for migration in "$REPO"/supabase/migrations/*.sql; do
    name=$(basename "$migration")
    if "${PSQL[@]}" -d "$DB" -f "$migration" > "$LOG_DIR/pass$pass-$name.log" 2>&1; then
      OK=$((OK + 1))
    else
      if [ "$name" = "$PG_CRON_MIGRATION_NAME" ] && grep -qE 'extension "pg_(cron|net)" is not available' "$LOG_DIR/pass$pass-$name.log"; then
        echo "  건너뜀(로컬에 pg_cron/pg_net 확장 없음, 이 스위트와 무관): $name"
        OK=$((OK + 1))
        continue
      fi
      FAILED=$((FAILED + 1))
      STATUS=1
      echo "  FAIL $name"
      grep -E '^psql:.*ERROR' "$LOG_DIR/pass$pass-$name.log" | head -2 | sed 's/^/    /'
    fi
  done
  echo "pass$pass: PASS $OK · FAIL/ERROR $FAILED"
done

# ── 사후 조건 ────────────────────────────────────────────────────
# psql 종료 코드만 보면 "가드가 엉뚱한 객체를 건너뛰어 좁은 정의가 남았는지"를 알 수 없다.
# 두 번째 적용이 끝난 상태에서 최종 정의가 실제로 넓은 쪽인지 직접 센다.
"${PSQL[@]}" -d "$DB" -At > "$LOG_DIR/postconditions.log" 2>&1 <<'SQL'
with expected(label, actual, want) as (
  values
    ('analytics.v_item_policy 열 수',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_item_policy'), 24::bigint),
    ('analytics.v_master_readiness 열 수',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_master_readiness'), 9),
    ('analytics.v_supplier_departure 열 수',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_supplier_departure'), 11),
    ('analytics.v_forecast_run 열 수',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_forecast_run'), 21),
    ('analytics.v_inventory_performance 열 수',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_inventory_performance'), 13),
    ('core.upload_batch 정책 수',
       (select count(*) from pg_policies where schemaname = 'core' and tablename = 'upload_batch'), 2),
    -- Task 16(20260912000800) — 열을 추가하지 않기로 한 판정을 재실행 뒤에도 지킨다.
    ('core.v_open_po_qty 열 수(사유 열 추가 금지)',
       (select count(*) from information_schema.columns where table_schema = 'core' and table_name = 'v_open_po_qty'), 2),
    ('analytics.v_available_stock 열 수(재정의하지 않음)',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_available_stock'), 13),
    ('core.v_inbound_qty 열 수(사유 열 추가 금지)',
       (select count(*) from information_schema.columns where table_schema = 'core' and table_name = 'v_inbound_qty'), 4),
    -- Task 17(20260912000900) — 출처 게이트를 걸면서도 열은 추가하지 않기로 한 판정을 재실행 뒤에도 지킨다.
    ('core.v_item_master 열 수(사유 열 추가 금지)',
       (select count(*) from information_schema.columns where table_schema = 'core' and table_name = 'v_item_master'), 6),
    ('analytics.v_item_master_source_status 열 수(새 상태 객체)',
       (select count(*) from information_schema.columns where table_schema = 'analytics' and table_name = 'v_item_master_source_status'), 3)
)
select case when actual = want then 'PASS: ' else 'FAIL: ' end
       || label || ' (' || actual::text || ' · 기대 ' || want::text || ')'
  from expected
union all
select case when body like '%품목코드" is not distinct from%' then 'PASS: ' else 'FAIL: ' end
       || 'core.commit_import_batch에 다품목 (문서번호, 품목코드) 삭제 술어가 남아 있다'
  from (select pg_get_functiondef(p.oid) as body from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'core' and p.proname = 'commit_import_batch') f
union all
select case when body like '%apply_month_end_inventory_snapshot_from_batch%' then 'PASS: ' else 'FAIL: ' end
       || 'core.commit_import_batch에 Task 12 월말 스냅샷 훅이 남아 있다'
  from (select pg_get_functiondef(p.oid) as body from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'core' and p.proname = 'commit_import_batch') f
union all
-- error.md #32 — STEP 7(20260828000600)의 RMSE 식은 FILTER를 sqrt()에 붙여 Backtest가 항상 실패했다.
-- 보정(20260912000500)이 파일명 순서상 뒤에 와야 최종 정의가 고쳐진 쪽이 된다. 번호를 바꾸거나
-- 보정을 지우면 조용히 옛 정의로 되돌아가므로(예외를 삼키고 FAILED로만 적는다) 여기서 고정한다.
select case when body like '%,2)) filter%' then 'PASS: ' else 'FAIL: ' end
       || 'core.run_backtest의 RMSE FILTER가 sqrt가 아니라 avg에 붙어 있다'
  from (select pg_get_functiondef(p.oid) as body from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'core' and p.proname = 'run_backtest') f
union all
-- Task 17(20260912000900) — 두 번째 적용 뒤에도 core.v_item_master 정의가 출처 게이트(gated)를
-- 유지하는지 뷰 정의 텍스트로 직접 확인한다(열 수만으로는 "좁은 정의가 조용히 넓은 정의로
-- 덮였는지"를 알 수 없다 — 열 구성은 같아도 WHERE 절이 빠진 옛 정의로 되돌아갈 수 있다).
select case when def like '%batch_id IS NOT NULL%' then 'PASS: ' else 'FAIL: ' end
       || 'core.v_item_master 정의가 두 번째 적용 뒤에도 출처 게이트(batch_id IS NOT NULL)를 유지한다'
  from (select pg_get_viewdef('core.v_item_master'::regclass, true) as def) v;
SQL
POST_PASS=$(grep -c '^PASS: ' "$LOG_DIR/postconditions.log" || true)
POST_FAIL=$(grep -c '^FAIL: ' "$LOG_DIR/postconditions.log" || true)
echo "사후 조건: PASS $POST_PASS · FAIL/ERROR $POST_FAIL"
sed 's/^/  /' "$LOG_DIR/postconditions.log"
if [ "$POST_PASS" -ne 15 ] || [ "$POST_FAIL" -ne 0 ]; then
  STATUS=1
fi

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패 — 마이그레이션 전체 재실행이 안전하지 않습니다 (로그 $LOG_DIR)"
else
  echo "결과: 전부 통과"
fi
exit "$STATUS"
