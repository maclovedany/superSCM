#!/bin/bash
# 발주계획 계산·확정·승인(Task 9b) DB 검증 전체 실행 — 로컬 PostgreSQL 임시 DB 전용
#   임시 DB 생성(bootstrap) → fixture → 시나리오 → 요약 → 임시 DB 삭제
# 사용: bash supabase/tests/procurement_plan/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp 임시 디렉터리)
#   다른 세션 timezone: PGOPTIONS="-c timezone=America/Los_Angeles" bash run-all.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_procplan_$(date +%Y%m%d%H%M%S)}
require_local_target "$DB"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_procplan.XXXXXX")}
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

echo "DB: $DB · 로그: $LOG_DIR · $PGOPTIONS"
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
# 통과 줄은 "PASS: "로 시작한다. 기대한 오류 문구(→ 42501 …)에 섞인 단어를 실패로 세지 않도록
# 실패는 "FAIL" 또는 psql 오류 접두어("psql:…ERROR")만 센다.
echo "scenarios: PASS $(count '^PASS' "$LOG_DIR/scenarios.log") · FAIL/ERROR $(count '^FAIL|FAIL:|psql:.*ERROR' "$LOG_DIR/scenarios.log")"
for scenario in S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 S20 S21 S22 S23 S24; do
  printf '  %s PASS %s\n' "$scenario" "$(count "^PASS: $scenario " "$LOG_DIR/scenarios.log")"
done

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패"
  grep -hE '^FAIL|FAIL:|psql:.*ERROR' "$LOG_DIR"/scenarios.log | head -30
else
  echo "결과: 전부 통과"
fi
exit "$STATUS"
