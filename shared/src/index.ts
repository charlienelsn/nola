import { z } from "zod";

/**
 * @nola/shared — member ontology types and API contract types.
 * Founder-owned (CODEOWNERS). Workflows consume this ontology; they never mutate it.
 */

// ---------- Autonomy ladder (plan section 12) ----------
export const AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

// ---------- Member ontology v0 ----------
export const MemberSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  dob: z.string(), // ISO date; refine when the ontology hardens
  createdAt: z.string(),
});
export type Member = z.infer<typeof MemberSchema>;

// ---------- Fact status lifecycle (plan section 3) ----------
export const FACT_STATUSES = [
  "proposed",
  "verified",
  "superseded",
  "retracted",
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

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
