# Nola — Fall 2026 Build Strategy & Technical Plan

Working document · August 2026

> **Core idea:** Build the parts of Nola that compound with every member and every practitioner correction. Buy commodity infrastructure. Defer anything that does not help prove the next hypothesis.

---

## 1. Executive summary

Nola is an AI-native care service, not another piece of case-management SaaS. The company owns its care-management workforce and uses proprietary software to make that workforce dramatically more capable, calm, and productive.

The core technical asset is the **Case Brain**: a longitudinal, source-grounded representation of each member that turns calls, documents, referrals, EHR events, and human actions into structured, provenance-carrying facts, next steps, and evidence. The care-manager experience shows the human only what needs the human: routine work is quietly handled, prepared work is batched for lightweight review, and uncertainty or consequential decisions are escalated.

Billing does not come last. Nola models billing evidence and financial state from the first line of schema, even though production claims submission waits until the clinical and legal organization exists.

The Fall 2026 engineering strategy is a **workflow factory, extracted rather than designed**. The first workflow is built completely and concretely; the second is built by deliberate duplication; the factory — a generic event-to-proposal loop, a generic review surface, an eval harness, and a workflow registry — is then extracted from the repetition that actually exists. From that point, new workflows ship weekly from one-page specs, each starting fully supervised and earning autonomy through measured accuracy. The December target is a portfolio with a deliberate shape: **two workflows deep** (measured time savings, accuracy, and reviewer vigilance) and **six or more wide** (proving the factory stamps new workflows cheaply), tested with a care manager on synthetic caseloads. That evidence is the fundraise.

Columbia Build Lab provides parallel capacity on product surfaces and tooling. The founder stays on the critical path for the Case Brain and the factory; no CBL dependency can stop core progress.

In the 2026 technical landscape, code is cheap. Founder attention, domain context, practitioner feedback, ontology decisions, and eval loops are scarce. Every choice in this document reflects that.

> **Operating principle:** Build what becomes smarter, more differentiated, or more operationally advantaged every time Nola cares for a member. Buy the rails. Defer everything else. Vendors get the plumbing, never the memory.

---

## 2. Product thesis and experience

Nola is an AI-native service company. It owns the human care-management layer rather than selling software to care managers. The product is Nola's internal operating environment for its own team. External systems — EHRs, referral networks such as Unite Us, claims infrastructure, telephony, resource directories — become integrations behind Nola rather than places the worker has to live.

**Terminology:** the people Nola serves are **members**, in every schema, API path, screen, prompt, and eval case. Incoming source documents from hospitals and payers will say "patient." That text is evidence, retained verbatim; the ingestion layer maps it to the member record, and Nola's own language never uses the word. A CI check enforces this.

> **The experience principle: show the human only what needs the human.** The care manager manages the member, not the AI. Routine administrative certainty happens quietly. Nola prepares work when review is appropriate. Nola pauses when evidence conflicts or judgment is needed.

### The three operating modes

| Mode | When | Examples |
| --- | --- | --- |
| Quietly handled | Low-risk, reversible, administrative work | Organize a document; check a referral status; update a non-authoritative timeline; create a reminder |
| Prepared for you | Work that benefits from automation but should be verified before an authoritative or consequential change | Draft note; proposed care-plan update; billing evidence packet; external submission draft |
| Needs your judgment | Material ambiguity, conflict, or clinical / operational judgment | Two medication sources conflict; a member statement is unclear; an escalation threshold is reached; a program exception is needed |

These modes are what the care manager sees. The mechanism that decides which mode a given piece of work lands in is the autonomy ladder (Section 12): every workflow starts fully supervised and earns quieter behavior through measured accuracy and reviewer vigilance.

### Navigation

Today (what needs me) · Members (who am I caring for) · Work (what requires completion or review) · Inbox (what incoming communication still needs human attention). Inside a member: Overview, Care Plan, Tasks, Timeline, Files. A contextual command bar ("Ask about Marsha or take an action…") is always available, and normal controls stay normal: a care manager can always add a note, create a task, upload a file, or start a referral directly.

---

## 3. The Case Brain

**The core rule: AI interprets; the database remembers.** Nola never relies on a model's conversational memory as the source of truth. The model is stateless relative to the member; authorized member context is assembled from persistent structured facts, original evidence, and event history.

### The facts table is the Brain

Member state is not one JSON document. It is a set of individually sourced facts:

```
member_facts(
  member_id, entity, attribute, value,
  status: proposed | verified | superseded | retracted,
  source_event_id, confidence,
  verified_by, verified_at,
  valid_from, valid_to, invalidated_by
)
```

Three properties fall out of this shape rather than being enforced in code. **Update safety:** proposed facts can never overwrite verified facts, because they are different rows. **Contradiction detection:** two facts with the same entity and attribute but different values, each carrying a source, is a query, not a model behavior. **Temporal truth:** "the member was on warfarin until March" is representable through validity intervals, not erased by the current answer.

Current member state is a **derived view** over verified facts — fast to read, trivially rebuilt from events, never authoritative on its own. What persists across the Brain: demographics and key relationships · conditions and medications · care goals and care plan · open needs and concerns · tasks, waiting-on items, deadlines, and risks · referrals and external services · interactions · documents and original source artifacts · billing evidence and program activity · and for every important fact: source, timestamp, confidence, and verification status.

