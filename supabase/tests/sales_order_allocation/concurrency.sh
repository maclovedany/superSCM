#!/bin/bash
# 실제 동시성 검증 — 별도 psql 연결(백그라운드 프로세스)로 같은 품목에 검토 요청을 동시에 보낸다.
# 사용: concurrency.sh <scm_test_* DB 이름> <로그 디렉터리>   (fixtures.psql 적용 뒤, 보통 run-all.sh가 부른다)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:?usage: concurrency.sh <scm_test_* db> <log dir>}
LOG_DIR=${2:?usage: concurrency.sh <scm_test_* db> <log dir>}
require_local_target "$DB"
mkdir -p "$LOG_DIR"
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
SALES1=00000000-0000-4000-8000-000000000001
SALES2=00000000-0000-4000-8000-000000000002
FAILURES=0

create_order() { # user item qty
  "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$1'" \
    -c "select core.create_sales_order(null, '동시성 고객', '[{\"item_id\":\"$2\",\"qty\":$3}]'::jsonb)" -c "commit"
}

review() { # user order choice log [statement_timeout]
  "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$1'" \
    -c "set local statement_timeout = '${5:-0}'" \
    -c "select core.request_order_review('$2', '$3')" -c "commit" > "$4" 2>&1
}

waiting() {
  "${P[@]}" -c "select count(*) from pg_stat_activity where datname = '$DB' and wait_event_type = 'Lock' and query like '%request_order_review%'"
}

gate() { # item seconds — 관리 세션이 재고 행을 잠근 채 기다려, 뒤따르는 요청이 모두 동시에 진행 중이게 만든다
  "${P[@]}" -c "begin" -c "select 1 from core.stock_balance where item_id = '$1' for update" -c "select pg_sleep($2)" -c "commit" > /dev/null
}

check() { # sql-boolean label
  if ! "${P[@]}" -c "select order_test.check($1, '$2')"; then FAILURES=$((FAILURES + 1)); fi
}

