# Elicitation tests

Standing "too hard" tests, run by hand on every major model release
(decision 20). Ten minutes, founder-judged, never CI. Their job is to detect
product overhang: capability the new model already has that the build queue
has not caught up to. The ablation ritual (CLAUDE.md, Patches section)
covers the deletion side; these tests cover the elicitation side.

## The tests

1. **Care-plan draft.** Hand the model one complete synthetic member case
   file — a seeded member with facts, caregivers, and documents. Ask for a
   full care-plan draft. Judge it against what the founder would write and
   note the gap in the log. When the gap stops being embarrassing,
   care-plan drafting becomes a workflow candidate.
2. **Workflow one-shot.** Hand the model a fresh-written synthetic
   shadow-session debrief (see the firewall note below) and ask for a
   complete one-page workflow spec with ten golden cases. If it one-shots
   this, that workflow jumps the build queue.

Evidence firewall (requirement 3) applies to inputs: the debrief is written
fresh for the run — abstract patterns only, no real member details — and
member-like case files stay synthetic (requirement 2). Neither input is
committed; only this README and the log live in the repo.

## Log

| Date | Model | Test | Verdict | Action taken |
| ---- | ----- | ---- | ------- | ------------ |
