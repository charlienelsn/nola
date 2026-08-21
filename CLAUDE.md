# CLAUDE.md — Nola

Nola is an AI-native care service. This repo is the internal operating
environment for Nola's own care-management team. Full strategy lives in the
Build Strategy & Technical Plan (Drive); decisions live in `docs/decisions.md`.

## Requirements — never deleted

These encode what care management demands, independent of model capability.

1. **Members, never "patient."** The people Nola serves are members — in every
   schema, API path, screen, prompt, and eval case. Incoming source documents
   (discharge summaries, referrals) will say "patient"; that text is evidence,
   retained verbatim in fixtures/goldens, and mapped to the member record at
   ingestion. CI greps Nola-authored code and fails on violations.
2. **No real member data. Ever.** Synthetic data only, in every environment,
   until the clinical entity exists and counsel signs off. "Production" does
   not exist this year.
3. **The evidence firewall.** Shadowing notes, transcripts, and recordings may
   contain real protected information. None of it enters this repo, the golden
   cases, or any prompt. Goldens are written fresh as synthetic cases inspired
   by observed patterns.
4. **The severity rubric.** Critical: a wrong medication fact verified, a
   wrong-member write, a fabricated source link, a billable minute recorded
   for work that did not occur, a duplicate charge against the same member
   and calendar month, a billing code present with no clinician source, an
   attestation recorded with no corresponding clinician act. Major: a wrong
   non-medication fact verified, a missed contradiction, a dropped task.
   Minor: formatting, phrasing, ranking quality. Any critical error
   automatically demotes the workflow to L1.
5. **The ceilings.** Three change types are capped by judgment, not
   measurement; they never move with eval scores. Medication-related change
   types never exceed L1 (every proposal human-reviewed) this year. Billing
   codes are clinician-authored: Nola completes a care plan against codes a
   clinician assigned and never proposes, infers, invents, or extends one —
   if a code is absent, the correct output is to say so, never to supply
   one. Attestations are clinician acts: Nola never records that a clinician
   examined, reviewed, or verified anything unless the clinician did it and
   the record shows when. (Field basis: decision 21.)
6. **Provenance on everything.** Every member fact carries its source event,
   verifier, and validity interval; every proposal cites the document that
   produced it. A fabricated source link is a critical (requirement 4).
7. **Proposed never overwrites verified.** New evidence supersedes a
   verified fact only after human verification; until then it stays a
   proposal.
8. **No threshold display in-period.** Never show distance-to-threshold
   during an open billing period: no "8 minutes to billable," no progress
   bars toward a time floor, no work queue sorted by threshold proximity.
   Missed thresholds surface only after the period closes, as a staffing
   and panel-design signal. A visible threshold becomes a target and the
   pressure to find the missing minutes is structural; rounded or repeated
   durations are a named audit flag, and OIG added chronic care management
   to its 2026 Work Plan.
9. **Time capture is first-class.** Every event carries actor, timestamp,
   duration, activity description, and member link. A duration with no
   description of the work is not audit-evidence and does not survive a
   records request. Capture completeness is a measured property with its
   own eval dimension, not a passive byproduct of the events table.

## Patches — deletable per model release

None yet. Every patch added to any prompt or to this file must cite the eval
failure it fixes. On each major model release, run the ablation ritual: strip
patches, run the golden suite, re-baseline. Re-add an instruction only after
the model repeatedly stumbles.

## Repo map

- `frontend/` — care-manager UI (React, Vite, Tailwind)
- `api/` — contract endpoints (Fastify); pg-boss jobs run in this process
- `brain/` — the Case Brain. Founder-owned. Core loop: classify → assemble
  whole-member context → extract against workflow schema → deterministic
  validation → route (quiet / prepared / judgment)
- `workflows/` — one typed module per workflow (`WorkflowDefinition`)
- `evals/` — golden cases, regression runner, and standing elicitation tests
  (`evals/elicitation/`, run by hand per major model release)
