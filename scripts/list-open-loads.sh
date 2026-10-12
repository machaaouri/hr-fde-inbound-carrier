#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a
exec "$ROOT/bridge/node_modules/.bin/tsx" "$ROOT/scripts/list-open-loads.ts"
