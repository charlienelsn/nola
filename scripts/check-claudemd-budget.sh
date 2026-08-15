#!/usr/bin/env bash
# CLAUDE.md line budget (codify hard limit): prose guidance must stay small
# enough to actually be read. When it grows past the budget, rules should
# graduate to mechanical enforcement (hooks/CI/lint/types), not accumulate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIMIT=150
LINES="$(wc -l < "$ROOT/CLAUDE.md" | tr -d '[:space:]')"

if [ "$LINES" -gt "$LIMIT" ]; then
  echo "CLAUDE.md budget exceeded: $LINES lines (limit $LIMIT)."
  echo "Graduate prose rules to hooks/CI/types instead of adding lines."
  exit 1
fi

echo "CLAUDE.md budget OK: $LINES/$LIMIT lines."
