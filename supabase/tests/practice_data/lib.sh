# supabase/tests/practice_data 공통 설정 — 로컬 PostgreSQL 임시 DB에서만 실행한다.
# (supabase/tests/item_policy · master_edit와 같은 구조 — 이 파일은 그대로 복제했다)
#
# 접속 정보(비밀번호 · 접속 문자열)를 이 폴더에 두지 않는다. 기본값은 유닉스 소켓 /tmp:5432이며
# PGHOST · PGPORT로만 바꿀 수 있다. 원격 호스트를 가리키면 실행 전에 거절한다.

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5432}"

# 세션 timezone에 따라 날짜↔timestamptz 변환이 달라지는 버그를 개발자 로컬 클러스터(기본
# Asia/Seoul)가 우연히 가리는 일이 있었다(Task 7 fix round 1). 이 스위트는 항상 명시적인 세션
# timezone에서 돈다 — 기본은 UTC(대부분의 배포 환경과 같다).
export PGOPTIONS="${PGOPTIONS:--c timezone=UTC}"

require_local_target() {
  local db="$1"
  case "$db" in
    scm_test_*) ;;
    *) echo "거절: 검증 DB 이름은 scm_test_로 시작해야 합니다 ($db)." >&2; exit 2 ;;
  esac
  case "$PGHOST" in
    /*|localhost|127.0.0.1|::1) ;;
    *) echo "거절: 로컬 PostgreSQL(유닉스 소켓 디렉터리 또는 localhost)에서만 실행합니다 (PGHOST=$PGHOST)." >&2; exit 2 ;;
  esac
  if [ -n "${PGHOSTADDR:-}" ] || [ -n "${PGSERVICE:-}" ]; then
    echo "거절: PGHOSTADDR 또는 PGSERVICE가 설정된 셸에서는 실행하지 않습니다(원격 접속 우회 방지)." >&2
    exit 2
  fi
}
