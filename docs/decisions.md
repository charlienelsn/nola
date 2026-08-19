# Nola — decision log

Why things are the way they are. Append; do not rewrite history.
Each entry: decision, reversibility.

1. TypeScript end to end; Python permitted in `evals/` — reversible.
2. Supabase + Vercel + Railway as managed rails; one backend process serving
   API and jobs (pg-boss in-process) — reversible.
3. Member state as a facts table (`member_facts`) with status lifecycle and
   validity intervals; current state as a derived view — foundational;
   changed only with strong evidence.
4. Whole-member context assembly; no vector retrieval until a member's
   context no longer fits the window — reversible on its named trigger.
5. Direct Anthropic SDK in the Brain; no runtime agent framework; Claude
   Agent SDK reserved for open-ended side jobs — reversible.
6. Traces in Nola's Postgres, OpenTelemetry GenAI format; Langfuse as the
   viewer — reversible.
7. A workflow is a TypeScript module implementing `WorkflowDefinition` —
   reversible.
8. Founder on Claude Max 5x; upgrade to 20x when parallel agent sessions are
   the daily norm — monthly, freely reversible.
9. **member** terminology in schema, API, UI, prompts, enforced by CI —
   one-way for naming.
10. Case Brain remains the internal codename; never member-facing — cosmetic.
11. Autonomy gates are numeric, per workflow and per change type, with canary
    catch rate as a first-class input; medication change types capped at L1
    this year — policy; the medication ceiling stands regardless of scores.
12. The evidence firewall: no shadowing material in repo, goldens, or
    prompts — one-way.
13. No real member data until the clinical entity and counsel sign-off exist;
    all autonomy resets to L1 when real members arrive — one-way until
    counsel says otherwise.
14. Codify agent ships at L1 of our own autonomy ladder — auto-PR, human
    merge; promotion considered after a month of clean PRs — reversible.
15. Member population profile (docs/member-population.md) is the source of
    truth for all synthetic generation and golden cases; demographic
    attributes are self-reported facts with provenance and are excluded from
    escalation/autonomy inputs; parity across language and demographics
    becomes an eval dimension when the harness lands — policy.
16. Patch-versus-requirement test governs every instruction in prompts,
    CLAUDE.md, and skills: requirements encode what care management demands
    and are never deleted; patches work around a current model's weakness,
    cite the eval failure they fix, and are deleted per model release after
    goldens confirm — policy.
17. Ablation ritual on every major model release: strip patches, run the
    golden suite, re-baseline; CLAUDE.md, skills, and hooks get a deletion
    pass roughly every six months — policy.
18. Codify and maintenance run as scheduled platform routines, never custom
    queue/daemon plumbing; the codify agent holds at L1 (auto-PR, human
    merge), superseding decision 14's promotion timetable — reversible.
19. Golden suites harden on saturation: when a workflow aces its goldens,
    write meaner ones; the saturated suite stays as a regression guard —
    policy.
20. Standing elicitation tests (evals/elicitation/) run on every major model
    release to detect product overhang — policy.
21. Billing codes and clinician attestations are clinician-authored fact
    types. Nola proposes and completes against them; Nola never mints one.
    Field basis: at a care navigation company already billing Medicare, the
    clinician assigns both clinical and social codes at intake; the
    navigator completes the plan against them and cannot add or stray from
    them — code assignment functions as the sign-off. Independently, an
    experienced clinic social worker confirms diagnosis codes with the
    physician before putting them on a form even when confident she already
    knows the answer. Enforced as a ceiling in CLAUDE.md and as a critical
    error in the severity rubric — one-way.
22. Time-capture completeness is a product metric with its own evals. Two
    dimensions added alongside extraction accuracy: documented minutes as a
    share of minutes actually worked on a golden session, and entry quality
    — whether the record describes the work rather than only asserting a
    duration. Rationale: revenue per paid hour equals yield per documented
    hour times billable share times capture rate; capture is the only one
    of the three the product moves directly without asking anyone to work
    longer. Field observation behind the duplicate-charge critical: in a
    live GUIDE program, editing an encounter note re-drops the charge, so
    three edits in a month produce three charges; the care manager's
    workaround batches all billing to month end, which pushes documentation
    away from the moment of work and degrades accuracy — policy.
23. The workflow portfolio is re-derived from observed work rather than the
    pre-written list. The December table of eight workflows was authored
    before the shadowing sessions, which inverts the stated rule that only
    shadowed processes can be specified. Candidates re-ranked by observed
    frequency and measured time cost — reversible, and expected to change
    as shadowing continues.
24. Outbound chase is a distinct workflow class. Existing workflows are all
    ingestion-shaped: an event arrives, the Brain proposes. Measured field
    data shows the day is dominated by waiting, not interpreting — one
    observed referral ran 76 minutes elapsed with 67 of those blocked on an
    external party. A chase workflow has no arriving event; it is a
    scheduled scan over waiting-on state, triggered by elapsed time and
    absence. Verified against the code: `WorkflowDefinition.trigger` is
    event-shaped only (`{ eventType: string }`, shared/src/index.ts), so
    this is an interface change, cheaper now than in week 6 — foundational.
25. Physical artifact handoff is a modelled workflow state. Observed
    pattern: a form is printed, wet-signed by a physician, emailed to a
    family member, and hand-carried by them to a state assessor at a home
    visit. The artifact leaves the digital system and returns. States
    required: printed and awaiting signature, signed and in the family's
    possession, presented at evaluation. Without them, a chase workflow
    cannot know what it is waiting on — reversible.
26. Competing pending options are modelled explicitly. Observed: a care
    manager held one agency's four-week backlog offer open while pursuing a
    faster second agency, intending to fall back if the second declined. A
    naive model closes the first referral on initiating the second and
    destroys the fallback. Requires a fallback relationship between
    concurrent pending referrals — reversible.
27. Care plan structure: objective, then ordered actions, then follow-up,
    with each objective linked to the codes the clinician assigned.
    Confirmed as a working structure at a company already billing for care
    navigation; templates are standard practice and CMS supplies guidelines
    rather than a template. Agreement itself is a fact with provenance —
    who agreed, when, on what basis — not a free-text field — reversible.
28. Reimbursement surface for the billing evidence layer: Principal Illness
    Navigation, Community Health Integration, and Social Determinants of
    Health risk assessment, plus Chronic Care Management. Workflow #7 is
    specified against these codes' documentation requirements rather than a
    generic program-requirement abstraction. Chronic Care Management
    carries roughly 2.5x the revenue per documented hour of the navigation
    codes because it bills at a 20-minute floor rather than 60, but only
    one practitioner may bill it per member per calendar month, which makes
    availability the binding question rather than preference — policy,
    revisited when the entity structure resolves.
29. December portfolio target revised from two deep and six wide to three
    deep and four wide. Workflows 5 through 7 were already conditional on
    shadowing that has not occurred, and the measurement memo leads with
    the deep workflows regardless. The wide set is an engineering proof,
    not an investor argument — reversible.
