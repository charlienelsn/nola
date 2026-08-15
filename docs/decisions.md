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
