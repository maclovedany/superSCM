#!/usr/bin/env bash
# 배포 Supabase 의 정의만 내보냅니다 (데이터 제외).
#
# 쓰는 법
#   ./scripts/dump-schema.sh
#   비밀번호를 물어봅니다 — 셸 기록에 남지 않습니다.
#
# ★ supabase db dump 는 pg_dump 를 Docker 로 돌립니다. Docker 없이 로컬 pg_dump 를 씁니다.
# ★ Transaction pooler(6543) 는 pg_dump 를 지원하지 않습니다. Session pooler(5432) 여야 합니다.
# ★ 비밀번호를 이 파일이나 명령줄에 적지 마세요. -W 가 물어봅니다.

set -euo pipefail

HOST="${SUPABASE_DB_HOST:-aws-0-ap-southeast-2.pooler.supabase.com}"
PORT="${SUPABASE_DB_PORT:-5432}"
DBUSER="${SUPABASE_DB_USER:-postgres.jjyxvafsbawtjwnrpzfp}"
DBNAME="${SUPABASE_DB_NAME:-postgres}"
OUT="supabase/schema-dump/$(date +%Y-%m-%d).sql"

PGDUMP=/opt/homebrew/bin/pg_dump
[ -x "$PGDUMP" ] || PGDUMP="$(command -v pg_dump)"
[ -n "$PGDUMP" ] || { echo "pg_dump 를 찾지 못했습니다"; exit 1; }

mkdir -p "$(dirname "$OUT")"

echo "→ ${DBUSER}@${HOST}:${PORT} 에서 정의를 내보냅니다 (데이터 제외)"
"$PGDUMP" \
  --host="$HOST" --port="$PORT" --username="$DBUSER" --dbname="$DBNAME" \
  --schema-only --no-owner \
  --schema=raw --schema=core --schema=analytics --schema=public \
  --file="$OUT" \
  -W

echo "→ 저장 완료: $OUT"
wc -l "$OUT"
echo "  CREATE 문 $(grep -c '^CREATE' "$OUT")개"