expect_equal() { # actual expected label
  if [ "$1" = "$2" ]; then
    echo "PASS: $3 ($1)"
  else
    echo "FAIL: $3 — 실제 $1, 기대 $2"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "== C1 재고 100 · 두 영업담당자가 동시에 60 요청 (ITEMT01, PARTIAL/PARTIAL) =="
A=$(create_order $SALES1 ITEMT01 60); B=$(create_order $SALES2 ITEMT01 60)
gate ITEMT01 4 & GATE=$!
sleep 0.5
review $SALES1 "$A" PARTIAL "$LOG_DIR/c1-a.log" & PA=$!
review $SALES2 "$B" PARTIAL "$LOG_DIR/c1-b.log" & PB=$!
sleep 1.5
expect_equal "$(waiting)" 2 'C1 재고 행 잠금을 기다리는 검토 요청 수'
wait $GATE; wait $PA; EA=$?; wait $PB; EB=$?
expect_equal "$EA/$EB" 0/0 'C1 두 요청 프로세스 종료 코드'
"${P[@]}" -c "select o.order_no || ' ' || o.status || ' 임시=' || l.temporary_allocated_qty || ' 부족=' || l.shortage_qty from core.sales_order o join core.sales_order_line l using (order_id) where o.order_id in ('$A', '$B') order by l.temporary_allocated_qty desc"
check "(select sum(qty) from core.stock_allocation where item_id = 'ITEMT01' and status <> 'RELEASED') = 100" 'C1 동시 60+60 → 배정 합계 100 (초과 없음)'
check "(select string_agg(temporary_allocated_qty::text || '/' || shortage_qty, ',' order by temporary_allocated_qty desc) from core.sales_order_line where order_id in ('$A', '$B')) = '60/0,40/20'" 'C1 먼저 잠금을 얻은 쪽 60, 나머지 PARTIAL 40 + 부족 20'

echo "== C2 재고 100 · 동시 검토 요청 10건 × 30 (ITEMC01, PARTIAL 5 / WAIT_FULL 5, 잠금 게이트) =="
ORDERS=()
for i in $(seq 1 10); do ORDERS+=("$(create_order $SALES1 ITEMC01 30)"); done
gate ITEMC01 6 & GATE=$!
sleep 0.5
PIDS=()
for i in $(seq 0 9); do
  CHOICE=$([ $((i % 2)) -eq 0 ] && echo PARTIAL || echo WAIT_FULL)
  review $SALES1 "${ORDERS[$i]}" "$CHOICE" "$LOG_DIR/c2-$i.log" & PIDS+=($!)
done
sleep 2.5
expect_equal "$(waiting)" 10 'C2 재고 행 잠금을 기다리는 검토 요청 수 — 10건이 동시에 진행 중'
wait $GATE
FAILED=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED=$((FAILED + 1)); done
expect_equal "$FAILED" 0 'C2 실패한 요청 프로세스'
IDS=$(printf "'%s'," "${ORDERS[@]}"); IDS=${IDS%,}
"${P[@]}" -c "select o.status || ' ' || o.allocation_choice || ' 임시=' || l.temporary_allocated_qty || ' 부족=' || l.shortage_qty from core.sales_order o join core.sales_order_line l using (order_id) where o.order_id in ($IDS) order by l.temporary_allocated_qty desc, o.allocation_choice"
check "(select sum(qty) from core.stock_allocation where item_id = 'ITEMC01' and status <> 'RELEASED') = 100" 'C2 동시 10건 → 배정 합계 정확히 100 (초과 0)'
check "(select count(*) from core.sales_order where order_id in ($IDS) and status = 'DRAFT') = 0" 'C2 10건 모두 검토 요청 처리됨'
check "(select bool_and(temporary_allocated_qty in (0, 30) or (o.allocation_choice = 'PARTIAL' and temporary_allocated_qty = 10)) from core.sales_order_line l join core.sales_order o using (order_id) where o.order_id in ($IDS))" 'C2 WAIT_FULL은 0 또는 30 전량, 나머지는 PARTIAL 10만'

echo "== C3 다른 품목은 서로 막지 않는다 (ITEMC01 잠금 중 ITEMC02 요청) =="
X=$(create_order $SALES2 ITEMC02 30); Y=$(create_order $SALES2 ITEMC01 1)
gate ITEMC01 6 & GATE=$!
sleep 0.5
review $SALES2 "$X" PARTIAL "$LOG_DIR/c3-x.log" 2s; EX=$?
expect_equal "$EX" 0 'C3 잠금 중인 품목과 다른 품목 ITEMC02 요청은 2초 제한 안에 완료'
review $SALES2 "$Y" PARTIAL "$LOG_DIR/c3-y.log" 2s; EY=$?
expect_equal "$EY/$(grep -c 'canceling statement due to statement timeout' "$LOG_DIR/c3-y.log")" 1/1 'C3 같은 품목 ITEMC01 요청은 잠금 대기로 statement timeout'
wait $GATE
check "(select status from core.sales_order where order_id = '$X') = 'REVIEW_REQUESTED'" 'C3 다른 품목 요청 반영'
check "(select status from core.sales_order where order_id = '$Y') = 'DRAFT'" 'C3 시간 초과로 취소된 같은 품목 요청은 부분 반영 없이 DRAFT'

echo "== C4 게이트 없이 동시 요청 10건 × 30 (ITEMC03, 모두 PARTIAL) =="
ORDERS=()
for i in $(seq 1 10); do ORDERS+=("$(create_order $SALES2 ITEMC03 30)"); done
PIDS=()
for i in $(seq 0 9); do review $SALES2 "${ORDERS[$i]}" PARTIAL "$LOG_DIR/c4-$i.log" & PIDS+=($!); done
FAILED=0
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED=$((FAILED + 1)); done
expect_equal "$FAILED" 0 'C4 실패한 요청 프로세스'
IDS=$(printf "'%s'," "${ORDERS[@]}"); IDS=${IDS%,}
check "(select sum(qty) from core.stock_allocation where item_id = 'ITEMC03' and status <> 'RELEASED') = 100" 'C4 동시 10건 → 배정 합계 정확히 100'
check "(select string_agg(temporary_allocated_qty::text, ',' order by temporary_allocated_qty desc) from core.sales_order_line where order_id in ($IDS)) = '30,30,30,10,0,0,0,0,0,0'" 'C4 선착순 30·30·30·10, 나머지 0 + 부족 표시'

if [ "$FAILURES" -ne 0 ]; then
  echo "동시성 검증 실패: $FAILURES건"
  exit 1
fi
