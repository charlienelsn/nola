# Workflows

One folder per workflow. Each is a TypeScript package implementing
`WorkflowDefinition` from `@nola/shared`: trigger, extraction schema (Zod),
deterministic validation, routing defaults, autonomy level, goldens directory.

Rules:
- Every workflow is born with ten golden cases, before its first live run.
- Every workflow ships at L1 (prepared). Autonomy is earned per the ladder.
- Nothing workflow-specific lives outside this directory (from week 4 on).
- Schemas and validation are founder-approved (CODEOWNERS).

First workflow: `discharge-summary/` (weeks 1–2, built concretely).
Scaffold new ones with the /new-workflow command once the factory exists.
