#!/bin/bash
# 차트 데이터 뷰(analytics.v_demand_series · v_shipment_monthly_rollup · v_shipment_monthly_item)
# DB 검증 전체 실행 — 로컬 PostgreSQL 임시 DB 전용
#   임시 DB 생성(bootstrap) → fixture → 시나리오 → 요약 → 임시 DB 삭제
# 사용: bash supabase/tests/chart_views/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp로 만든 임시 디렉터리)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_chart_$(date +%Y%m%d%H%M%S)}
require_local_target "$DB"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_chart.XXXXXX")}
mkdir -p "$LOG_DIR"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")

cleanup() {
  if [ "${KEEP_DB:-0}" = 1 ]; then
    echo "유지: $DB (KEEP_DB=1 — 확인 후 dropdb $DB)"
  else
    dropdb --if-exists "$DB" && echo "삭제: $DB"
  fi
}
trap cleanup EXIT

count() { grep -cE "$1" "$2" || true; }

echo "DB: $DB · 로그: $LOG_DIR"
if ! bash "$HERE/bootstrap.sh" "$DB" "$LOG_DIR"; then
  echo "결과: bootstrap 실패 (로그 $LOG_DIR)"
  exit 1
fi
if ! "${PSQL[@]}" -f "$HERE/fixtures.psql" > "$LOG_DIR/fixtures.log" 2>&1; then
  echo "결과: fixture 실패"; tail -5 "$LOG_DIR/fixtures.log"
  exit 1
fi

STATUS=0
"${PSQL[@]}" -f "$HERE/scenarios.psql" > "$LOG_DIR/scenarios.log" 2>&1 || STATUS=1
echo "scenarios: PASS $(count '^PASS' "$LOG_DIR/scenarios.log") · FAIL/ERROR $(count 'FAIL|ERROR' "$LOG_DIR/scenarios.log")"
for scenario in "S1 " "S1b" "S2 " "S3 " "S4 " "S5 " "S6 " "S7 " "S8 " "S9 " "S10" "S11" "S12"; do
  printf '  %s PASS %s\n' "$scenario" "$(count "^PASS: $scenario" "$LOG_DIR/scenarios.log")"
done

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패"
  grep -hE 'FAIL|ERROR' "$LOG_DIR"/scenarios.log | head -30
else
  echo "결과: 전부 통과"
fi

# fix round 1 — 세 뷰 모두 권한 게이트가 없어(팀장 판정, §3-b) 어느 역할로 세도 같은 행 수가
# 나온다. 그래도 authenticated로 세션을 맞춰 실제 화면 조회 경로와 같은 조건으로 잰다.
echo "== 뷰별 실측 행 수(무게이트 — 이 fixture 데이터. 실 배포 데이터는 이 스위트에 없다) =="
"${PSQL[@]}" -At <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000901', false);
select 'analytics.v_demand_series' as view, count(*) from (select * from analytics.v_demand_series) t
union all
select 'analytics.v_shipment_monthly_rollup', count(*) from (select * from analytics.v_shipment_monthly_rollup) t
union all
select 'analytics.v_shipment_monthly_item', count(*) from (select * from analytics.v_shipment_monthly_item) t;
reset role;
SQL

exit "$STATUS"
