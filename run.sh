#!/usr/bin/env bash
# acme-health — run the generated demo.
#
# Usage: ./run.sh          # start the backend on :$PORT (default 8080)
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
export PORT="${PORT:-8080}"

if ! command -v node >/dev/null 2>&1; then
  echo "This project needs Node 18.17+. Install: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ">> installing deps"
  npm install --silent
fi

echo ">> starting backend on :$PORT (Ctrl-C to stop)"
# One or more UIs run alongside the backend — background the backend and each
# UI, then wait on all of them so Ctrl-C tears everything down together.
npm run dev &
PIDS=$!
trap 'kill $PIDS 2>/dev/null || true' EXIT
export FRONTEND_PORT="${FRONTEND_PORT:-5174}"
echo ">> starting demo UI on :$FRONTEND_PORT"
(cd frontend && npm install --silent && npm run dev) &
PIDS="$PIDS $!"
export WALLBOARD_PORT="${WALLBOARD_PORT:-5175}"
echo ">> starting wallboard on :$WALLBOARD_PORT"
(cd wallboard && npm install --silent && npm run dev) &
PIDS="$PIDS $!"
wait
