#!/usr/bin/env bash
# Runs every headless test file; stops at the first failing one.
#   bash scripts/test-all.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
tsx="$here/node_modules/.bin/tsx"
for t in notes timeline demo-try codec reconcile backups setdata session; do
  "$tsx" "$here/test/$t.test.ts" | tail -n 1 | sed "s/^/$t: /"
done
