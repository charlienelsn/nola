#!/usr/bin/env bash
# SessionEnd hook: enqueue this session's transcript for the codify agent.
# Instant and side-effect-only: parse stdin JSON, append one line to the
# queue. No network, no model calls, no claude invocations here — the heavy
# lifting happens later in scripts/codify-agent.sh.
#
# Queue line format (tab-separated): transcript_path  session_id  utc_timestamp

# Recursion guard: headless codify runs export NOLA_CODIFY=1; their sessions
# must never enqueue themselves.
[ -n "${NOLA_CODIFY:-}" ] && exit 0

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUEUE="$ROOT/.claude/codify-queue"

INPUT="$(cat 2>/dev/null || true)"
[ -z "$INPUT" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  FIELDS="$(printf '%s' "$INPUT" | jq -r '[.transcript_path // "", .session_id // ""] | @tsv' 2>/dev/null || true)"
else
  FIELDS="$(printf '%s' "$INPUT" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(d.get("transcript_path", "") + "\t" + d.get("session_id", ""))
' 2>/dev/null || true)"
fi

TRANSCRIPT="$(printf '%s' "$FIELDS" | cut -f1)"
SESSION_ID="$(printf '%s' "$FIELDS" | cut -f2)"

# Nothing to enqueue if we couldn't parse a transcript path or it's gone.
if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

printf '%s\t%s\t%s\n' \
  "$TRANSCRIPT" \
  "${SESSION_ID:-unknown}" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$QUEUE"

exit 0