### Context assembly: whole member, no retrieval layer

At this scale, the retrieval strategy is to load the member's full fact set and recent events into the model's context. Prompt caching makes this cheap; it is dramatically more reliable than a similarity search deciding what is "relevant" to a medication conflict. Vector search and embedding infrastructure sit on the do-not-build-yet list, with a named trigger: revisit when a member's full context no longer fits comfortably in the window.

### Event-first architecture

> **Every important action leaves evidence.** A call, document, referral response, EHR event, note, task, or billing action creates a traceable event. Facts change status; the underlying history is never silently overwritten.

| Layer | Examples | Role |
| --- | --- | --- |
| Raw source | Transcript, discharge summary, EHR payload, referral message, uploaded file | Immutable, retained as evidence |
| Normalized event | MemberCalled, DischargeReceived, MedicationReported, ReferralCompleted | Nola-owned event model |
| Proposed fact | Medication changed; concern added; task suggested | AI interpretation — a row with status `proposed`, never truth by default |
| Verified fact | Authoritative member and case facts | Rows with status `verified`, provenance attached |
| Derived context | Current summary, next actions, assembled model context | Recomputed from facts plus evidence |

### Simplicity first, complexity earned

The core loop: event arrives → classify → assemble member context → model proposes facts and actions against the workflow's schema → deterministic validation → safe update, review, or escalation. Predictable processes run as coded workflows. Agentic behavior is reserved for genuinely open-ended jobs (Section 6). The product is never one giant autonomous agent.

Documents never become opaque blobs: Nola retains the source and links every extracted fact back to the exact evidence. Calls are captured where legally and consent-appropriate, then transformed into structured Interaction events, draft documentation, tasks, and proposed facts. When evidence is conflicting or insufficient, the system stops rather than guesses.

---

## 4. Billing and financial operations

**Billing intelligence starts on day one. Production claims submission comes later.**

Healthcare financial operations are among the most labor-intensive parts of a care service. If Nola waited for a clinical organization to think about billing, it would retrofit documentation and evidence after the care workflow was already designed. Instead, the schema captures from the first event what would make a future service defensibly billable, even though no real claim is submitted this year.

### One event stream, three views

| View | Question | Examples |
| --- | --- | --- |
| Member state | What is happening with the person? | Conditions, medications, goals, support, concerns |
| Operational state | What needs to happen next? | Tasks, follow-ups, waiting-on items, deadlines, escalations |
| Financial state | What service activity occurred and what evidence exists? | Who did it, when, duration where required, purpose, program relevance, documentation completeness |

### Build now: the billing evidence layer

Every event records actor, timestamp, duration where a program requires it, purpose, and member link, and ties the activity to the care goal, reason, source, and documentation. Program eligibility and requirement state are tracked at a simple level for the initial care-management program. Missing evidence and ambiguous activity are flagged for review. Care and billing trace back to the same underlying event rather than living in disconnected records. The billing review surface ships as one of the fall workflows (Section 13); the data it reads exists from the first commit.

### Buy or defer: financial rails

Nola does not build a clearinghouse, production claim transmission, ERA handling, broad payer connectivity, or full denial management before the service is ready to bill. When production billing begins, Nola buys proven rails and keeps its proprietary advantage where it belongs: documentation quality, evidence completeness, rules, exception handling, and operational intelligence. The long-term advantage: clean claims are a consequence of understanding care as it happens, not of reconstructing the month afterward.

---

## 5. Build vs. buy

The cost of producing software has fallen. The cost of choosing the wrong thing to build has not. Proprietary engineering goes into the domain-specific workflow, context, and feedback loop, never into commodity rails.

### Build now

| Capability | Why Nola owns it |
| --- | --- |
| Member and case ontology | Compounds with every workflow and constrains the entire product |
| The Case Brain (facts, provenance, contradiction handling) | Core differentiation; no vendor sells verified-fact state with audit semantics |
| Nola event model | Makes EHR, referral, phone, email, file, and manual inputs interchangeable at the Brain boundary |
| The workflow factory | Turns any shadowed process into a shippable workflow in days; the compounding asset of Fall 2026 |
| Human-review and autonomy policy | Determines what is quiet, what is prepared, and what requires judgment |
| Care-manager UX | Nola's own workforce operates through it; it is operating leverage |
| Billing evidence model | Financial operations generate from the same underlying work |
| Trace store, golden cases, correction data | The learning flywheel's raw material; stored in Nola's own database, always |

### Buy now

| Capability | Default |
| --- | --- |
| Foundation models | Frontier APIs; benchmark alternatives when evals justify it |
| Managed database | Own the schema and ontology, not database infrastructure |
| Object storage | Commodity |
| Authentication and identity | Established tooling; never invent auth or crypto primitives |
| Hosting, queues, monitoring | Managed services unless a specific constraint appears |
| Trace viewing and dashboards | Open-source UI over Nola-owned data (Section 6) |
| Telephony, SMS, email, fax | Buy the communication rails; own the workflow and captured context |
| Transcription | Buy initially; revisit only if quality or cost becomes strategic |
| E-signature, commodity scheduling | Proven vendors |

### Do not build or buy yet

