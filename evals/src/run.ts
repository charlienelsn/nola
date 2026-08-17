import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RunResultSchema, loadGoldens } from "./goldenCase.js";
import { type Finding, scoreCase, summarizeCase } from "./score.js";

/**
 * Eval harness — regression runner over per-workflow golden cases
 * (plan section 11). Two modes:
 *
 *   validate (default, model-free, runs in CI on every PR):
 *     every golden case must parse against the golden-case contract.
 *
 *   grade (--results <file>): grade stored workflow-run results against the
 *     goldens. The results file maps case name -> RunResult; the Brain's
 *     runner writes one when it executes the goldens against a model.
 *
 * Exit codes: 0 clean; 1 structural failure, missing result, or any
 * critical/major finding. Minors are reported, not fatal.
 */

const here = dirname(fileURLToPath(import.meta.url));
const goldensRoot = resolve(here, "..", "goldens");

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const workflowFilter = flag("workflow");
const resultsPath = flag("results");
const asJson = args.includes("--json");

const all = loadGoldens(goldensRoot).filter(
  (w) => workflowFilter === undefined || w.workflow === workflowFilter,
);

if (all.length === 0) {
  console.error(
    workflowFilter
      ? `No goldens found for workflow "${workflowFilter}".`
      : "No golden cases found. Every workflow is born with ten goldens.",
  );
  process.exit(1);
}

if (resultsPath === undefined) {
  for (const w of all) {
    const bySeverity = { critical: 0, major: 0, minor: 0 };
    for (const c of w.cases) bySeverity[c.severityFocus] += 1;
    console.log(
      `${w.workflow}: ${w.cases.length} golden cases valid ` +
        `(severity focus: ${bySeverity.critical} critical, ${bySeverity.major} major, ${bySeverity.minor} minor)`,
    );
    if (w.cases.length < 10) {
      console.error(
        `${w.workflow}: only ${w.cases.length} cases — every workflow is born with ten goldens.`,
      );
      process.exit(1);
    }
  }
  console.log(
    "Structural validation passed. Grade a model run with --results <file>.",
  );
  process.exit(0);
}

const ResultsFileSchema = z.record(z.string(), RunResultSchema);
const results = ResultsFileSchema.parse(
  JSON.parse(readFileSync(resolve(resultsPath), "utf8")),
);

let missing = 0;
const scores = all.flatMap((w) =>
  w.cases.map((golden) => {
    const result = results[golden.name];
    if (result === undefined) {
      missing += 1;
      const finding: Finding = {
        caseName: golden.name,
        severity: "major",
        code: "missing-result",
        detail: `no result for ${w.workflow}/${golden.name} in ${resultsPath}`,
      };
      return summarizeCase(golden, [finding]);
    }
    return summarizeCase(golden, scoreCase(golden, result));
  }),
);

const findings = scores.flatMap((s) => s.findings);
const totals = {
  cases: scores.length,
  passed: scores.filter((s) => s.pass).length,
  critical: findings.filter((f) => f.severity === "critical").length,
  major: findings.filter((f) => f.severity === "major").length,
  minor: findings.filter((f) => f.severity === "minor").length,
};

if (asJson) {
  console.log(JSON.stringify({ totals, scores }, null, 2));
} else {
  for (const s of scores) {
    const mark = s.pass ? "PASS" : "FAIL";
    console.log(`${mark}  ${s.caseName}`);
    for (const f of s.findings) {
      console.log(`      [${f.severity}] ${f.code}: ${f.detail}`);
    }
  }
  const missingNote = missing > 0 ? ` (${missing} missing results)` : "";
  console.log(
    `\n${totals.passed}/${totals.cases} cases passed — ${totals.critical} critical, ${totals.major} major, ${totals.minor} minor${missingNote}`,
  );
  if (totals.critical > 0) {
    console.log(
      "Any critical error demotes the workflow to L1 (severity rubric).",
    );
  }
}

process.exit(totals.critical > 0 || totals.major > 0 ? 1 : 0);
