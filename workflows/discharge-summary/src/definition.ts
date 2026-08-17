import type { AutonomyLevel, WorkflowDefinition } from "@nola/shared";
import { ExtractionSchema } from "./schema.js";
import { validateExtraction } from "./validate.js";

/**
 * Workflow #1: discharge-summary (plan weeks 1–2, built concretely).
 * Trigger: a DischargeReceived event carrying the document text verbatim.
 */

/** Change types a discharge-summary run may propose. */
export const CHANGE_TYPES = [
  "medication_change",
  "fact_proposal",
  "task_creation",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

/**
 * Per-change-type autonomy ceilings (decision 11). Everything ships at L1;
 * `medication_change` is the medication ceiling — it stays at L1 all year
 * regardless of eval scores, while the others may earn promotion.
 */
export const CHANGE_TYPE_CEILINGS: Record<ChangeType, AutonomyLevel> = {
  medication_change: "L1",
  fact_proposal: "L1",
  task_creation: "L1",
};

export const dischargeSummary: WorkflowDefinition<typeof ExtractionSchema> = {
  name: "discharge-summary",
  trigger: { eventType: "DischargeReceived" },
  extractionSchema: ExtractionSchema,
  validate: validateExtraction,
  autonomyLevel: "L1",
  goldensDir: "evals/goldens/discharge-summary",
};
