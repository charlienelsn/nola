import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTONOMY_LEVELS } from "@nola/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CHANGE_TYPE_CEILINGS, dischargeSummary } from "./definition.js";
import { routeExtraction, validateExtraction } from "./validate.js";

/**
 * The contract test that makes the goldens and this module one system:
 * every golden's expected extraction must parse against the typed schema,
 * validate with zero issues, and route the way the golden says. If either
 * side drifts, this fails before any model run does.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const goldensDir = resolve(repoRoot, dischargeSummary.goldensDir);

// Only the envelope this test needs — the full golden-case contract lives
// in @nola/evals, which depends on this package (not the other way around).
const GoldenEnvelopeSchema = z.object({
  name: z.string(),
  expected: z.object({
    extraction: z.unknown(),
    routing: z.enum(["prepared", "judgment"]),
  }),
});

const goldens = readdirSync(goldensDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) =>
    GoldenEnvelopeSchema.parse(
      JSON.parse(readFileSync(join(goldensDir, file), "utf8")),
    ),
  );

describe("workflow definition", () => {
  it("is the discharge-summary workflow, triggered by DischargeReceived", () => {
    expect(dischargeSummary.name).toBe("discharge-summary");
    expect(dischargeSummary.trigger.eventType).toBe("DischargeReceived");
  });

  it("ships at L1, like every newborn workflow", () => {
    expect(dischargeSummary.autonomyLevel).toBe("L1");
  });

  it("caps every change type at L1 — the medication ceiling included", () => {
    for (const ceiling of Object.values(CHANGE_TYPE_CEILINGS)) {
      expect(AUTONOMY_LEVELS.indexOf(ceiling)).toBeLessThanOrEqual(
        AUTONOMY_LEVELS.indexOf("L1"),
      );
    }
    expect(CHANGE_TYPE_CEILINGS.medication_change).toBe("L1");
  });

  it("was born with ten goldens", () => {
    expect(goldens).toHaveLength(10);
  });
});

describe("goldens against the typed schema", () => {
  it("parses every expected extraction", () => {
    for (const golden of goldens) {
      if (golden.expected.extraction === null) continue;
      const parsed = dischargeSummary.extractionSchema.safeParse(
        golden.expected.extraction,
      );
      expect(parsed.success, `${golden.name}: ${JSON.stringify(parsed)}`).toBe(
        true,
      );
    }
  });

  it("finds zero validation issues in any expected extraction", () => {
    for (const golden of goldens) {
      if (golden.expected.extraction === null) continue;
      const extraction = dischargeSummary.extractionSchema.parse(
        golden.expected.extraction,
      );
      expect(validateExtraction(extraction), golden.name).toEqual([]);
    }
  });

  it("routes every expected extraction the way its golden expects", () => {
    for (const golden of goldens) {
      // The wrong-member golden has no extraction; its judgment routing
      // comes from the Brain's identity guard, upstream of this module.
      if (golden.expected.extraction === null) continue;
      const extraction = dischargeSummary.extractionSchema.parse(
        golden.expected.extraction,
      );
      const issues = validateExtraction(extraction);
      expect(routeExtraction(extraction, issues), golden.name).toBe(
        golden.expected.routing,
      );
    }
  });
});