- `shared/` — member ontology + API contract types. Founder-owned
- `docs/decisions.md` — why things are the way they are; read before proposing
  architecture changes

## Commands

- `pnpm dev` — frontend (5173) + API (3001)
- `pnpm typecheck` / `pnpm lint` / `pnpm test`
- `pnpm check:terminology` — the member-terminology grep
- `supabase start` — local stack (API 54341, DB 54342, Studio 54343; nonstandard ports to coexist with other local stacks)
- `supabase stop` — stop the local stack
- `pnpm seed` — deterministic synthetic members (wipes seeded tables, re-inserts; same output every run)
- `pnpm reset` — rebuild schema via `supabase db reset`, then seed

## Conventions

- TypeScript strict everywhere; Biome for lint/format; Zod at every model and
  API boundary.
- Direct Anthropic SDK in the Brain. No runtime agent frameworks. Claude Agent
  SDK only for side jobs (synthetic data generation, eval triage).
- Facts, not blobs: member state is rows in `member_facts` with status
  proposed → verified → superseded/retracted, provenance, validity intervals.
  Current state is a derived view (requirements 6–7 govern writes).
- Task modes: cook mode (task + guardrails + exit criteria, run long) for
  anything with mechanical verification — tests, builds, goldens. Read mode
  (small slices, founder reads every line) for `brain/`, `shared/`, and
  workflow schemas.
- The Brain's model-call module must support a `MINIMAL_PROMPT` flag that
  strips all non-requirement instructions, so ablation is a one-flag eval
  run.
- Every model call logs a trace (prompt ref, context refs, output, tokens,
  latency, cost) to the `traces` table, OpenTelemetry GenAI format.
- Workflow-specific logic lives only in `workflows/<name>/` (hard rule from
  week 4 on). Schemas and validation require founder review — see CODEOWNERS.
- PRs: what changed, eval delta, screenshot. Small and daily beats large and
  weekly.

## Codification

Codification runs as a nightly platform routine (decision 18) using
`scripts/codify-prompt.md`; it opens `codify:` PRs and the merge gate is
human. Manual: /codify.

## Mistakes log

Append entries here whenever an agent gets something wrong, so the next
session does not repeat it. Entries are patches, never requirements — the
deletion pass (decision 17) and the codifier's month-old pruning apply.

- `supabase db reset` fails mid-recreate ("connection reset by peer") if the
  dev API holds open DB connections — stop `pnpm dev` before `pnpm reset`.
  Also: piping a command through `tail` masks its exit code; the failure went
  unnoticed for a full cycle.
- A workflow schema's extraction-rule doc-comments can read correctly against
  the golden that inspired them and still silently contradict another golden
  (e.g. a rule stated as "the action was completed" vs. the goldens' real
  boundary of "who was responsible for the action") — the goldens cross-check
  only grades each golden against its own expected values, so it won't catch
  this. Before trusting a doc-comment's wording, check it against every
  golden that touches that field, not just the one that motivated it.
- A new field added to a workflow's extraction schema needs matching coverage
  in the eval scorer in the same change. A typed-but-unscored field parses
  and validates fine, so the gap stays invisible until a real run drops that
  field's data — silently defeating requirement 4's "dropped task is major."
- A headless codify run left an untracked CI-check script built on a false
  premise: it read a branch's real Claude-Session commit trailers as an
  unreplaced "template placeholder" and would have failed every legitimate
  branch. Verify an agent-authored guard's premise against git history
  before wiring it in — and never adopt work-tree files you can't attribute.
- Render identifiers in the exact shape the model must echo them: the
  entity/attribute slash-join mis-keyed every found contradiction (2026-08-21
  baseline); run.ts guard 4 now validates citations against the fact rows.
- Check the matcher before trusting an eval FAIL — substring matching graded
  nine correct outputs as dropped; pick golden phrases the output necessarily contains.
