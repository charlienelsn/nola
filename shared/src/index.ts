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
