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

echo "== C5 Task 6 · 만료 작업 · 입고 커밋 · 검토 요청 동시 실행 (ITEMCJ01, 재고 100) =="
L1=$(create_order $SALES1 ITEMCJ01 60)
# 테스트 전용 경로(scenarios.psql S9~S11과 동일): 아직 DRAFT인 주문을 곧바로 4초 뒤 만료되는
# REVIEW_REQUESTED 상태로 소급하고, 임시배정 60을 직접 만든다(shortage=0 → 만료 후보로만 잡힌다).
# review_at을 한 번만 계산해 두 열(first_review_requested_at · temporary_expires_at)에 같은 값을
# 써야 한다 — clock_timestamp()를 SET 절에서 두 번 부르면 미세하게 달라져 INV(만료 = 최초 검토
# 요청 + 30일)가 깨진다.
REVIEW_AT=$("${P[@]}" -c "select (clock_timestamp() - interval '30 days' + interval '4 seconds')::timestamptz")
"${P[@]}" -c "update core.sales_order set status = 'REVIEW_REQUESTED', allocation_choice = 'PARTIAL', allocation_choice_by = owner_user_id, first_review_requested_at = '$REVIEW_AT'::timestamptz, temporary_expires_at = '$REVIEW_AT'::timestamptz + interval '30 days' where order_id = '$L1'" > /dev/null
"${P[@]}" -c "select core.log_sales_order_event(order_id, 'REVIEW_REQUESTED', 'DRAFT', 'REVIEW_REQUESTED', owner_user_id, '동시성 검증용 소급', '{}'::jsonb) from core.sales_order where order_id = '$L1'" > /dev/null
L1_LINE=$("${P[@]}" -c "select line_id from core.sales_order_line where order_id = '$L1'")
"${P[@]}" -c "select core.allocate_to_order_line($L1_LINE, 60, 'REVIEW_REQUEST', null)" > /dev/null
sleep 4.5

(
  "${P[@]}" -c "select * from core.expire_temporary_allocations()" > "$LOG_DIR/c5-expire.log" 2>&1
) & EXPIRE_PID=$!
(
  "${P[@]}" -c "select order_test.commit_goods_receipt('ITEMCJ01', 20)" > "$LOG_DIR/c5-receipt.log" 2>&1
) & RECEIPT_PID=$!
L2=$(create_order $SALES2 ITEMCJ01 15)
(
  review $SALES2 "$L2" PARTIAL "$LOG_DIR/c5-review-l2.log"
) & REVIEW_PID=$!
wait $EXPIRE_PID; E1=$?
wait $RECEIPT_PID; E2=$?
wait $REVIEW_PID; E3=$?
expect_equal "$E1/$E2/$E3" 0/0/0 'C5 만료 작업 · 입고 커밋 · 검토 요청 세 프로세스 모두 성공 종료'
# 세 경로 모두 core.lock_stock_balance_items로 같은 품목 행을 먼저 잠그는 단일 자원 경합이라
# (Task 5 잠금 순서 규약) 순환 대기가 없고, PostgreSQL은 40P01(교착) 대신 행 잠금 대기로만
# 직렬화한다 — 위 종료 코드 0/0/0이 그 증거다.
check "(select coalesce(sum(qty), 0) from core.stock_allocation where item_id = 'ITEMCJ01' and status <> 'RELEASED') <= (select normal_qty from core.stock_balance where item_id = 'ITEMCJ01')" \
  'C5 동시 실행 뒤에도 배정 합계가 정상 창고재고를 넘지 않는다(초과 배정 없음)'
# 마무리: 남아 있을 수 있는 만료 후보를 한 번 더 정리하고 L1이 결국 만료되는지 확인한다(멱등 재실행).
"${P[@]}" -c "select * from core.expire_temporary_allocations()" > "$LOG_DIR/c5-expire-cleanup.log" 2>&1
check "(select status from core.sales_order where order_id = '$L1') = 'EXPIRED'" 'C5 L1은 동시 실행 뒤에도 결국 EXPIRED로 정리된다'

