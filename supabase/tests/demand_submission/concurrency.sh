#!/bin/bash
# 실제 동시성 검증(fix round 3) — 별도 psql 연결(백그라운드 프로세스)로 core.close_planning_cycle과
# 부서 쓰기 함수(save/submit/withdraw/agree)를 동시에 실행해, "닫힌 취합 주기의 제출본은 절대
# 바뀌지 않는다"가 실제 경쟁 상태에서도 지켜지는지 확인한다.
#
# 세션마다 core.planning_cycle 행을 core.demand_submission 행보다 먼저 잠근다(파일 머리말 "잠금
# 순서" 참고) — 어느 쪽이 취합 주기 행을 먼저 잠그느냐로 순서가 결정되고, 교착 상태(40P01)는
# 나지 않는다(둘 다 취합 주기 → 제출본 한 방향으로만 잠근다. close_planning_cycle은 제출본 행을
# 전혀 잠그지 않는다).
#
# 사용: concurrency.sh <scm_test_* DB 이름> <로그 디렉터리>   (fixtures.psql · scenarios.psql 적용
# 뒤, 보통 run-all.sh가 부른다 — scenarios.psql이 쓴 달과 겹치지 않도록 +8·+10개월을 쓴다)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:?usage: concurrency.sh <scm_test_* db> <log dir>}
LOG_DIR=${2:?usage: concurrency.sh <scm_test_* db> <log dir>}
require_local_target "$DB"
mkdir -p "$LOG_DIR"
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
PLANNER1=00000000-0000-4000-8000-000000000101
MARKETING1=00000000-0000-4000-8000-000000000103
FAILURES=0

check() { # sql-boolean label
  if ! "${P[@]}" -c "select demand_test.check($1, '$2')"; then FAILURES=$((FAILURES + 1)); fi
}

expect_equal() { # actual expected label
  if [ "$1" = "$2" ]; then
    echo "PASS: $3 ($1)"
  else
    echo "FAIL: $3 — 실제 $1, 기대 $2"
    FAILURES=$((FAILURES + 1))
  fi
}

waiting_on_cycle() { # 취합 주기 행 잠금을 기다리는 세션 수
  "${P[@]}" -c "select count(*) from pg_stat_activity where datname = '$DB' and wait_event_type = 'Lock' and (query like '%planning_cycle%' or query like '%close_planning_cycle%' or query like '%save_demand_submission_lines%')"
}

as_marketing1='set local role authenticated; set local request.jwt.claim.sub = '"'$MARKETING1'"';'
as_planner1='set local role authenticated; set local request.jwt.claim.sub = '"'$PLANNER1'"';'

echo "== 준비 — 동시성 전용 취합 주기 2개(scenarios.psql의 달과 겹치지 않게 +8 · +10개월) =="
C1_MONTH=$("${P[@]}" -c "select to_char(date_trunc('month', current_date) + interval '8 months', 'YYYY-MM-01')")
C2_MONTH=$("${P[@]}" -c "select to_char(date_trunc('month', current_date) + interval '10 months', 'YYYY-MM-01')")
C1_CYCLE=$("${P[@]}" -c "begin; $as_planner1 select core.open_planning_cycle('$C1_MONTH'::date); commit")
C2_CYCLE=$("${P[@]}" -c "begin; $as_planner1 select core.open_planning_cycle('$C2_MONTH'::date); commit")
C1_SUB=$("${P[@]}" -c "begin; $as_marketing1 select core.start_demand_submission('$C1_MONTH'::date); commit")
C2_SUB=$("${P[@]}" -c "begin; $as_marketing1 select core.start_demand_submission('$C2_MONTH'::date); commit")
echo "C1_CYCLE=$C1_CYCLE C1_SUB=$C1_SUB / C2_CYCLE=$C2_CYCLE C2_SUB=$C2_SUB"

echo "== CC1 close_planning_cycle이 취합 주기 행을 먼저 잠근 채 대기 중 — 동시 save는 기다렸다가 거절된다 =="
# A: 취합 주기 행을 직접 FOR UPDATE로 잠근 뒤 3초 대기하다 close_planning_cycle을 부른다(이미
# 잠근 행이라 그 함수 안의 FOR UPDATE는 즉시 통과한다) — 잠금을 쥔 시점과 커밋 시점 사이를
# 벌려서, 그사이 B가 반드시 이 행을 기다리게 만든다.
(
  "${P[@]}" -c "begin" \
    -c "select * from core.planning_cycle where cycle_id = '$C1_CYCLE' for update" \
    -c "select pg_sleep(3)" \
    -c "$as_planner1 select core.close_planning_cycle('$C1_CYCLE')" \
    -c "commit" > "$LOG_DIR/cc1-a.log" 2>&1
) & A_PID=$!
sleep 0.8
# B: A가 취합 주기 행을 쥔 채 잠들어 있는 동안 같은 주기의 제출본을 저장하려 한다 — 반드시
# 대기했다가, A가 커밋(주기를 닫음)한 뒤에 "취합 주기가 닫혀..."로 거절돼야 한다.
(
  "${P[@]}" -c "begin" -c "$as_marketing1 select core.save_demand_submission_lines('$C1_SUB', '[{\"item_id\":\"ITEMD01\",\"qty\":\"1\",\"need_month\":\"2026-04\"}]'::jsonb)" -c "commit" \
    > "$LOG_DIR/cc1-b.log" 2>&1
) & B_PID=$!
sleep 1.3
expect_equal "$(waiting_on_cycle)" 1 'CC1 B가 취합 주기 행 잠금을 기다리는 중(A가 아직 커밋 전)'
wait $A_PID; EA=$?
wait $B_PID; EB=$?
expect_equal "$EA" 0 'CC1 A(close_planning_cycle)는 정상 종료'
expect_equal "$EB" 1 'CC1 B(save_demand_submission_lines)는 거절되어 비정상 종료'
if grep -q '취합 주기가 닫혀 더 이상 수정할 수 없습니다' "$LOG_DIR/cc1-b.log"; then
  echo "PASS: CC1 B의 오류 메시지가 정확히 '닫힌 취합 주기' 거절이다"
