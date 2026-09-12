#!/bin/bash
# core.v_part_linkage 팬아웃 수정(20260912001100) DB 검증 전체 실행 — 로컬 PostgreSQL 임시 DB 전용
#   임시 DB 생성(bootstrap) → fixture → 시나리오 → 요약 → 임시 DB 삭제
# 사용: bash supabase/tests/hoc_fanout/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp로 만든 임시 디렉터리)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_hocfanout_$(date +%Y%m%d%H%M%S)}
require_local_target "$DB"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_hocfanout.XXXXXX")}
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
for scenario in "T1" "T2" "T3" "T4" "T5" "T6"; do
  printf '  %s PASS %s\n' "$scenario" "$(count "^PASS: $scenario" "$LOG_DIR/scenarios.log")"
done

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패"
  grep -hE 'FAIL|ERROR' "$LOG_DIR"/scenarios.log | head -30
else
  echo "결과: 전부 통과"
fi

echo "== 실측 총량 일치 확인(이 fixture 데이터) =="
"${PSQL[@]}" -At <<'SQL'
select 'raw.fact_shipment(fixture 3품목)', sum(qty) from raw.fact_shipment where item_code in ('HXCN1','HXCN2','HXCN3')
union all
select 'core.v_shipment_by_hoc(관련 대표코드 6개)', sum(qty) from core.v_shipment_by_hoc
 where hoc_item in ('HXCNA','HXCNB','HXCN2','HXCNC','HXCND','HXCN3');
SQL

exit "$STATUS"
