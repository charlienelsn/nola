import type { Extraction } from "./schema.js";

/**
 * Deterministic validation and routing for discharge-summary extractions
 * (founder-reviewed; CODEOWNERS). No model calls, no I/O — pure checks the
 * Brain runs after the extraction parses and before anything routes.
 *
 * `validateExtraction` returns human-readable internal-consistency issues;
 * empty means the extraction is coherent (not that it is correct — the eval
 * harness judges correctness against the goldens). `routeExtraction` encodes
 * the routing defaults the ten goldens agree on.
 *
 * ISO dates compare lexicographically, so plain string comparison is safe
 * and keeps this free of timezone parsing.
 */

const normalizeName = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

export function validateExtraction(extraction: Extraction): string[] {
  const issues: string[] = [];
  const { admission, medications, followUps } = extraction;

  if (admission.dischargedOn < admission.admittedOn) {
    issues.push(
      `discharged (${admission.dischargedOn}) before admitted (${admission.admittedOn})`,
    );
  }

  const seen = new Set<string>();
  for (const med of medications) {
    const key = normalizeName(med.name);
    if (seen.has(key)) {
      issues.push(`duplicate medication entry: ${med.name}`);
    }
    seen.add(key);

    // A start or dose change without the dose is unactionable — nothing to
    // propose for human review. Stops legitimately carry no dose.
    if (med.change === "new" || med.change === "changed") {
      if (med.dose === null) {
        issues.push(`${med.change} medication ${med.name} has no dose`);
      }
      if (med.frequency === null) {
        issues.push(`${med.change} medication ${med.name} has no frequency`);
      }
    }
  }

  for (const followUp of followUps) {
    if (
      followUp.fullySpecified &&
      (followUp.with === null || followUp.dueBy === null)
    ) {
      issues.push(
        `follow-up "${followUp.description}" marked fully specified without ` +
          `${followUp.with === null ? "an owner" : "a due date"}`,
      );
    }
    if (followUp.dueBy !== null && followUp.dueBy < admission.dischargedOn) {
      issues.push(
        `follow-up "${followUp.description}" due ${followUp.dueBy}, before discharge`,
      );
    }
  }

  return issues;
}

/**
 * Routing defaults, derived from the goldens: `prepared` is the norm;
 * `judgment` when the run itself cannot be trusted to have a clean story —
 * internal inconsistencies, an undocumented medication change (the document
 * changed something and never said why), or a handover with follow-up
 * threads but not one of them actionable. Documented changes and surfaced
 * contradictions stay `prepared`: that is exactly what human review is for.
 *
 * Never `quiet`: at L1 every run is human-reviewed (severity rubric —
 * quiet routing is an automatic critical). Identity mismatches are the
 * Brain's guard, upstream of extraction; there is no extraction to route.
 */
export function routeExtraction(
  extraction: Extraction,
  issues: string[],
): "prepared" | "judgment" {
  if (issues.length > 0) return "judgment";

  const undocumentedChange = extraction.medications.some(
    (med) => med.change !== "continued" && !med.changeDocumented,
  );
  if (undocumentedChange) return "judgment";

  const { followUps } = extraction;
  if (followUps.length > 0 && !followUps.some((f) => f.fullySpecified)) {
    return "judgment";
  }

  return "prepared";
}