echo "== C6 Task 6 · 만료 작업 중 한 주문의 실패가 다른 주문 처리를 막지 않는다 (ITEMCJ02 잠금 대기로 실패 강제) =="
M1=$(create_order $SALES1 ITEMCJ02 25)
M2=$(create_order $SALES2 ITEMCJ03 12)
REVIEW_AT2=$("${P[@]}" -c "select (clock_timestamp() - interval '30 days' + interval '4 seconds')::timestamptz")
"${P[@]}" -c "update core.sales_order set status = 'REVIEW_REQUESTED', allocation_choice = 'PARTIAL', allocation_choice_by = owner_user_id, first_review_requested_at = '$REVIEW_AT2'::timestamptz, temporary_expires_at = '$REVIEW_AT2'::timestamptz + interval '30 days' where order_id in ('$M1', '$M2')" > /dev/null
"${P[@]}" -c "select core.log_sales_order_event(order_id, 'REVIEW_REQUESTED', 'DRAFT', 'REVIEW_REQUESTED', owner_user_id, '동시성 검증용 소급', '{}'::jsonb) from core.sales_order where order_id in ('$M1', '$M2')" > /dev/null
M1_LINE=$("${P[@]}" -c "select line_id from core.sales_order_line where order_id = '$M1'")
M2_LINE=$("${P[@]}" -c "select line_id from core.sales_order_line where order_id = '$M2'")
"${P[@]}" -c "select core.allocate_to_order_line($M1_LINE, 25, 'REVIEW_REQUEST', null)" > /dev/null
"${P[@]}" -c "select core.allocate_to_order_line($M2_LINE, 12, 'REVIEW_REQUEST', null)" > /dev/null
sleep 4.5

# ITEMCJ02 재고 행을 3초 잠근 채로 만료 작업을 짧은 lock_timeout으로 부른다 — M1(ITEMCJ02) 처리는
# 잠금 대기 중 lock_timeout(55P03)으로 실패해야 하고, 그 실패는 BEGIN…EXCEPTION 서브트랜잭션
# 안에서만 롤백돼야 한다 — 같은 호출에서 다른 품목(ITEMCJ03)의 M2는 정상 처리돼야 한다.
gate ITEMCJ02 3 & GATE=$!
sleep 0.5
RESULT=$("${P[@]}" -c "set lock_timeout = '1s'; with r as (select * from core.expire_temporary_allocations()) select coalesce((select outcome from r where order_id = '$M1'), 'MISSING') || '|' || coalesce((select error_message from r where order_id = '$M1'), '') || '|' || coalesce((select outcome from r where order_id = '$M2'), 'MISSING')")
wait $GATE
M1_OUTCOME=$(echo "$RESULT" | awk -F'|' '{print $1}')
M1_ERROR=$(echo "$RESULT" | awk -F'|' '{print $2}')
M2_OUTCOME=$(echo "$RESULT" | awk -F'|' '{print $3}')
expect_equal "$M1_OUTCOME" "FAILED" 'C6 잠긴 품목(M1)은 lock_timeout으로 FAILED 처리(삼키지 않고 보고)'
case "$M1_ERROR" in
  *"55P03"*|*"lock timeout"*|*"canceling statement"*) echo "PASS: C6 M1 오류 메시지에 잠금 대기 초과가 기록됨 ($M1_ERROR)" ;;
  *) echo "FAIL: C6 M1 오류 메시지에 잠금 대기 초과가 없음 ($M1_ERROR)"; FAILURES=$((FAILURES + 1)) ;;
