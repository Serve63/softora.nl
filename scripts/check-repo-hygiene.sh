#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

patterns=(
  'softora\.nl-12'
  '/Users/servecreusen/'
)

targets=(
  AGENTS.md
  README.md
  docs
  server
  api
  scripts
  test
)

for pattern in "${patterns[@]}"; do
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude='check-repo-hygiene.sh' \
    --exclude='package-lock.json' \
    "$pattern" \
    "${targets[@]}"; then
    echo
    echo "[repo-hygiene] Found disallowed path pattern: $pattern"
    exit 1
  fi
done

echo "[repo-hygiene] No machine-specific repo path references found."
