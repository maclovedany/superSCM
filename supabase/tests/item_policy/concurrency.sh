#!/bin/bash
# 품목 정책 변경 — 승인과 취소를 동시에 실행했을 때 교착(40P01)이 나지 않는지 검증한다.
# 사용: concurrency.sh <scm_test_* DB 이름> <로그 디렉터리>   (fixtures.psql 적용 뒤, 보통 run-all.sh가 부른다)
#
# 왜 필요한가(최종 리뷰 Important 4) — core.decide_approval(Task 2)은 core.approval_request를 먼저
# 잠근 뒤 후처리 훅에서 core.item_policy_revision을 잠근다. 예전 core.cancel_item_policy_change는
# 반대로 변경안 행을 먼저 잠갔다. 두 경로가 같은 요청에 동시에 들어오면 순서가 뒤집혀
# PostgreSQL이 한쪽을 40P01(deadlock detected)로 되돌렸고, 그 영문 오류가 화면에 그대로 나왔다.
# 이제 취소 경로도 승인 행을 먼저 잠근다 — 한쪽은 기다렸다가 업무 오류로 정상 거절돼야 한다.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
source "$HERE/lib.sh"

DB=${1:?usage: concurrency.sh <scm_test_* db> <log dir>}
LOG_DIR=${2:?usage: concurrency.sh <scm_test_* db> <log dir>}
require_local_target "$DB"
mkdir -p "$LOG_DIR"
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
PLANNER1=00000000-0000-4000-8000-000000000301
LEAD1=00000000-0000-4000-8000-000000000303
ITEM=ITEMT904
ROUNDS=5
FAILURES=0
APPROVE_WINS=0
CANCEL_WINS=0

check() { # sql-boolean label
  if ! "${P[@]}" -c "select itempolicy_test.check($1, '$2')"; then FAILURES=$((FAILURES + 1)); fi
}

expect_equal() { # actual expected label
  if [ "$1" = "$2" ]; then
    echo "PASS: $3 ($1)"
  else
    echo "FAIL: $3 — 실제 $1, 기대 $2"
    FAILURES=$((FAILURES + 1))
  fi
}

as_user() { # user sql logfile
  "${P[@]}" -c "begin" -c "set local role authenticated" \
    -c "set local request.jwt.claim.sub = '$1'" -c "$2" -c "commit" > "$3" 2>&1
}

