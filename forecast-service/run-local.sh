#!/usr/bin/env bash
# 예측 서비스를 이 Mac 에서 켭니다 (Docker 없이).
#   1) cp .env.example .env  →  DATABASE_URL · SERVICE_TOKEN 두 줄만 채웁니다
#   2) ./run-local.sh
# 끄려면 이 창에서 Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then
  echo ".env 가 없습니다. 먼저:  cp .env.example .env  하고 DATABASE_URL · SERVICE_TOKEN 을 채우세요." >&2
  exit 1
fi
set -a; . ./.env; set +a
if [[ "${DATABASE_URL:-}" == *"PASSWORD"* || -z "${DATABASE_URL:-}" ]]; then
  echo ".env 의 DATABASE_URL 에 실제 비밀번호를 넣어야 합니다." >&2; exit 1
fi
if [[ -z "${SERVICE_TOKEN:-}" || "${SERVICE_TOKEN}" == "change-me" ]]; then
  echo ".env 의 SERVICE_TOKEN 을 임의의 긴 문자열로 바꾸세요 (앱 .env.local 의 FORECAST_SERVICE_TOKEN 과 같게)." >&2; exit 1
fi
[[ -x .venv/bin/uvicorn ]] || { echo ".venv 가 없습니다:  python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2; exit 1; }
echo "예측 서비스를 http://localhost:${PORT:-8000} 에 켭니다. 확인: curl localhost:${PORT:-8000}/health"
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
