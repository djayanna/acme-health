#!/usr/bin/env bash
# acme-health — run the generated demo.
#
# Usage: ./run.sh          # start the backend on :$PORT (default 8080) + the wallboard
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
export PORT="${PORT:-8080}"

# Twilio Agent Connect needs Node 22.13+.
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  echo "This project needs Node 22.13+ (found: $(node --version 2>/dev/null || echo none))."
  echo "Install: https://nodejs.org  — or with nvm: nvm install 22 && nvm use 22"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ">> installing deps"
  npm install --silent
fi

# better-sqlite3 is a native module: it only loads on the Node version it was built
# for. Rebuild it if node_modules was installed under a different Node.
if ! node -e "require('better-sqlite3')" 2>/dev/null; then
  echo ">> rebuilding better-sqlite3 for Node $(node --version)"
  npm rebuild better-sqlite3 --silent
fi

echo ">> starting backend on :$PORT (Ctrl-C to stop)"
# The wallboard runs alongside the backend — background both, then wait on them so
# Ctrl-C tears everything down together.
npm run dev &
PIDS=$!
trap 'kill $PIDS 2>/dev/null || true' EXIT
export WALLBOARD_PORT="${WALLBOARD_PORT:-5175}"
echo ">> starting wallboard on :$WALLBOARD_PORT"
(cd wallboard && npm install --silent && npm run dev) &
PIDS="$PIDS $!"
wait