echo "== C1 같은 정책 변경 요청을 동시에 승인·취소 (${ROUNDS}회, ${ITEM}) =="
for round in $(seq 1 $ROUNDS); do
  as_user "$PLANNER1" \
    "select core.request_item_policy_change('$ITEM', $((29 + round)), 'AUTO', null, null, null, null, null, '동시성 검증 $round')" \
    "$LOG_DIR/c1-request-$round.log"
  REV=$("${P[@]}" -c "select revision_id from core.item_policy_revision where item_id = '$ITEM' and status = 'PENDING' order by requested_at desc limit 1")
  AP=$("${P[@]}" -c "select approval_id from core.item_policy_revision where revision_id = '$REV'")
  if [ -z "$REV" ] || [ -z "$AP" ]; then
    echo "FAIL: C1 라운드 $round — 대기 중 변경안을 만들지 못했다"
    FAILURES=$((FAILURES + 1))
    continue
  fi

  # 두 연결을 동시에 띄운다. 한쪽은 승인(팀장), 한쪽은 요청자 본인의 취소다.
  # 라운드 1~3은 승인을 먼저, 4~5는 취소를 먼저 띄운다 — 어느 쪽이 먼저 승인 행을 잡아도 교착 없이
  # 한쪽만 이기고 진 쪽은 업무 오류로 거절되는지 양방향으로 확인한다.
  if [ "$round" -le 3 ]; then
    as_user "$LEAD1" "select core.decide_approval('$AP', 'APPROVED', '동시성 검증 승인 $round')" \
      "$LOG_DIR/c1-approve-$round.log" & PA=$!
    as_user "$PLANNER1" "select core.cancel_item_policy_change('$REV', '동시성 검증 취소 $round')" \
      "$LOG_DIR/c1-cancel-$round.log" & PC=$!
  else
    as_user "$PLANNER1" "select core.cancel_item_policy_change('$REV', '동시성 검증 취소 $round')" \
      "$LOG_DIR/c1-cancel-$round.log" & PC=$!
    as_user "$LEAD1" "select core.decide_approval('$AP', 'APPROVED', '동시성 검증 승인 $round')" \
      "$LOG_DIR/c1-approve-$round.log" & PA=$!
  fi
  wait $PA; EA=$?
  wait $PC; EC=$?

  # 1) 어느 쪽도 교착으로 끝나지 않아야 한다.
  DEADLOCK=$(grep -clE '40P01|deadlock detected|교착' "$LOG_DIR/c1-approve-$round.log" "$LOG_DIR/c1-cancel-$round.log" | grep -c ':[1-9]' || true)
  expect_equal "$DEADLOCK" 0 "C1 라운드 $round 교착(40P01) 발생 파일 수"

  # 2) 정확히 한쪽만 성공해야 한다.
  WINNERS=$(( (EA == 0 ? 1 : 0) + (EC == 0 ? 1 : 0) ))
  expect_equal "$WINNERS" 1 "C1 라운드 $round 성공한 쪽 수(승인 exit=$EA · 취소 exit=$EC)"

  STATUS=$("${P[@]}" -c "select status from core.approval_request where approval_id = '$AP'")
  REV_STATUS=$("${P[@]}" -c "select status from core.item_policy_revision where revision_id = '$REV'")
  expect_equal "$STATUS/$REV_STATUS" "$STATUS/$STATUS" "C1 라운드 $round 승인 상태와 변경안 상태가 같다"

  # 3) 진 쪽은 40P01이 아니라 한국어 업무 오류로 거절돼야 한다.
  if [ "$EA" -eq 0 ]; then
    APPROVE_WINS=$((APPROVE_WINS + 1))
    if grep -qE '대기 중인 변경안만 취소할 수 있습니다|이미 처리되었거나 취소된 승인 요청입니다' "$LOG_DIR/c1-cancel-$round.log"; then
      echo "PASS: C1 라운드 $round 승인이 이김 — 취소는 업무 오류로 거절"
    else
      echo "FAIL: C1 라운드 $round 승인이 이겼는데 취소 오류 문구가 업무 오류가 아니다 ($(tail -2 "$LOG_DIR/c1-cancel-$round.log" | tr '\n' ' '))"
      FAILURES=$((FAILURES + 1))
    fi
  else
    CANCEL_WINS=$((CANCEL_WINS + 1))
    if grep -qE '이미 처리되었거나 취소된 승인 요청입니다' "$LOG_DIR/c1-approve-$round.log"; then
      echo "PASS: C1 라운드 $round 취소가 이김 — 승인은 업무 오류로 거절"
    else
      echo "FAIL: C1 라운드 $round 취소가 이겼는데 승인 오류 문구가 업무 오류가 아니다 ($(tail -2 "$LOG_DIR/c1-approve-$round.log" | tr '\n' ' '))"
      FAILURES=$((FAILURES + 1))
    fi
  fi

  # 4) 운영값은 승인된 경우에만 바뀐다(취소가 이기면 그대로다).
  if [ "$STATUS" = 'APPROVED' ]; then
    check "(select target_dos_days = $((29 + round)) from core.item_policy where item_id = '$ITEM')" \
      "C1 라운드 $round 승인이면 운영값이 반영된다"
  else
    check "(select coalesce(target_dos_days, -1) <> $((29 + round)) from core.item_policy where item_id = '$ITEM')" \
      "C1 라운드 $round 취소면 운영값이 바뀌지 않는다"
  fi

  # 5) 어느 쪽이 이기든 팀장 반복 알림(APPROVAL_PENDING)은 멈춰야 한다.
  check "(select count(*) = 0 from core.notification_outbox where template_code = 'APPROVAL_PENDING' and payload ->> 'approval_id' = '$AP' and status not in ('CANCELLED', 'SENT'))" \
    "C1 라운드 $round 결정·취소 뒤 대기 반복 알림이 남지 않는다"
done

echo "C1 결과 요약: 승인이 이김 ${APPROVE_WINS}회 · 취소가 이김 ${CANCEL_WINS}회 (교착 0회)"

if [ "$FAILURES" -ne 0 ]; then
  echo "동시성 검증 실패: ${FAILURES}건"
  exit 1
fi
