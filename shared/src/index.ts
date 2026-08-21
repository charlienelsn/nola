import { z } from "zod";

/**
 * @nola/shared — member ontology types and API contract types.
 * Founder-owned (CODEOWNERS). Workflows consume this ontology; they never mutate it.
 */

// ---------- Autonomy ladder (plan section 12) ----------
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

// ---------- Member ontology (plan section 3; docs/member-population.md) ----------
export const COVERAGE_TYPES = ["medicare", "medicaid", "dual"] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

export const CoverageSchema = z.object({
  type: z.enum(COVERAGE_TYPES),
  planName: z.string().nullable(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

/**
 * Self-reported demographic value with provenance. These fields are context
 * for care, never inputs to escalation or autonomy decisions
 * (docs/member-population.md, decision 15).
 */
export const SelfReportedSchema = z.object({
  value: z.string(),
  selfReported: z.literal(true),
  source: z.string(),
  recordedAt: z.string(), // ISO date
});
export type SelfReported = z.infer<typeof SelfReportedSchema>;

export const MemberSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  legalName: z.string(),
  /** Display uses chosenName everywhere; legalName only where legally required. */
  chosenName: z.string(),
  pronouns: z.string().nullable(),
  dob: z.string(), // ISO date
  primaryLanguage: z.string(),
  interpreterNeeded: z.boolean(),
  coverage: CoverageSchema,
  raceEthnicity: SelfReportedSchema.nullable(),
  sexualOrientation: SelfReportedSchema.nullable(),
  genderIdentity: SelfReportedSchema.nullable(),
  createdAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

export const CaregiverContactSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  memberId: z.string().uuid(),
  name: z.string(),
  relationship: z.string(),
  phone: z.string().nullable(),
  preferredLanguage: z.string().nullable(),
  involvement: z.enum(["occasional", "regular", "central"]),
  isPrimary: z.boolean(),
});
export type CaregiverContact = z.infer<typeof CaregiverContactSchema>;

// ---------- Fact status lifecycle (plan section 3) ----------
export const FACT_STATUSES = [
  "proposed",
  "verified",
  "superseded",
  "retracted",
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export const MemberFactSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  memberId: z.string().uuid(),
  entity: z.string(),
  attribute: z.string(),
  value: z.unknown(),
  status: z.enum(FACT_STATUSES),
  sourceEventId: z.string().uuid(),
  confidence: z.number().min(0).max(1).nullable(),
  verifiedBy: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  invalidatedBy: z.string().uuid().nullable(),
});
export type MemberFact = z.infer<typeof MemberFactSchema>;

/** GET /members/:id/state — active verified facts only, from the derived view. */
export const MemberStateSchema = z.object({
  memberId: z.string().uuid(),
  facts: z.array(
    MemberFactSchema.refine((f) => f.status === "verified", {
      message: "member state exposes verified facts only",
    }),
  ),
});
export type MemberState = z.infer<typeof MemberStateSchema>;

// ---------- Proposals and review decisions (plan section 9, API contract v1) ----------
export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  memberId: z.string().uuid(),
  workflow: z.string(),
  /** Workflow-defined change type (e.g. task_creation); free text at this boundary. */
  changeType: z.string(),
  status: z.enum(PROPOSAL_STATUSES),
  summary: z.string(),
  payload: z.unknown(),
  sourceEventId: z.string().uuid().nullable(),
  autonomyLevel: z.enum(AUTONOMY_LEVELS),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * GET /proposals — each proposal beside its source evidence (requirement 6:
 * every proposal cites the event that produced it) and the member it serves,
 * so the review screen shows source beside proposal without a second fetch.
 */
export const ProposalWithSourceSchema = ProposalSchema.extend({
  member: z.object({
    id: z.string().uuid(),
    chosenName: z.string(),
    primaryLanguage: z.string(),
    interpreterNeeded: z.boolean(),
  }),
  sourceEvent: z
    .object({
      id: z.string().uuid(),
      eventType: z.string(),
      actor: z.string(),
      occurredAt: z.string(),
      purpose: z.string(),
      activityDescription: z.string(),
    })
    .nullable(),
});
export type ProposalWithSource = z.infer<typeof ProposalWithSourceSchema>;

/**
 * POST /proposals/:id/decision — the human decision written back.
 * Requirement 9 makes the decision itself a first-class event: actor,
 * measured duration, and a non-blank description of the review work are part
 * of the request, not an afterthought.
 */
export const ProposalDecisionRequestSchema = z.object({
  action: z.enum(["accept", "reject"]),
  actor: z.string().min(1).max(200),
  /** Optional reviewer note; lands in the decision event and task detail. */
  note: z.string().max(2000).optional(),
  /**
   * Measured active seconds the reviewer spent; null when not captured.
   * Bounded: a single review cannot honestly exceed a working day, and an
   * absurd asserted duration is exactly the requirement-4 "billable minute
   * for work that did not occur" — reject it rather than record it.
   */
  durationSeconds: z.number().int().min(0).max(28_800).nullable(),
  activityDescription: z
    .string()
    .max(4000)
    .refine((s) => s.trim().length > 0, "activity description cannot be blank"),
});
export type ProposalDecisionRequest = z.infer<
  typeof ProposalDecisionRequestSchema
>;

export const ProposalDecisionResponseSchema = z.object({
  proposal: ProposalSchema,
  decisionEventId: z.string().uuid(),
  /** Task created by an accepted task_creation proposal. */
  createdTaskId: z.string().uuid().nullable(),
  /** Fact verified by an accepted fact-shaped proposal (requirement 7). */
  verifiedFactId: z.string().uuid().nullable(),
  /** Prior active verified fact superseded by that verification. */
  supersededFactId: z.string().uuid().nullable(),
});
export type ProposalDecisionResponse = z.infer<
  typeof ProposalDecisionResponseSchema
>;

// ---------- WorkflowDefinition (plan section 9) ----------
// A workflow is a typed module, not a config language.
export interface WorkflowDefinition<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Unique registry name, e.g. "discharge-summary" */
  name: string;
  /** Event type that triggers this workflow, e.g. "DischargeReceived" */
  trigger: { eventType: string };
  /** Zod schema the model's extraction must satisfy */
  extractionSchema: TSchema;
  /** Deterministic validation; returns human-readable issues, empty = pass */
  validate: (extraction: z.infer<TSchema>) => string[];
  /** Ladder position; every new workflow ships at L1 (prepared) */
  autonomyLevel: AutonomyLevel;
  /** Relative path to this workflow's golden cases */
  goldensDir: string;
}