Production Epic integration (model the boundary; synthetic data first) · production Unite Us integration (define the connector interface; partner API access must not determine whether the fall succeeds) · production claims submission and clearinghouse connectivity · a large denial-management system · a broad payer rules engine · a consumer mobile app · vector search and embedding infrastructure (trigger: member context no longer fits the window) · custom foundation models, data warehouses, Kubernetes, or broad multi-model orchestration.

> **The three-question test.** Does owning this make Nola smarter, more differentiated, or more operationally advantaged? If yes, consider building. If not, can a vendor provide it reliably? Buy. Do we even need it to prove the next hypothesis? If no, defer.

---

## 6. Third-party tooling decisions

The dividing line for every tool: vendors get the plumbing, never the memory. Anything that accumulates Nola's judgment — traces, golden cases, facts, corrections — lives in Nola's Postgres. Anything that moves bytes or draws dashboards is bought at the cheapest boring tier.

### Adopt

| Tool | Role | Rationale |
| --- | --- | --- |
| Anthropic SDK (direct) | All Brain model calls, structured outputs validated with Zod | The ingestion loop is a coded workflow; a framework would only obscure prompts and control flow |
| Claude Agent SDK | Open-ended side jobs only: synthetic member-history generation, an eval-failure triage agent that drafts fix PRs, later referral-portal chasing | The Claude Code harness as a TypeScript library — tool loop, MCP, subagents, checkpoints included. Subscription plans now bundle monthly Agent SDK credits, so these agents run on the founder plan at no marginal cost |
| Claude Code routines and dynamic workflows | The nightly maintenance fleet (codify, dependency bumps, terminology sweep, eval report) and any parallel fan-out | Platform-native scheduling and orchestration; no custom queue, lock, or daemon plumbing gets built |
| Langfuse | Trace and eval-run viewer | MIT-licensed, self-hostable in minutes or free cloud tier; raw traces still land in Nola's Postgres first, emitted in OpenTelemetry GenAI format so no viewer ever owns the data. Shrinks E3's trace-viewer scope to gaps only |
| Claude native PDF / vision | Document ingestion for the synthetic phase | Keeps the stack thin; specialized parsers wait for real-world fax quality |
| RxNorm (free NLM API) | Light medication-name normalization | Store the raw string plus an optional code; no terminology service gets built |
| Synthea | Raw material for synthetic members | Open-source synthetic-patient generator; agents remix its output into Nola-shaped golden cases |
| Deepgram (medical model) | Transcription, calls phase | Starter credit covers the fall; medical vocabulary out of the box |

### Decline

| Tool | Why not |
| --- | --- |
| LangChain / LangGraph / CrewAI | Runtime agent frameworks solve open-ended orchestration; Nola's core loop is deterministic. Adopting one buys abstraction debt and framework gravity |
| LangSmith | Excellent for LangChain-native teams; Nola is not one, and the trace store must be Nola-owned regardless |
| Mem0 / Zep / Letta (memory layers) | Built for chat-assistant recall, not verified-fact state with provenance, status lifecycle, and audit. The Case Brain is the moat and is not outsourced. One pattern is borrowed, not bought: temporal validity intervals on facts |
| Vercel AI SDK | A fine abstraction, but single-model and single-vendor needs make it a layer that adds nothing |
| Temporal / Inngest (now) | The event-sourced pipeline already provides resumability: each step consumes an event and emits an event. Named trigger to revisit: any pipeline exceeding ~5 steps or crossing services |

### Evaluate later, on named triggers

| Tool | Trigger |
| --- | --- |
| Braintrust | Mid-fall, if eval iteration UX becomes a bottleneck; golden cases and scoring remain code in the repo either way |
| Reducto / AWS Textract / Azure Document Intelligence | First real-world scanned faxes; run a bake-off against native model ingestion |
| Medplum (open-source FHIR backend) | Post-raise, when Epic/FHIR boundaries become real. Until then: study its resource shapes while designing the member ontology so future mapping is sane, but do not contort the Brain around an interop standard |
| Temporal | The durable-execution trigger above |
| HIPAA-eligible infrastructure (BAAs, hosting attestations) | Clinical entity formation; irrelevant while all data is synthetic |

### Building on accelerating models

Frontier models improve mid-plan; the plan assumes it. Operating rules:

