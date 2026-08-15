#!/usr/bin/env bash
# SessionStart hook: if codify work is queued and no agent is running, spawn
# scripts/codify-agent.sh fully detached and exit immediately. This hook must
# never block session start — it does no queue processing itself.

# Recursion guard: headless codify runs export NOLA_CODIFY=1; their session
# start must not spawn another agent.
[ -n "${NOLA_CODIFY:-}" ] && exit 0

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
QUEUE="$ROOT/.claude/codify-queue"
LOCK="$ROOT/.claude/codify.lock"
LOG="$ROOT/.claude/codify.log"
AGENT="$ROOT/scripts/codify-agent.sh"

# Nothing queued -> nothing to do.
[ -s "$QUEUE" ] || exit 0

# Stale-lock recovery: the agent removes its lock via an EXIT trap, but traps
# don't survive kill -9 or a machine crash. The lock stores the agent's PID;
# a dead PID means the lock is stale and safe to reclaim.
if [ -e "$LOCK" ]; then
  LOCK_PID="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    exit 0
  fi
  rm -f "$LOCK"
fi

# Atomic lock creation via noclobber: when several sessions start at once,
# exactly one wins the right to spawn the agent.
if ! (set -o noclobber; : > "$LOCK") 2>/dev/null; then
  exit 0
fi

nohup bash "$AGENT" >> "$LOG" 2>&1 &
AGENT_PID=$!
printf '%s\n' "$AGENT_PID" > "$LOCK"
disown "$AGENT_PID" 2>/dev/null || true

exit 0
