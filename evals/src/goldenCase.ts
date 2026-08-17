import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AUTONOMY_LEVELS } from "@nola/shared";
import { z } from "zod";

/**
 * Golden case format — the contract between a workflow's goldens directory
 * and the eval runner. The `expected.extraction` shape here is the v0
 * discharge-summary extraction schema; when the workflow factory lands
 * (weeks 4–5), per-workflow expected shapes migrate into workflow modules.
 */

export const SeveritySchema = z.enum(["critical", "major", "minor"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const RoutingSchema = z.enum(["quiet", "prepared", "judgment"]);
export type Routing = z.infer<typeof RoutingSchema>;

const FactRefSchema = z.object({
  entity: z.string(),
  attribute: z.string(),
});

const MedicationSchema = z.object({
  name: z.string(),
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  change: z.enum(["new", "continued", "changed", "stopped"]),
  changeDocumented: z.boolean(),
});

const FollowUpSchema = z.object({
  description: z.string(),
  with: z.string().nullable(),
  dueBy: z.string().nullable(),
  fullySpecified: z.boolean(),
});

export const ExtractionSchema = z.object({
  admission: z.object({
    facility: z.string(),
    admittedOn: z.string(),
    dischargedOn: z.string(),
    principalDiagnosis: z.string(),
  }),
  medications: z.array(MedicationSchema),
  medicationListComplete: z.boolean(),
  followUps: z.array(FollowUpSchema),
  pendingResults: z.array(z.unknown()),
  newDiagnoses: z.array(z.object({ label: z.string(), status: z.string() })),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

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
        summaryMustMention: z.array(z.string()).nonempty(),
        autonomyLevelMax: z.enum(AUTONOMY_LEVELS),
      }),
    ),
    routing: z.enum(["prepared", "judgment"]),
    mustNot: z.array(z.string()).nonempty(),
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