- **Patches versus requirements.** Every instruction in a prompt, CLAUDE.md, or hook is one of two things: a patch correcting a model weakness, or a requirement encoding what care management demands (provenance, ceilings, the evidence firewall, terminology). Patches are deleted on every major model release; requirements never are. Every patch added must cite the eval failure it fixes.
- **The ablation ritual.** On each major model release: branch, strip the capability patches, run the full golden suite, compare, re-baseline. An instruction returns only after the model repeatedly stumbles on the same thing — the same twice rule that governs codification. The Brain's model-call module supports a `MINIMAL_PROMPT` flag that strips all non-requirement instructions, so ablation is a one-flag eval run. Roughly every six months, the same deletion pass runs over CLAUDE.md, skills, and hooks.
- **Standing elicitation tests.** A small set of deliberately too-hard tasks (in `evals/elicitation/`) runs manually on every major model release to detect product overhang: hand the model a complete synthetic case file and ask for a full care-plan draft; hand it a fresh-written synthetic shadow-session debrief and ask for a complete one-page workflow spec with ten goldens. The day a model one-shots one, that capability jumps the build queue. Ten minutes per release, logged with date, model, verdict, and action.
- **Verification is the design center.** Tasks are given as task + guardrails + exit criteria, with a way for the model to verify its own work; overspecified step-by-step instructions are a smell. Where verification is mechanical (tests, builds, golden suites), work runs long and unattended. Where verification is human judgment (`brain/`, `shared/`, workflow schemas), work stays small-sliced and founder-read.
- **Golden suites harden as models improve.** When a workflow saturates its goldens, harder cases are written — messier sources, subtler contradictions — so the autonomy gates keep discriminating. A saturated suite continues life as a regression guard.
- **Maintenance runs as routines.** Scheduled Claude routines handle the night shift: codify review of the day's sessions, dependency bumps gated on the test suite, a terminology sweep, the eval-regression report, duplicate-abstraction cleanup. Each routine is a one-paragraph prompt, not a custom daemon; anything needing fan-out uses dynamic workflows rather than hand-built orchestration.

---

## 7. Roadmap to launch

| Timing | Goal | What happens |
| --- | --- | --- |
| Now — Sep 2026 | Discovery + foundations | Continue shadowing care navigation; add exact Medicare/CCM/APCM and revenue-cycle workflows; complete Day 0–3 setup (Section 8) |
| Fall, weeks 1–2 | Workflow #1, concrete | Discharge-summary workflow built end to end with no generic machinery: facts table, whole-member context, review screen, ten golden cases |
| Fall, week 3 | Workflow #2, by duplication | Call-transcript workflow built by deliberate copy; the duplication is the design input |
| Fall, weeks 4–5 | Extract the factory | Generic loop, generic review surface, workflow registry extracted from the two real implementations. Acceptance test: workflow #3 ships in under a week from a spec |
| Fall, week 6 on | Workflow production | One new workflow per week from one-page specs; each ships supervised and earns autonomy through evals and vigilance metrics |
| Late fall / early winter | Care-manager testing | A hired care manager, contracted expert, or partner environment works the portfolio on synthetic caseloads; observe work rather than collecting opinions |
| After measured evidence | Fundraise | Raise on measured productivity, documentation quality, trust and safety behavior, and a clear path to service economics |
| Post-raise | Clinical and operating buildout | Healthcare counsel and clinical leadership design the PC / clinical entity and corporate structure; recruit workforce; production security and compliance; payer and provider enrollment; real integrations. Every workflow resets to fully supervised operation when real members arrive |
| Launch | Production care + billing | Deliver reimbursable service; productionize claims and payer rails; close the loop between care work, documentation, billing, denials, and payment |
| Scale | Learning flywheel | Practitioner corrections and production traces feed evals; the Brain improves; each care manager safely supports more members; unit economics and quality improve together |

### What to shadow next

A Medicare care manager delivering CCM or related virtual care management · the program administrator responsible for documentation and compliance · the billing / revenue-cycle person who turns documented work into claims and handles denials · the hospital-discharge referral workflow from the referring side · community-organization referral workflows through Unite Us-like networks.

Shadowing is not a side activity. The shadowing calendar is the production schedule: each observed process supplies the spec and golden cases that license one more workflow (Section 11). At least one shadowing session stays on the calendar every week through the fall.

**The evidence firewall:** shadowing produces notes, transcripts, and recordings that may contain real protected information. None of that material ever enters the repository, the golden cases, or a prompt. Golden cases are written fresh as synthetic cases inspired by observed patterns, co-authored with a domain expert so "expected correct state" carries clinical judgment. Shadowing artifacts live in the document workspace; the codebase stays clean.

---

## 8. First work: Day 0–3 setup

Environments, accounts, and tooling. Roughly three working days, founder only.

### Day 0 — accounts and org hygiene

1. **GitHub** (free): org plus private monorepo `nola`. Org-wide 2FA. Branch protection on `main`: PR required, CI green required. A `CODEOWNERS` file routes `/brain/`, `/shared/`, and every `workflows/*/schema*` to the founder, mechanically enforcing the ownership map.
2. **Anthropic Console**: one workspace, two API keys (`app` and `evals`), each with a per-key spend limit, plus a monthly budget cap. Founder subscription: Claude Max 5x ($100/mo), moving to Max 20x ($200/mo) only when parallel agent sessions become the daily norm; Max is monthly-only, so switching costs nothing, and the plan's bundled Agent SDK credits fuel the side agents in Section 6. Students use their own accounts, or Nola-paid Pro seats ($20 each) only if their surfaces genuinely need Claude Code.
3. **Supabase** (free tier): Postgres, auth, and storage from one vendor.
4. **Vercel Pro** ($20/mo) for the frontend: the Hobby tier prohibits commercial use; the company does not build on it.
5. **Railway** (~$5–10/mo): one Node service that serves the API **and** runs the job queue in-process. One deployable, one log stream, no serverless timeout games during long ingestion runs. It splits into separate services only when something forces it.
6. **Sentry** (free) for errors. **Linear** (free) or GitHub Projects for the tiny backlog. **Figma** (free) for the clickable prototype.
7. **Secrets**: platform environment variables only; `.env.example` checked in; Bitwarden for human-held credentials. Nothing secret ever enters git.

