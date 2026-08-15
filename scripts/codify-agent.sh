#!/usr/bin/env bash
# Codify worker: drains .claude/codify-queue, pre-filters each transcript
# cheaply (no model), and invokes a headless claude codifier for survivors.
# Spawned detached by .claude/hooks/drain-codify-queue.sh; also safe to run
# by hand.
#
# Env:
#   NOLA_CODIFY_DRY_RUN=1   run everything except the model call; log what
#                           would have run and the branch it would create
#   NOLA_CODIFY_MODEL       model for the headless run (default: sonnet)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE="$ROOT/.claude/codify-queue"
LOCK="$ROOT/.claude/codify.lock"
LOG="$ROOT/.claude/codify.log"
PROMPT_FILE="$ROOT/scripts/codify-prompt.md"
MODEL="${NOLA_CODIFY_MODEL:-sonnet}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }

# Take over the lock created by the drain hook (or create it when run by
# hand). If another live agent holds it, leave quietly.
if [ -e "$LOCK" ]; then
  LOCK_PID="$(cat "$LOCK" 2>/dev/null || true)"
  if [ -n "$LOCK_PID" ] && [ "$LOCK_PID" != "$$" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    log "another codify agent (pid $LOCK_PID) is running; exiting"
    exit 0
  fi
fi
printf '%s\n' "$$" > "$LOCK"
# Whatever happens below, never leave a stale lock behind.
trap 'rm -f "$LOCK"' EXIT

cd "$ROOT"

# Correction signals for the pre-filter (case-insensitive; "don'?t" also
# matches transcripts where the apostrophe was dropped).
SIGNALS="no,|wrong|don'?t|not what|actually|instead|revert|undo|stop"

SKIPPED=0
INVOKED=0
FAILED=0

while [ -s "$QUEUE" ]; do
  ENTRY="$(head -n 1 "$QUEUE")"
  # Dequeue before processing: an entry that crashes the agent must not
  # wedge the queue forever (at-most-once beats a permanent stall here).
  tail -n +2 "$QUEUE" > "$QUEUE.tmp" && mv "$QUEUE.tmp" "$QUEUE"
  [ -z "$ENTRY" ] && continue

  TPATH="$(printf '%s' "$ENTRY" | cut -f1)"
  SID="$(printf '%s' "$ENTRY" | cut -f2)"
  TS="$(printf '%s' "$ENTRY" | cut -f3)"

  if [ ! -f "$TPATH" ]; then
    log "skip $SID: transcript missing ($TPATH)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # PRE-FILTER (cheap, no model). A transcript survives only if it has >=5
  # real user turns AND user messages contain correction signals. User turns
  # are "type":"user" entries whose content is a string or contains text
  # blocks — this excludes tool_result entries, which arrive as user role.
  TURNS="$(jq -rs '
    [ .[]
      | select(.type == "user")
      | .message.content
      | if type == "string" then "x"
        elif ([.[]? | select(.type? == "text")] | length) > 0 then "x"
        else empty
        end
    ] | length
  ' "$TPATH" 2>/dev/null || echo 0)"

  if [ "${TURNS:-0}" -lt 5 ]; then
    log "skip $SID: only ${TURNS:-0} user turns (<5)"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  USER_TEXT="$(jq -r '
    select(.type == "user")
    | .message.content
    | if type == "string" then .
      else ([.[]? | select(.type? == "text") | .text] | join(" "))
      end
  ' "$TPATH" 2>/dev/null || true)"

  if ! printf '%s' "$USER_TEXT" | grep -Eiq "$SIGNALS"; then
    log "skip $SID: no correction signals in user messages"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  SHORT_SID="$(printf '%s' "$SID" | tr -cd 'a-zA-Z0-9' | cut -c1-8)"
  BRANCH="codify/$(date -u +%Y-%m-%d)-${SHORT_SID:-unknown}"

  CODIFY_PROMPT="$(cat "$PROMPT_FILE")

---
Autonomous run context (provided by scripts/codify-agent.sh):
- Transcript path: $TPATH
- Session id: $SID
- Session ended: $TS
- If findings meet the bar, use exactly this branch name: $BRANCH"

  # Headless codifier. --tools limits the built-in toolset; --allowedTools
  # auto-approves only what the job needs (in -p mode everything else is
  # denied, not prompted). CLAUDECODE must be unset or claude refuses to
  # start from inside a session-spawned process tree; NOLA_CODIFY=1 makes
  # the codifier session's own hooks exit immediately (no self-enqueue).
  CMD=(claude -p
    --model "$MODEL"
    --permission-mode default
    --tools "Bash,Read,Grep,Glob,Edit,Write"
    --allowedTools
    "Read" "Grep" "Glob" "Edit" "Write"
    "Bash(git status:*)" "Bash(git log:*)" "Bash(git diff:*)"
    "Bash(git rev-parse:*)" "Bash(git branch:*)" "Bash(git switch:*)"
    "Bash(git checkout:*)" "Bash(git add:*)" "Bash(git commit:*)"
    "Bash(git push:*)" "Bash(gh pr create:*)"
    "Bash(bash scripts/check-claudemd-budget.sh)" "Bash(pnpm check:*)"
    --max-turns 50
    --no-session-persistence
    --output-format text)

  if [ -n "${NOLA_CODIFY_DRY_RUN:-}" ]; then
    log "DRY RUN $SID: pre-filter passed ($TURNS user turns, correction signals found)"
    log "DRY RUN $SID: would create branch $BRANCH"
    log "DRY RUN $SID: would run: env -u CLAUDECODE NOLA_CODIFY=1 ${CMD[*]} '<scripts/codify-prompt.md + run context>'"
    INVOKED=$((INVOKED + 1))
    continue
  fi

  log "invoke $SID: $TURNS user turns, signals found; branch $BRANCH; model $MODEL"
  if env -u CLAUDECODE NOLA_CODIFY=1 "${CMD[@]}" "$CODIFY_PROMPT" >> "$LOG" 2>&1; then
    log "done $SID"
    INVOKED=$((INVOKED + 1))
  else
    log "FAILED $SID: headless claude exited non-zero (entry stays dequeued)"
    FAILED=$((FAILED + 1))
  fi
done

log "run complete: $SKIPPED skipped, $INVOKED invoked, $FAILED failed"