esac
expect_equal "$M2_OUTCOME" "EXPIRED" 'C6 다른 품목(M2)은 M1 실패와 무관하게 같은 호출에서 정상 EXPIRED'
check "(select status from core.sales_order where order_id = '$M1') <> 'EXPIRED'" 'C6 M1 주문은 실패로 그대로 유지(만료 처리 안 됨)'
check "(select status from core.stock_allocation where order_id = '$M1') = 'TEMPORARY'" 'C6 M1 임시배정은 실패로 해제되지 않고 그대로 TEMPORARY(격리 확인)'
check "(select status from core.sales_order where order_id = '$M2') = 'EXPIRED'" 'C6 M2 주문은 정상 EXPIRED'
# 잠금이 풀린 뒤 재시도하면(운영에서는 다음 10분 Cron 회차) M1도 정상 처리된다 — 실패가 영구적이지 않음을 확인.
"${P[@]}" -c "select * from core.expire_temporary_allocations()" > "$LOG_DIR/c6-retry.log" 2>&1
check "(select status from core.sales_order where order_id = '$M1') = 'EXPIRED'" 'C6 잠금 해제 뒤 재시도(다음 Cron 회차 대역)하면 M1도 정상 EXPIRED'

echo "== C7 우선 배정 승인 vs 주문 취소 동시 실행 — 교착(40P01) 없이 한쪽만 이긴다 (ITEMCX01) =="
# 최종 리뷰 Important 4 — core.decide_approval은 core.approval_request를 먼저 잠그고 후처리 훅에서
# 도메인 행을 잠근다. 예전 취소 경로(core.cancel_sales_order → core.release_order_allocations)는
# 재고 · 주문 · 배정 행을 먼저 잡고 나중에 승인 행을 잡아 순서가 뒤집혔고, 같은 요청에 승인과 취소가
# 동시에 들어오면 40P01(deadlock detected) 영문 오류가 화면에 그대로 나왔다. 이제 취소 경로도
# core.lock_order_pending_approvals로 승인 행을 먼저 잠근다 — 한쪽은 기다렸다가 업무 오류로 거절된다.
PLANNER1=00000000-0000-4000-8000-000000000011
LEAD1=00000000-0000-4000-8000-000000000021
APPROVE_WINS=0
CANCEL_WINS=0
# 라운드 1~3은 승인을 먼저, 4~5는 취소를 먼저 띄운다 — 어느 쪽이 먼저 승인 행을 잡아도 교착 없이
# 한쪽만 이기는지(그리고 진 쪽이 업무 오류로 거절되는지) 양방향으로 확인한다.
for round in 1 2 3 4 5; do
  # 앞선 대기 주문(부족 300)이 있어야 뒤 주문의 수동 배정이 "순서 건너뜀"으로 APPROVAL_HOLD가 된다.
  W=$(create_order $SALES1 ITEMCX01 300)
  review $SALES1 "$W" WAIT_FULL "$LOG_DIR/c7-wait-$round.log"
  T=$(create_order $SALES2 ITEMCX01 250)
  review $SALES2 "$T" WAIT_FULL "$LOG_DIR/c7-target-$round.log"
  "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$PLANNER1'" \
    -c "select core.request_manual_allocation('$T', 'ITEMCX01', 20, '동시성 검증 $round')" -c "commit" \
    > "$LOG_DIR/c7-hold-$round.log" 2>&1
  AP=$("${P[@]}" -c "select r.approval_id from core.approval_request r join core.stock_allocation a on a.approval_id = r.approval_id where a.order_id = '$T' and r.status = 'PENDING' limit 1")
  if [ -z "$AP" ]; then
    echo "FAIL: C7 라운드 $round — 승인대기 확보를 만들지 못했다 ($(tail -2 "$LOG_DIR/c7-hold-$round.log" | tr '\n' ' '))"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  if [ "$round" -le 3 ]; then
    ( "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$LEAD1'" \
        -c "select core.decide_approval('$AP', 'APPROVED', '동시성 검증 승인 $round')" -c "commit" ) \
      > "$LOG_DIR/c7-approve-$round.log" 2>&1 & PA=$!
    ( "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$SALES2'" \
        -c "select core.cancel_sales_order('$T', '동시성 검증 취소 $round')" -c "commit" ) \
      > "$LOG_DIR/c7-cancel-$round.log" 2>&1 & PC=$!
  else
    ( "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$SALES2'" \
        -c "select core.cancel_sales_order('$T', '동시성 검증 취소 $round')" -c "commit" ) \
      > "$LOG_DIR/c7-cancel-$round.log" 2>&1 & PC=$!
    ( "${P[@]}" -c "begin" -c "set local role authenticated" -c "set local request.jwt.claim.sub = '$LEAD1'" \
        -c "select core.decide_approval('$AP', 'APPROVED', '동시성 검증 승인 $round')" -c "commit" ) \
      > "$LOG_DIR/c7-approve-$round.log" 2>&1 & PA=$!
  fi
  wait $PA; EA=$?
  wait $PC; EC=$?

  DEADLOCKS=$(cat "$LOG_DIR/c7-approve-$round.log" "$LOG_DIR/c7-cancel-$round.log" | grep -cE '40P01|deadlock detected' || true)
  expect_equal "$DEADLOCKS" 0 "C7 라운드 $round 교착(40P01) 발생 건수"
  WINNERS=$(( (EA == 0 ? 1 : 0) + (EC == 0 ? 1 : 0) ))
  expect_equal "$WINNERS" 1 "C7 라운드 $round 성공한 쪽 수(승인 exit=$EA · 취소 exit=$EC)"

  if [ "$EA" -eq 0 ]; then
    APPROVE_WINS=$((APPROVE_WINS + 1))
    if grep -q 'FIRM_ALLOCATION_EXISTS' "$LOG_DIR/c7-cancel-$round.log"; then
      echo "PASS: C7 라운드 $round 승인이 이김 — 취소는 확정배정 존재 업무 오류로 거절"
    else
      echo "FAIL: C7 라운드 $round 승인이 이겼는데 취소 오류가 업무 오류가 아니다 ($(tail -2 "$LOG_DIR/c7-cancel-$round.log" | tr '\n' ' '))"
      FAILURES=$((FAILURES + 1))
    fi
    check "(select status = 'FIRM' from core.stock_allocation where approval_id = '$AP')" \
      "C7 라운드 $round 승인이 이기면 확보가 FIRM으로 전환된다"
    check "(select status <> 'CANCELLED' from core.sales_order where order_id = '$T')" \
      "C7 라운드 $round 승인이 이기면 주문은 취소되지 않는다"
  else
    CANCEL_WINS=$((CANCEL_WINS + 1))
    if grep -q '이미 처리되었거나 취소된 승인 요청입니다' "$LOG_DIR/c7-approve-$round.log"; then
      echo "PASS: C7 라운드 $round 취소가 이김 — 승인은 업무 오류로 거절"
    else
      echo "FAIL: C7 라운드 $round 취소가 이겼는데 승인 오류가 업무 오류가 아니다 ($(tail -2 "$LOG_DIR/c7-approve-$round.log" | tr '\n' ' '))"
      FAILURES=$((FAILURES + 1))
    fi
    check "(select status = 'CANCELLED' from core.approval_request where approval_id = '$AP')" \
      "C7 라운드 $round 취소가 이기면 승인 요청도 취소된다"
    check "(select status = 'RELEASED' from core.stock_allocation where approval_id = '$AP')" \
      "C7 라운드 $round 취소가 이기면 확보수량이 해제된다"
  fi
  check "(select count(*) = 0 from core.notification_outbox where template_code = 'APPROVAL_PENDING' and payload ->> 'approval_id' = '$AP' and status not in ('CANCELLED', 'SENT'))" \
    "C7 라운드 $round 결정·취소 뒤 팀장 대기 반복 알림이 남지 않는다"
done
echo "C7 결과 요약: 승인이 이김 ${APPROVE_WINS}회 · 취소가 이김 ${CANCEL_WINS}회 (교착 0회)"

if [ "$FAILURES" -ne 0 ]; then
  echo "동시성 검증 실패: ${FAILURES}건"
  exit 1
fi