### Day 1 — a repo skeleton that runs, and the rules that never change

pnpm workspaces: `frontend/ api/ brain/ workflows/ evals/ shared/ docs/`. TypeScript strict everywhere; Biome for lint and format. `supabase start` runs the full local stack in Docker; `pnpm dev` boots frontend and API against it, so everything runs on a laptop with no cloud dependency.

**CLAUDE.md v1 is written before any feature code**, and carries: the commands and repo map · conventions · the member-terminology rule · the no-real-data rule · **the evidence firewall** (no shadowing material in repo, goldens, or prompts) · **the severity rubric** — critical (a wrong medication fact verified, a wrong-member write, a fabricated source link), major, and minor error definitions, written down before the first proposal ever renders · **the medication ceiling** — medication-related change types never exceed supervised review this year, regardless of eval scores · and a mistakes log that grows every time an agent gets something wrong.

`.claude/commands/new-workflow.md` starts as a spec template and becomes the scaffolder. A PR template asks for: what changed, eval delta, screenshot.

### Day 2 — CI and data

GitHub Actions: typecheck, lint, unit tests, the member-terminology grep, and seed-and-smoke on every PR; an eval-regression job triggers on changes under `brain/`, `shared/`, or `workflows/`. A deterministic `pnpm seed` creates five synthetic members; `pnpm reset` wipes and rebuilds. Migrations run through the Supabase CLI and live in the repo.

### Day 3 — deploy loop and observability

Vercel preview deploy per PR for the frontend. One shared Supabase project serves as the demo environment; database-per-PR complexity is skipped at this stage. Background jobs run on **pg-boss** inside the single Railway process. Sentry is wired into frontend and backend. **Traces are first-class:** every model call writes prompt reference, retrieved-context references, output, tokens, latency, and cost to a `traces` table in Nola's own database, emitted in OpenTelemetry GenAI format; Langfuse (self-hosted or free cloud) provides the viewing UI over that stream.

**Environments:** local (laptop + Docker) → preview (per-PR) → demo (shared cloud project, used for Friday demos and care-manager testing). No real member data exists in any environment; "production" does not exist until the clinical entity does.

### Budget (approximate; verify at signup)

| Tool | Tier | ~$/mo |
| --- | --- | --- |
| GitHub | Free | 0 |
| Claude Max 5x (founder, includes Agent SDK credits) | Monthly | 100 |
| Anthropic API (dev + evals) | Pay-as-you-go | 50–150 |
| Claude Pro, student seats | 0–3 seats, only if needed | 0–60 |
| Vercel | Pro | 20 |
| Supabase | Free → Pro | 0 → 25 |
| Railway (API + jobs) | Usage | 5–10 |
| Langfuse | Self-host or free cloud tier | 0 |
| Sentry / Linear / Figma / Bitwarden | Free tiers | 0 |
| Deepgram (transcription, calls phase) | $200 starter credit | 0 |
| **Total** | | **≈ $175–365/mo** |

Cost levers: Sonnet-class models by default with the top tier reserved for hard extraction; the Batch API (roughly half price) for eval runs; prompt caching for repeated member context; per-key spend caps and a hard cap on any overflow usage.

Credits worth an afternoon of forms: the Anthropic startup program if eligible through an investor or accelerator; Columbia's entrepreneurship ecosystem, since Build Lab affiliation often unlocks cloud-credit packages; AWS Activate, Google for Startups, and Microsoft Founders Hub; Deepgram's starter credit when calls begin.

---

## 9. Architecture

One repo. One backend process. The Brain is a module behind the API, not a microservice. A workflow is a typed module, not a codebase and not a config language.

```
nola/
  frontend/        # care-manager UI
  api/             # contract endpoints, auth; pg-boss jobs run in this process
  brain/           # generic loop: classify → assemble context → extract → validate → route
  workflows/       # one folder per workflow: a TypeScript module implementing WorkflowDefinition
  evals/           # harness, regression runner, scoring
  shared/          # member ontology types, API contract types
  docs/            # decisions.md, ontology notes
  .claude/         # commands: /new-workflow, PR conventions
  CLAUDE.md
```

Each workflow implements a `WorkflowDefinition` interface — trigger, extraction schema (Zod), validation rules, routing defaults, autonomy level, goldens directory — so schemas are imported and type-checked, never parsed from config files.

Stack (each a reversible decision, revisited only with evidence): React + TypeScript + Tailwind on Vercel; a single TypeScript Node backend on Railway; Supabase Postgres with an append-only `events` table and the `member_facts` table at the center; Claude via the direct Anthropic SDK behind one internal module that logs traces; managed auth with an email allowlist and `org_id` on every table so the workspace boundary is explicit from day one.

Core tables: `members` · `events` (append-only; carries actor, timestamp, duration, purpose — the billing evidence fields) · `member_facts` (Section 3: status lifecycle, provenance, validity intervals) · `documents` · `interactions` · `proposals` · `tasks` · `evidence_entries` · `traces` · `eval_cases` · `workflow_registry`.

### API contract v1

Frozen at the end of Day 0–3 work. Additive changes are free; breaking changes require founder sign-off and a version bump. The frontend must run fully against the mock server — if the mock cannot express a screen, the contract is wrong, not the mock.

