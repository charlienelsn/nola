#!/usr/bin/env bash
# Terminology rule (plan section 2): the people Nola serves are members.
# "patient" is banned from Nola-authored code, UI copy, prompts, and schemas.
# Incoming source documents are evidence and exempt; fixture dirs are exempt.
set -euo pipefail
MATCHES=$(grep -rniE '\bpatients?\b' \
  frontend/src api/src brain/src shared/src evals/src evals/elicitation \
  workflows supabase/migrations \
  --exclude-dir=node_modules \
  --exclude-dir=fixtures \
  --exclude-dir=goldens \
  2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  echo "Terminology violation: 'patient' found in Nola-authored code."
  echo "$MATCHES"
  exit 1
fi
echo "Terminology check passed: members only."