else
  echo "FAIL: CC1 B의 오류 메시지가 예상과 다르다"; FAILURES=$((FAILURES + 1))
  cat "$LOG_DIR/cc1-b.log"
fi
if grep -qi 'deadlock' "$LOG_DIR/cc1-a.log" "$LOG_DIR/cc1-b.log"; then
  echo "FAIL: CC1 로그에 deadlock 문구가 있다"; FAILURES=$((FAILURES + 1))
else
  echo "PASS: CC1 로그에 deadlock 문구 없음"
fi
check "(select not is_active and status = 'CLOSED' from core.planning_cycle where cycle_id = '$C1_CYCLE')" 'CC1 취합 주기는 닫혔다'
check "(select count(*) = 0 from core.demand_submission_line where submission_id = '$C1_SUB')" 'CC1 거절된 저장은 실제로 아무 줄도 남기지 않았다'

echo "== CC2 (반대 순서) 쓰기가 취합 주기 행을 먼저 쥔 채 대기 중 — close는 기다렸다가 그 뒤에 닫는다 =="
# B: 취합 주기 행을 FOR SHARE로 직접 잠근 뒤(core.save_demand_submission_lines가 안에서 하는 것과
# 같은 잠금) 3초 대기하다 실제 저장을 실행하고 커밋한다. FOR SHARE/FOR UPDATE는 SELECT 권한과
# 별개로 UPDATE 권한이 있어야 하는데, authenticated는 core.planning_cycle에 UPDATE 권한이
# 없다(모든 쓰기는 함수를 통해서만 한다 — 5장) — 그래서 이 사전 잠금만 접속 기본 역할(슈퍼유저)로
# 걸고, 실제 저장 호출 직전에만 authenticated로 바꾼다. save_demand_submission_lines 자체는
# security definer라 내부에서 다시 FOR SHARE를 걸 때는 함수 소유자 권한으로 거는 것과 같아
# 이미 이 트랜잭션이 쥔 잠금을 그대로(즉시) 재확인한다.
(
  "${P[@]}" -c "begin" \
    -c "select is_active from core.planning_cycle where cycle_id = '$C2_CYCLE' for share" \
    -c "select pg_sleep(3)" \
    -c "$as_marketing1 select core.save_demand_submission_lines('$C2_SUB', '[{\"item_id\":\"ITEMD01\",\"qty\":\"2\",\"need_month\":\"2026-04\"}]'::jsonb)" \
    -c "commit" > "$LOG_DIR/cc2-b.log" 2>&1
) & B_PID=$!
sleep 0.8
# A: B가 취합 주기 행을 FOR SHARE로 쥐고 있는 동안 close_planning_cycle을 부른다 — FOR UPDATE는
# FOR SHARE와 충돌하므로 B가 커밋할 때까지 반드시 기다려야 한다.
(
  "${P[@]}" -c "begin" -c "$as_planner1 select core.close_planning_cycle('$C2_CYCLE')" -c "commit" \
    > "$LOG_DIR/cc2-a.log" 2>&1
) & A_PID=$!
sleep 1.3
expect_equal "$(waiting_on_cycle)" 1 'CC2 A(close_planning_cycle)가 취합 주기 행 잠금을 기다리는 중(B가 아직 커밋 전)'
wait $B_PID; EB=$?
wait $A_PID; EA=$?
expect_equal "$EB" 0 'CC2 B(save_demand_submission_lines)는 정상 종료(A보다 먼저 커밋)'
expect_equal "$EA" 0 'CC2 A(close_planning_cycle)는 B가 끝난 뒤 정상 종료'
if grep -qi 'deadlock' "$LOG_DIR/cc2-a.log" "$LOG_DIR/cc2-b.log"; then
  echo "FAIL: CC2 로그에 deadlock 문구가 있다"; FAILURES=$((FAILURES + 1))
else
  echo "PASS: CC2 로그에 deadlock 문구 없음"
fi
check "(select count(*) = 1 from core.demand_submission_line where submission_id = '$C2_SUB' and qty = 2)" 'CC2 B의 저장은 A가 닫기 전에 먼저 반영됐다'
check "(select not is_active and status = 'CLOSED' from core.planning_cycle where cycle_id = '$C2_CYCLE')" 'CC2 그 뒤 취합 주기는 정상적으로 닫혔다'
# 마무리 — 닫힌 뒤에는 이 제출본도 그대로 얼어붙어야 한다(라운드 1·2의 정책을 동시성 상황에서도 재확인).
"${P[@]}" -c "begin" -c "$as_marketing1 select core.save_demand_submission_lines('$C2_SUB', '[]'::jsonb)" -c "commit" > "$LOG_DIR/cc2-followup.log" 2>&1
FOLLOWUP_EXIT=$?
expect_equal "$FOLLOWUP_EXIT" 1 'CC2 닫힌 뒤 세 번째 저장 시도는 거절된다(얼어붙음 재확인)'

if [ "$FAILURES" -ne 0 ]; then
  echo "동시성 검증 실패: ${FAILURES}건"
  exit 1
fi
