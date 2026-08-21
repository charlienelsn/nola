import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AUTONOMY_LEVELS } from "@nola/shared";
import {
  type Extraction,
  ExtractionSchema,
} from "@nola/workflow-discharge-summary";
import { z } from "zod";

/**
 * Golden case format — the contract between a workflow's goldens directory
 * and the eval runner. The extraction shape lives in the workflow module
 * (`workflows/discharge-summary/src/schema.ts`, founder-reviewed) and is
 * imported here, so goldens are graded against the same typed schema the
 * Brain extracts against. When the workflow factory lands (weeks 4–5), the
 * per-workflow schema lookup generalizes; the envelope below stays.
 */

export const SeveritySchema = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RoutingSchema = z.enum(["quiet", "prepared", "judgment"]);
export type Routing = z.infer<typeof RoutingSchema>;

const FactRefSchema = z.object({
  entity: z.string(),
  attribute: z.string(),
});

export { ExtractionSchema };
export type { Extraction };

export const GoldenCaseSchema = z.object({
  name: z.string(),
  description: z.string(),
  severityFocus: SeveritySchema,
  tags: z.array(z.string()),
  member: z.object({
    memberId: z.string().uuid(),
    chosenName: z.string(),
    legalName: z.string(),
    dob: z.string(),
    primaryLanguage: z.string(),
    interpreterNeeded: z.boolean(),
    coverage: z.object({
      type: z.string(),
      planName: z.string().nullable(),
    }),
    currentFacts: z.array(
      z.object({
        entity: z.string(),
        attribute: z.string(),
        value: z.unknown(),
      }),
    ),
    caregivers: z.array(
      z.object({
        name: z.string(),
        relationship: z.string(),
        involvement: z.string(),
        preferredLanguage: z.string(),
      }),
    ),
  }),
  input: z.object({
    eventType: z.string(),
    source: z.string(),
    receivedAt: z.string(),
    document: z.string(),
  }),
  expected: z.object({
    identity: z.object({ matchesMember: z.boolean() }).passthrough(),
    extraction: ExtractionSchema.nullable(),
    contradictions: z.array(
      z.object({
        kind: z.string(),
        detail: z.string(),
        against: FactRefSchema,
      }),
    ),
    proposals: z.array(
      z.object({
        changeType: z.string(),
        /**
         * Phrases the proposal summary must carry. Matching is stemmed and
         * order-free (see score.ts); a string[] entry lists synonymous
         * alternatives, any one of which satisfies the slot.
         */
        summaryMustMention: z
          .array(
            z.union([z.string().min(1), z.array(z.string().min(1)).nonempty()]),
          )
          .nonempty(),
        autonomyLevelMax: z.enum(AUTONOMY_LEVELS),
      }),
    ),
    routing: z.enum(["prepared", "judgment"]),
    mustNot: z.array(z.string()).nonempty(),
    /**
     * Scorer-enforced subset of the mustNot prohibitions — violating one is
     * critical (README). The prose mustNot list above stays as review
     * guidance; entries here are the mechanically checkable ones, so the
     * "automatic critical" promise is real rather than a typed-but-unscored
     * field (mistakes log).
     */
    mustNotChecks: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("no-proposal-of-change-type"),
            changeType: z.string(),
          }),
          z.object({
            type: z.literal("proposal-summaries-must-not-contain"),
            text: z.string().min(1),
          }),
        ]),
      )
      .optional(),
  }),
});
export type GoldenCase = z.infer<typeof GoldenCaseSchema>;

/**
 * What a workflow run must produce to be graded. The Brain's discharge-summary
 * runner returns this; stored results files map case name -> this shape.
 */
export const RunResultSchema = z.object({
  identity: z.object({ matchesMember: z.boolean() }),
  extraction: ExtractionSchema.nullable(),
  contradictions: z.array(
    z.object({ detail: z.string(), against: FactRefSchema }),
  ),
  proposals: z.array(
    z.object({
      changeType: z.string(),
      summary: z.string(),
      autonomyLevel: z.enum(AUTONOMY_LEVELS),
    }),
  ),
  routing: RoutingSchema,
});
export type RunResult = z.infer<typeof RunResultSchema>;

export interface WorkflowGoldens {
  workflow: string;
  cases: GoldenCase[];
}

/** Load and validate every workflow's goldens. Throws on any invalid case. */
export function loadGoldens(goldensRoot: string): WorkflowGoldens[] {
  const workflows = readdirSync(goldensRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  return workflows.map((workflow) => {
    const dir = join(goldensRoot, workflow);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const cases = files.map((file) => {
      const raw: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
      const parsed = GoldenCaseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `${workflow}/${file} is not a valid golden case:\n${parsed.error.message}`,
        );
      }
      const expectedName = file.replace(/\.json$/, "");
      if (parsed.data.name !== expectedName) {
        throw new Error(
          `${workflow}/${file}: name "${parsed.data.name}" must match filename`,
        );
      }
      return parsed.data;
    });
    return { workflow, cases };
  });
}