```
GET  /members                      GET  /members/:id/state
GET  /members/:id/timeline         GET  /members/:id/tasks
GET  /today                        GET  /workflows            # registry + autonomy level
POST /ingest                       # any workflow's input enters here
GET  /proposals?status=pending     # generic, cross-workflow
POST /proposals/:id/decision       # accept | edit | reject (+ payload)
POST /notes   POST /tasks          # manual actions stay normal
GET  /members/:id/evidence
```

---

## 10. Weeks 1–5: two workflows, then the factory

Abstractions are extracted from repetition, not invented from foresight. The sequence is deliberate:

**Weeks 1–2 — workflow #1, completely concrete.** The discharge-summary workflow, end to end, with no generic machinery: ingestion, facts written with provenance, deterministic validation, a review screen showing source beside proposals, decisions written back, ten golden cases co-authored with the domain expert. The founder designs the review interaction; Build Lab implements the surface.

**Week 3 — workflow #2, by shameless duplication.** The call-transcript workflow, copied from #1 and adapted. The duplication is not waste; it is the design input for the factory. Every place the copy diverged is a parameter; every place it stayed identical is the frame.

**Weeks 4–5 — extract the factory.** From the two real implementations: the generic event-to-proposal loop, the generic review surface (one component rendering any workflow's proposals), the eval harness and per-workflow goldens, and the workflow registry. **Acceptance test: workflow #3 (referral status) ships in under one week, touching only a workflow module and golden cases.** If it takes longer, the factory gets fixed before workflow #4 is attempted.

**Hard rule from week 4 on:** nothing workflow-specific lives outside `workflows/<name>/`. If specific logic leaks into `brain/`, the factory is broken.

---

## 11. Week 6 onward: the production line

Weekly cadence, founder plus agents:

**Monday** — pick the next workflow from the shadowing backlog and write the one-page spec: trigger, extraction schema, validation rules, routing defaults, ten golden cases. **Tuesday–Thursday** — agents scaffold from the spec in parallel sessions, each in its own checkout; the founder personally writes or approves the schema and validation, because that is the judgment layer. **Friday** — the workflow ships at Level 1 (prepared) and appears on the portfolio dashboard with its eval baseline.

Golden cases exist before the first live run, without exception. A workflow without goldens is a demo, not a product.

**The binding constraint is discovery, not code.** Any workflow can be built in days, but only shadowed processes can be specified: the schema and the ten goldens come from watching real work. Every shadowing session is a license to ship one more workflow, which is why the shadowing calendar in Section 7 is part of the engineering plan.

---

## 12. The autonomy ladder

Velocity and safety live on different axes. Every workflow ships fast; autonomy is earned per workflow and per change type.

| Level | Name | Behavior |
| --- | --- | --- |
| L0 | Shadow | Runs on inputs; output visible only in the trace viewer. For brand-new or risky workflows |
| L1 | Prepared | Every proposal human-reviewed. Default for all new workflows |
| L2 | Selective quiet | Named low-risk, reversible change types auto-apply with a full audit trail (filing a document, logging a referral-status update). Everything else stays prepared |
| L3 | Quiet | Auto-apply within the workflow's scope; sampled audits continue |

**Measuring trust honestly.** A rising accept rate can mean accuracy improved — or that the reviewer stopped reading. The gate therefore measures vigilance directly: **canary proposals** (known-bad items seeded into the review stream; the reviewer knows canaries exist, never which ones) with catch rate as a first-class metric, and **edits weighted over accepts** — edit distance and stated correction reasons are signal; a bare click is not.

**Promotion gate, numeric first, then sign-off:** at least 25 golden cases above the accuracy threshold · at least 50 live proposals with accept-plus-verified-edit quality at or above target · canary catch rate at or above target · zero critical errors per the severity rubric · founder sign-off. **Demotion is automatic** on eval regression, a missed canary pattern, or any critical error; no meeting required.

**Two ceilings set by judgment, not measurement:** medication-related change types never exceed L1 this year, regardless of scores. And autonomy earned against synthetic members proves the *mechanism* — gates, demotion, audit — not clinical safety; every workflow resets to L1 when real members arrive post-raise, and the December materials say so explicitly.

This gate is the product. A care manager's trust, once spent, does not refill. Everything else in this plan can move fast because this one thing does not.

---

## 13. December portfolio target

The portfolio has a deliberate shape: **two deep, six or more wide.** Workflows #1 and #2 must hit real bars — measured minutes saved, extraction accuracy, canary catch rate. Workflows #3 onward exist to prove the factory stamps new workflows cheaply. The measurement memo leads with the deep two; the dashboard is the supporting act.

| # | Workflow | Spec source | December target |
| --- | --- | --- | --- |
| 1 | Discharge summary → member update | Shadowed ✓ | L2 (selective), deep measurement |
| 2 | Call transcript → note + proposals + tasks | Shadowed ✓ | L1 → L2, deep measurement |
| 3 | Referral status check → timeline update | Shadowed ✓ | L2–L3; factory acceptance test |
| 4 | Inbox triage + drafted replies | Partial; one more session | Classification L2 · drafts L1 |
| 5 | Intake packet processing | Needs discovery | L1 |
| 6 | Recertification / renewal paperwork prep | Needs discovery | L1 |
| 7 | Monthly evidence packet assembly | Needs billing shadowing | L1 |
| 8 | Visit summary → structured interaction | Adjacent to #2 | L1 |

Workflows 5–7 ship only if their shadowing happens; that dependency is stated deliberately.

---

## 14. Columbia Build Lab

> **Build Lab is parallel horsepower, never a dependency.** The founder remains on the critical path for the Case Brain and the factory. CBL engineers accelerate product surfaces, workflow plumbing, and testing infrastructure behind frozen interfaces. If every CBL engineer vanished tomorrow, the Brain and the company's rate of learning would continue.

### Team allocation

| Role | Profile | Scope |
| --- | --- | --- |
| Engineer 1 — Frontend | React / TypeScript, strong UI instincts | Today, member workspace, roster, portfolio dashboard shell, manual actions, from the Nola design system |
| Engineer 2 — Full-stack workflow | React / TypeScript plus backend comfort | Workflow #1's review screen, then its generalization into the generic review surface (the highest-leverage student deliverable in this plan); audit history; billing evidence review |
| Engineer 3 — Tooling | Python or TypeScript; data and evals | Synthetic member generator, eval dashboard, trace-viewer gaps beyond Langfuse. Pairing into `brain/` is earned mid-semester on demonstrated depth, not assigned up front |

### What the founder keeps

Member and case ontology · the facts model and source-of-truth architecture · context assembly · orchestration and any Agent SDK usage · the autonomy policy and severity rubric · clinical-safety ceilings · billing and financial intelligence architecture · core eval definitions and the quality bar · production security and compliance architecture.

### Weekly rhythm

| Cadence | Rule |
| --- | --- |
| Monday | Founder sets one measurable outcome per engineer; confirms contract, mock data, acceptance criteria |
| Midweek | Async build; minimal meetings; engineers unblock each other before escalating to the founder |
| Friday | Live demo of working software; founder decides keep, simplify, throw away, or expand |
| Continuous | Founder ships Brain and factory improvements daily; never blocked on CBL work |

The velocity test, applied monthly: do these engineers make the founder build and learn faster? Student components that are 70% right get used; components that create drag get replaced without ceremony.

---

## 15. Ownership, review, and evals

CODEOWNERS enforces founder-only merges on `brain/`, `shared/`, and every workflow schema. The founder reads every diff on those paths. The periphery is reviewed by Friday demo plus passing tests: loose on the edges, tight on the core.

Evals start with workflow #1, not after it. Each workflow is born with ten golden cases and holds at least 25 before any autonomy promotion. Shared metrics: extraction accuracy against expected facts, correct source selection and provenance, contradiction detection, update safety (a proposed fact never overwrites a verified fact), next-action quality and prioritization, escalation calibration, canary catch rate, hallucination rate, and regression rate after any prompt, model, retrieval, or architecture change.

Every practitioner correction preserves what Nola proposed, what the practitioner changed, the source evidence, and the final accepted state, and automatically becomes a candidate golden case. CI runs the regression suite on any change to `brain/`, `shared/`, or `workflows/` and posts metric deltas to the pull request. Autonomy promotions are read straight off the eval dashboard. Golden suites are expected to saturate as models improve; saturation triggers harder cases, and the saturated suite remains in place as a regression guard.

> **The practitioner flywheel.** Nola proposes → the practitioner corrects → the product captures the full difference with source context → repeated patterns become evals → engineering improves the Brain → future practitioners do less corrective work.

---

## 16. Measurement

The fall is not judged on whether the UI looks good. It is judged on whether Nola materially changes the economics and cognitive load of care management while preserving trust.

| Dimension | Examples |
| --- | --- |
| Time | Intake time; documentation time; time finding context; time preparing referrals and follow-ups; time preparing billing evidence |
| Throughput | Members one care manager can safely handle; work completed per day; time-to-caught-up |
| Quality | Missed tasks; wrong facts verified; duplicate work; incomplete documentation; unresolved contradictions |
| Human burden | Approvals required; interruptions; items shown that did not truly need the human |
| Trust | Accepted vs. edited vs. rejected proposals; edit distance and correction reasons; canary catch rate; provenance usage |
| Financial ops | Share of activities with sufficient evidence; missing-requirement rate; time to prepare a billing-ready packet in the simulated workflow |

Care-manager testing runs on matched synthetic caseloads, baseline versus Nola, observing work rather than collecting opinions. The output is a metrics memo: the fundraise artifact. It leads with the two deep workflows and states plainly what synthetic autonomy does and does not prove.

---

## 17. Risks

| Risk | Mitigation |
| --- | --- |
| Ontology churn under speed | `shared/` is founder-only and versioned; workflows consume the ontology, never mutate it |
| Premature abstraction | The factory is extracted after two concrete workflows, never designed before them; workflow #3 is the acceptance test |
| Discovery becomes the bottleneck | Weekly shadowing on the calendar; the portfolio is capped by observed processes, stated openly |
| Reviewer vigilance collapses as trust grows | Canary proposals with catch-rate gating; edits weighted over accepts |
| Autonomy promoted too early | Numeric gates plus sign-off; automatic demotion; medication ceiling at L1; reset to L1 with real members |
| Real protected information leaks into the codebase | The evidence firewall: shadowing artifacts never enter repo, goldens, or prompts; goldens written fresh with the domain expert |
| Extraction accuracy plateaus | Narrow to discharge summaries; expand document types only after accuracy holds |
| Cost creep from parallel agents | Per-key spend caps, batch and caching for evals, monthly bill review |
| CBL engineer variance | Frozen contracts and mocks; any student surface can be dropped without touching the core |
| Founder becomes a student manager | Sync time capped by the weekly rhythm; the velocity test applied monthly |
| "Patient" leaks into copy or prompts | CI grep plus prompt-review checklist |

---

## 18. Product rules

1. Show the human only what needs the human.
2. Member information lives in a persistent member workspace, not scattered across modules.
3. AI intelligence appears contextually, not as a permanent "AI" destination.
4. Normal software actions stay normal: a care manager can always add a note, create a task, upload a file, or create a referral directly.
5. Routine administrative work happens quietly.
6. Prepared work is grouped for lightweight review; there is no AI-generated approval queue.
7. Uncertainty causes Nola to pause rather than guess.
8. Important facts lead back to a source.
9. Every work session can reach a true "You're caught up" state.
10. Care-manager UX and operations UX may expose very different levels of complexity.
11. Every care event leaves structured evidence usable by care, operations, and financial workflows.
12. Founder attention stays on the compounding technical core.

---

## 19. Decision log (mirror of docs/decisions.md)

1. TypeScript end to end; Python permitted in `evals/` — reversible.
2. Supabase + Vercel + Railway as managed rails; one backend process serving API and jobs — reversible.
3. Member state as a facts table with status lifecycle and validity intervals; current state as a derived view — foundational; changed only with strong evidence.
4. Whole-member context assembly; no vector retrieval until context no longer fits — reversible on its named trigger.
5. Direct Anthropic SDK in the Brain; no runtime agent framework; Claude Agent SDK reserved for open-ended side jobs — reversible.
6. Traces in Nola's Postgres in OpenTelemetry format; Langfuse as the viewer — reversible.
7. A workflow is a TypeScript module implementing `WorkflowDefinition` — reversible.
8. Founder on Max 5x; upgrade to 20x when parallel sessions are the norm — monthly, freely reversible.
9. **member** terminology in schema, API, UI, prompts, enforced by CI — one-way for naming.
10. Case Brain remains the internal codename; it names the case, not the person, and never appears in member-facing copy — cosmetic.
11. Autonomy gates are numeric, per workflow and per change type, with canary catch rate as a first-class input; medication change types capped at L1 this year — policy; revisited only with evidence, except the medication ceiling, which stands.
12. The evidence firewall: no shadowing material in repo, goldens, or prompts — one-way.
13. No real member data until the clinical entity and counsel sign-off exist; all autonomy resets to L1 when real members arrive — one-way until counsel says otherwise.
14. Codify agent ships at L1 of our own autonomy ladder — auto-PR, human merge; promotion considered after a month of clean PRs — reversible.
15. Member population profile (docs/member-population.md) is the source of truth for all synthetic generation and golden cases; demographic attributes are self-reported facts with provenance and are excluded from escalation/autonomy inputs; parity across language and demographics becomes an eval dimension when the harness lands — policy.
16. Patch-versus-requirement test governs every instruction in prompts, CLAUDE.md, and skills: requirements encode what care management demands and are never deleted; patches work around a current model's weakness, cite the eval failure they fix, and are deleted per model release after goldens confirm — policy.
17. Ablation ritual on every major model release: strip patches, run the golden suite, re-baseline; CLAUDE.md, skills, and hooks get a deletion pass roughly every six months — policy.
18. Codify and maintenance run as scheduled platform routines, never custom queue/daemon plumbing; the codify agent holds at L1 (auto-PR, human merge), superseding decision 14's promotion timetable — reversible.
19. Golden suites harden on saturation: when a workflow aces its goldens, write meaner ones; the saturated suite stays as a regression guard — policy.
20. Standing elicitation tests (`evals/elicitation/`) run on every major model release to detect product overhang — policy.

---

## 20. Legal and clinical note

The exact professional-corporation / clinical-entity structure, scope of services, billing arrangements, payer enrollment, supervision, consent, and HIPAA and security obligations are legal and operational design questions, finalized with healthcare counsel and appropriate clinical leadership before Nola delivers or bills production clinical services. Everything in this plan is built and tested with synthetic data and properly scoped workflow research before that structure exists.

---

## 21. Definition of done: the December demo

Live, on synthetic members: open the portfolio dashboard — six or more workflows, each with an autonomy level and an accuracy trend → run the discharge workflow end to end (upload → proposals with sources → accept two, edit one → facts, tasks, and evidence update) → run a second workflow end to end → tell one promotion story: the eval scores, live-proposal quality, and canary catch rate that moved referral-status from L1 to L2 → show a live correction becoming an eval case.

That demo, plus the care-manager measurement memo, is the fundraise: the machine that turns shadowed processes into trustworthy workflows in a week — two of them measured deeply, six of them proving the machine.

**Build the Brain. Buy the rails. Capture the evidence. Let everything else earn its way onto the roadmap.**
