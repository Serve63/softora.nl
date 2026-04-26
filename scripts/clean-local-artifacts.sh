#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

artifacts=()

if [ -d ".vercel/output" ]; then
  artifacts+=(".vercel/output")
fi

while IFS= read -r -d '' artifact; do
  artifacts+=("$artifact")
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

if [ "${#artifacts[@]}" -eq 0 ]; then
  echo "[clean-local] Geen lokale rommel gevonden."
  exit 0
fi

printf '[clean-local] Verwijdert lokale rommel:\n'
printf ' - %s\n' "${artifacts[@]}"
rm -rf -- "${artifacts[@]}"
echo "[clean-local] Werkmap is lokaal opgeschoond."
