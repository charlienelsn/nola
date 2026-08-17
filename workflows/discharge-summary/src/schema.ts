import { z } from "zod";

/**
 * discharge-summary extraction schema — the typed contract the model's
 * extraction must satisfy (founder-reviewed; CODEOWNERS).
 *
 * The shape was derived from the ten golden cases in
 * `evals/goldens/discharge-summary/`, which the eval harness grades against
 * this schema. Change the schema and the goldens together or not at all.
 *
 * Normalization conventions (the goldens encode these; the scorer's string
 * comparisons depend on them):
 * - Dates are ISO `YYYY-MM-DD`. Source documents write `MM/DD/YYYY`;
 *   extraction converts. Relative windows ("within 14 days") anchor at
 *   `dischargedOn`.
 * - Frequencies are plain lowercase English, clinical shorthand expanded:
 *   "BID" -> "twice daily", "QD" -> "daily", "nightly", "every morning".
 * - Doses keep the unit with a space: "40 mg", "20 units".
 * - OCR noise (digit/letter substitutions in faxed documents) is repaired,
 *   never extracted verbatim.
 */

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD) required");

/**
 * One medication the discharge document starts, changes, stops, or —
 * for medications in the member's verified regimen — continues or omits.
 * Unchanged medications with no corresponding verified fact may be left out;
 * the scorer requires the expected set, extras are not penalized.
 */
export const MedicationExtractionSchema = z.object({
  name: z.string(),
  /** Null when the document states no dose (e.g. a bare DISCONTINUED line). */
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  /** Relative to the member's regimen going into the admission. */
  change: z.enum(["new", "continued", "changed", "stopped"]),
  /**
   * True only when the document accounts for this disposition: an explicit
   * continuation, or a stated reason for a start/change/stop. A bare NEW or
   * DISCONTINUED marker with no reasoning is not documentation — and a
   * verified med silently absent from the list is `stopped` with
   * `changeDocumented: false`, surfaced as a contradiction, never resolved.
   */
  changeDocumented: z.boolean(),
});
export type MedicationExtraction = z.infer<typeof MedicationExtractionSchema>;

/**
 * A commitment the handover makes after discharge: appointments, labs,
 * home-health visits, DME deliveries, supply arrangements.
 */
export const FollowUpSchema = z.object({
  description: z.string(),
  /** Named owner (provider, clinic, lab, agency) or null when unowned. */
  with: z.string().nullable(),
  /** ISO date; computed from relative windows, null when undated. */
  dueBy: IsoDateSchema.nullable(),
  /**
   * True only when the thread is actionable as handed over: a named owner,
   * a concrete date, and the arrangement actually made (appointment
   * scheduled, order placed). "Member to schedule" is not fully specified
   * even when an owner and window are named.
   */
  fullySpecified: z.boolean(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

/**
 * A result still outstanding at discharge that someone must chase — the
 * classic dropped thread in the handover-failure taxonomy. No golden
 * exercises this yet; the shape is typed so the first one that does cannot
 * land as an untyped blob.
 */
export const PendingResultSchema = z.object({
  description: z.string(),
  /** Who receives the result, or null when the document does not say. */
  resultsTo: z.string().nullable(),
  expectedBy: IsoDateSchema.nullable(),
});
export type PendingResult = z.infer<typeof PendingResultSchema>;

export const ExtractionSchema = z.object({
  admission: z.object({
    facility: z.string(),
    admittedOn: IsoDateSchema,
    dischargedOn: IsoDateSchema,
    principalDiagnosis: z.string(),
  }),
  medications: z.array(MedicationExtractionSchema),
  /**
   * True only when the document enumerates a reconciled list that accounts
   * for the member's known regimen. "All other home meds continued" without
   * the list, or a list missing a verified med, is incomplete.
   */
  medicationListComplete: z.boolean(),
  followUps: z.array(FollowUpSchema),
  pendingResults: z.array(PendingResultSchema),
  /** Diagnoses new to the member (absent from current verified facts). */
  newDiagnoses: z.array(z.object({ label: z.string(), status: z.string() })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
