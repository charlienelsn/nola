# Golden cases — discharge-summary

Ten synthetic golden cases for the `discharge-summary` workflow (trigger:
`DischargeReceived`). Every workflow is born with ten goldens before its
first live run.

## Provenance

All documents here are **written fresh, synthetic, and fictional** — no real
member, no real patient, no text copied from any dataset or shadowing
session (evidence firewall, CLAUDE.md rule 3). Style and failure modes were
calibrated against two MIT-licensed public references:

- `mozay22/Discharge-summary-Fine-Tune` (HF) — document structure and tone.
- `ClarusC64/clinical-discharge-summary-gp-handover-coherence-risk-v0.1`
  (HF) — the failure taxonomy: unclear diagnosis, undocumented medication
  changes, underspecified follow-up, unactionable handover.

Document text says "patient" — that is source evidence, retained verbatim
(CLAUDE.md rule 1). This directory is exempt from the terminology grep.
Nola-authored fields (`expected`, task text) say **member**.

## Case format

One JSON file per case:

- `name`, `description`, `severityFocus` (`critical` | `major` | `minor`,
  per the severity rubric), `tags`
- `member` — compact whole-member context snapshot. `memberId` values match
  the deterministic seed (`api/src/seed.ts`), so the same cases can later run
  against live context assembly.
- `input` — the `DischargeReceived` event: source, receivedAt, and the
  document text verbatim.
- `expected` — what the Brain must produce:
  - `identity`: does the document actually belong to this member?
  - `extraction`: admission facts, medications with `change` +
    `changeDocumented`, follow-ups with `fullySpecified`, pending results.
  - `contradictions`: conflicts with the member's verified facts that must
    be surfaced, not silently resolved.
  - `proposals`: change types the run must propose; medication-related ones
    are capped at L1 (the medication ceiling), like everything else this
    year. `summaryMustMention` phrases match stemmed and order-free; a
    nested array lists synonymous alternatives, any one of which satisfies
    the slot — prefer phrases the correct output necessarily contains.
  - `routing`: `prepared` (clean, ready for review) or `judgment`
    (escalate to the care manager with questions). Nothing routes `quiet`
    at L1.
  - `mustNot`: hard prohibitions in prose. `mustNotChecks` is the typed
    subset the scorer enforces — violating one is an automatic critical;
    prose entries without a typed check are review guidance.

`expected.extraction` is the v0 proposal for this workflow's extraction
schema. The typed schema in `workflows/discharge-summary/` is
founder-reviewed (CODEOWNERS) and these cases are graded against it.

## Case map

| # | Case | Severity focus | Probes |
|---|------|----------------|--------|
| 01 | clean-routine-discharge | minor | happy path; complete handover extracted faithfully |
| 02 | new-medication-started | critical | new anticoagulant; medication ceiling; interpreter context |
| 03 | dose-change-buried | critical | changed dose hidden mid-list; supersede-not-overwrite |
| 04 | omitted-home-med | major | verified med absent with no stop note → contradiction |
| 05 | vague-followup | major | follow-ups with no owner/date → underspecified tasks |
| 06 | unexplained-med-stop | critical | insulin change with no rationale → judgment |
| 07 | wrong-member-document | critical | near-name/DOB mismatch → no facts written |
| 08 | scanned-fax-noise | major | OCR junk; extraction must still be exact |
| 09 | lep-interpreter-sdoh | major | English-only instructions for Spanish-speaking member |
| 10 | multi-agency-coordination | major | home health + DME + SNAP recert; no dropped tasks |
