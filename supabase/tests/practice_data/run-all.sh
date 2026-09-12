#!/bin/bash
# 실습용 데이터 표식·제거(Task 15) DB 검증 전체 실행 — 로컬 PostgreSQL 임시 DB 전용
#
#   1부 (DB: <이름>)        표식 · 제거 · 실데이터 보존                      S1~S12
#   2부 (DB: <이름>_pipe)   실제 적재 · 승인 · Forecast · 계획 · 일정 경로    S13~S19  (fix round 1 · I1)
#   3부 (DB: <이름>_retire) 5회차 더미 사용 이력 정리 · 복구                  S20~S21  (fix round 2)
#
# ★ 세 부는 **서로 다른 임시 DB**에서 돈다.
#   1·2부를 한 DB에서 돌리면 1부가 일부러 남긴 행(제거하지 못한 실습 품목 · 실데이터 대역)의 품목
#   정책이 2부의 발주계획 확정을 막는다 — Task 9b 확정은 정책이 있는 모든 품목에 전부-아니면-전무다.
#   3부는 raw.usage_history 전체를 대상으로 정리·복구하므로 다른 부의 사용 이력이 섞이면 건수
#   비교가 무의미해진다.
#
# 사용: bash supabase/tests/practice_data/run-all.sh [scm_test_* DB 이름]
#   KEEP_DB=1  끝난 뒤 DB를 지우지 않는다(조사용)
#   LOG_DIR=…  로그 위치(기본: mktemp 임시 디렉터리)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:-scm_test_practice_$(date +%Y%m%d%H%M%S)}
DB_PIPE="${DB}_pipe"
DB_RETIRE="${DB}_retire"
require_local_target "$DB"
require_local_target "$DB_PIPE"
require_local_target "$DB_RETIRE"
LOG_DIR=${LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/scm_test_practice.XXXXXX")}
mkdir -p "$LOG_DIR/part1" "$LOG_DIR/part2" "$LOG_DIR/part3"

cleanup() {
  if [ "${KEEP_DB:-0}" = 1 ]; then
    echo "유지: $DB · $DB_PIPE · $DB_RETIRE (KEEP_DB=1 — 확인 후 dropdb)"
  else
    dropdb --if-exists "$DB" && echo "삭제: $DB"
    dropdb --if-exists "$DB_PIPE" && echo "삭제: $DB_PIPE"
    dropdb --if-exists "$DB_RETIRE" && echo "삭제: $DB_RETIRE"
  fi
}
trap cleanup EXIT

count() { grep -cE "$1" "$2" || true; }

echo "DB: $DB · $DB_PIPE · $DB_RETIRE · 로그: $LOG_DIR"

STATUS=0
COMBINED="$LOG_DIR/all-scenarios.log"
: > "$COMBINED"

run_part() {
  local db="$1" dir="$2" fixtures="$3" scenarios="$4" label="$5"
  if ! bash "$HERE/bootstrap.sh" "$db" "$LOG_DIR/$dir"; then
    echo "결과: $label bootstrap 실패 (로그 $LOG_DIR/$dir)"
    exit 1
  fi
  local psql=(psql -X -q -v ON_ERROR_STOP=1 -d "$db")
  if ! "${psql[@]}" -f "$HERE/$fixtures" > "$LOG_DIR/$dir/fixtures.log" 2>&1; then
    echo "결과: $label fixture 실패"; tail -20 "$LOG_DIR/$dir/fixtures.log"
    exit 1
  fi
  "${psql[@]}" -f "$HERE/$scenarios" > "$LOG_DIR/$dir/scenarios.log" 2>&1 || STATUS=1
  cat "$LOG_DIR/$dir/scenarios.log" >> "$COMBINED"
}

run_part "$DB"        part1 fixtures.psql          scenarios.psql          "1부"
run_part "$DB_PIPE"   part2 pipeline-fixtures.psql pipeline-scenarios.psql "2부"
run_part "$DB_RETIRE" part3 retire-fixtures.psql   retire-scenarios.psql   "3부"

echo "scenarios: PASS $(count '^PASS' "$COMBINED") · FAIL/ERROR $(count 'FAIL|ERROR' "$COMBINED")"
for scenario in S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 S11 S12 S13 S14 S15 S16 S17 S18 S19 S20 S21; do
  printf '  %s PASS %s\n' "$scenario" "$(count "^PASS: $scenario " "$COMBINED")"
done

if [ "$STATUS" -ne 0 ]; then
  echo "결과: 실패"
  grep -hE 'FAIL|ERROR' "$LOG_DIR"/part*/scenarios.log | head -30
else
  echo "결과: 전부 통과"
fi
exit "$STATUS"
