#!/bin/bash
# 영업 주문 · 재고 배정 DB 검증 전체 실행 — 로컬 PostgreSQL 임시 DB 전용
#   임시 DB 생성(bootstrap) → fixture → 시나리오 → 동시성 → 불변식 → 요약 → 임시 DB 삭제
# 사용: bash supabase/tests/sales_order_allocation/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp 임시 디렉터리)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_order_alloc_$(date +%Y%m%d%H%M%S)}
require_local_target "$DB"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_order_alloc.XXXXXX")}
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
echo "scenarios:   PASS $(count '^PASS' "$LOG_DIR/scenarios.log") · FAIL/ERROR $(count 'FAIL|ERROR' "$LOG_DIR/scenarios.log")"
for scenario in S2 S3 S4 S5 S6 S7 S8 S9 S10; do
  printf '  %s PASS %s\n' "$scenario" "$(count "^PASS: $scenario " "$LOG_DIR/scenarios.log")"
done

bash "$HERE/concurrency.sh" "$DB" "$LOG_DIR" > "$LOG_DIR/concurrency.log" 2>&1 || STATUS=1
echo "concurrency: PASS $(count '^PASS' "$LOG_DIR/concurrency.log") · FAIL/ERROR $(count '^FAIL|ERROR' "$LOG_DIR/concurrency.log")"
grep -E '잠금을 기다리는|선착순|정확히 100' "$LOG_DIR/concurrency.log" | sed 's/^/  /'

"${PSQL[@]}" -f "$HERE/invariants.psql" > "$LOG_DIR/invariants.log" 2>&1 || STATUS=1
echo "invariants:  PASS $(count '^PASS' "$LOG_DIR/invariants.log") · FAIL/ERROR $(count 'FAIL|ERROR' "$LOG_DIR/invariants.log")"

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패"
  grep -hE 'FAIL|ERROR' "$LOG_DIR"/scenarios.log "$LOG_DIR"/concurrency.log "$LOG_DIR"/invariants.log | head -20
else
  echo "결과: 전부 통과"
fi
exit "$STATUS"
