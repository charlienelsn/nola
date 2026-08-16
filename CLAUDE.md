# CLAUDE.md — Nola

Nola is an AI-native care service. This repo is the internal operating
environment for Nola's own care-management team. Full strategy lives in the
Build Strategy & Technical Plan (Drive); decisions live in `docs/decisions.md`.

## Rules that never change

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
   wrong-member write, a fabricated source link. Major: a wrong non-medication
   fact verified, a missed contradiction, a dropped task. Minor: formatting,
   phrasing, ranking quality. Any critical error automatically demotes the
   workflow to L1.
5. **The medication ceiling.** Medication-related change types never exceed
   L1 (every proposal human-reviewed) this year, regardless of eval scores.

## Repo map

- `frontend/` — care-manager UI (React, Vite, Tailwind)
- `api/` — contract endpoints (Fastify); pg-boss jobs run in this process
- `brain/` — the Case Brain. Founder-owned. Core loop: classify → assemble
  whole-member context → extract against workflow schema → deterministic
  validation → route (quiet / prepared / judgment)
- `workflows/` — one typed module per workflow (`WorkflowDefinition`)
- `evals/` — golden cases and regression runner
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
  Current state is a derived view. A proposed fact never overwrites a
  verified fact.
- Every model call logs a trace (prompt ref, context refs, output, tokens,
  latency, cost) to the `traces` table, OpenTelemetry GenAI format.
- Workflow-specific logic lives only in `workflows/<name>/` (hard rule from
  week 4 on). Schemas and validation require founder review — see CODEOWNERS.
- PRs: what changed, eval delta, screenshot. Small and daily beats large and
  weekly.

## Codification

Codification is autonomous via SessionEnd→queue→PR; merge gate is human. Manual: /codify.

## Mistakes log

Append entries here whenever an agent gets something wrong, so the next
session does not repeat it.

- `supabase db reset` fails mid-recreate ("connection reset by peer") if the
  dev API holds open DB connections — stop `pnpm dev` before `pnpm reset`.
  Also: piping a command through `tail` masks its exit code; the failure went
  unnoticed for a full cycle.
