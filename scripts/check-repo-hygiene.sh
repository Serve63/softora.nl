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

local_artifacts=()

if [ -d ".vercel/output" ]; then
  local_artifacts+=(".vercel/output")
fi

while IFS= read -r -d '' artifact; do
  local_artifacts+=("$artifact")
done < <(
  find . \
    -path './.git' -prune -o \
    -path './node_modules' -prune -o \
    -path './backups' -prune -o \
    \( \
      -name '.DS_Store' -o \
      -name '*.tmp' -o \
      -name '*.bak' -o \
      -name '*.orig' -o \
      -name '*.log' -o \
      -name '*~' \
    \) -print0
)

if [ "${#local_artifacts[@]}" -gt 0 ]; then
  printf '[repo-hygiene] Local artifacts found. Run npm run clean:local:\n'
  printf ' - %s\n' "${local_artifacts[@]}"
  exit 1
fi

echo "[repo-hygiene] No machine-specific repo path references found."
