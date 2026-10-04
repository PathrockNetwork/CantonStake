#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_dir"

echo "Validating frontend TypeScript once..."
npm --prefix frontend run typecheck

export SKIP_FRONTEND_BUILD_CHECKS=true

# Production shares this host with Canton. Serial builds keep both Next.js
# compiler trees from competing with the live participant for memory.
if [[ "${FRONTEND_BUILD_PARALLEL:-false}" != "true" ]]; then
  echo "Building frontend images serially (testnet, then mainnet)..."
  docker compose -p cantonstake-testnet --env-file .env --env-file .env.testnet build frontend
  docker compose -p cantonstake --env-file .env build frontend
  echo "Built cantonstake-frontend:testnet and cantonstake-frontend:local."
  exit 0
fi

echo "Building frontend images in parallel (explicit opt-in)..."

docker compose -p cantonstake --env-file .env build frontend &
mainnet_pid=$!
docker compose -p cantonstake-testnet --env-file .env --env-file .env.testnet build frontend &
testnet_pid=$!

cleanup() {
  kill "$mainnet_pid" "$testnet_pid" 2>/dev/null || true
}
trap cleanup INT TERM

mainnet_status=0
testnet_status=0
wait "$mainnet_pid" || mainnet_status=$?
wait "$testnet_pid" || testnet_status=$?
trap - INT TERM

if (( mainnet_status != 0 || testnet_status != 0 )); then
  echo "Frontend build failed (mainnet=$mainnet_status, testnet=$testnet_status)." >&2
  exit 1
fi

echo "Built cantonstake-frontend:local and cantonstake-frontend:testnet."
