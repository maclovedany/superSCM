# supabase/tests/sales_order_allocation 공통 설정 — 로컬 PostgreSQL 임시 DB에서만 실행한다.
#
# 접속 정보(비밀번호 · 접속 문자열)를 이 폴더에 두지 않는다. 기본값은 유닉스 소켓 /tmp:5432이며
# PGHOST · PGPORT로만 바꿀 수 있다. 원격 호스트를 가리키면 실행 전에 거절한다.

export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-5432}"

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
