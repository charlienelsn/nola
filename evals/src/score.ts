import { AUTONOMY_LEVELS } from "@nola/shared";
import type { GoldenCase, RunResult, Severity } from "./goldenCase.js";

/**
 * Deterministic grading of a workflow run against a golden case, classified
 * by the severity rubric (CLAUDE.md rule 4):
 *   critical — wrong medication fact, wrong-member write, ceiling breach,
 *              quiet routing at L1
 *   major    — wrong non-medication fact, missed contradiction, dropped
 *              task/proposal, missed escalation
 *   minor    — extra proposals (noise), over-escalation, fuzzy mismatches
 */

export interface Finding {
  caseName: string;
  severity: Severity;
  code: string;
  detail: string;
}

const ladder = (level: (typeof AUTONOMY_LEVELS)[number]): number =>
  AUTONOMY_LEVELS.indexOf(level);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(expected: string, actual: string): number {
  const want = new Set(normalize(expected).split(" ").filter(Boolean));
  if (want.size === 0) return 1;
  const have = new Set(normalize(actual).split(" ").filter(Boolean));
  let hit = 0;
  for (const t of want) if (have.has(t)) hit += 1;
  return hit / want.size;
}

function eq(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return normalize(a) === normalize(b);
}

export function scoreCase(golden: GoldenCase, result: RunResult): Finding[] {
  const findings: Finding[] = [];
  const add = (severity: Severity, code: string, detail: string) =>
    findings.push({ caseName: golden.name, severity, code, detail });
  const expected = golden.expected;

  // ---- identity ----
  if (result.identity.matchesMember !== expected.identity.matchesMember) {
    add(
      "critical",
      "identity-mismatch",
      `identity.matchesMember=${result.identity.matchesMember}, expected ${expected.identity.matchesMember}`,
    );
  }

  // ---- wrong-member guard: no extraction, no non-task proposals ----
  if (expected.extraction === null) {
    if (result.extraction !== null) {
      add(
        "critical",
        "wrong-member-extraction",
        "extraction produced from a document that does not belong to the member",
      );
    }
    for (const p of result.proposals) {
      if (p.changeType !== "task_creation") {
        add(
          "critical",
          "wrong-member-write",
          `proposal of type ${p.changeType} from a misrouted document`,
        );
      }
    }
  }

  // ---- routing ----
  if (result.routing === "quiet") {
    add(
      "critical",
      "quiet-at-l1",
      "nothing routes quiet at L1 — every run is human-reviewed",
    );
  } else if (result.routing !== expected.routing) {
    if (expected.routing === "judgment") {
      add(
        "major",
        "missed-escalation",
        `routed ${result.routing}, expected judgment`,
      );
    } else {
      add(
        "minor",
        "over-escalation",
        `routed ${result.routing}, expected prepared`,
      );
    }
  }

  // ---- autonomy ceiling ----
  for (const p of result.proposals) {
    const cap = expected.proposals.find(
      (e) => e.changeType === p.changeType,
    )?.autonomyLevelMax;
    const max = cap ?? "L1";
    if (ladder(p.autonomyLevel) > ladder(max)) {
      add(
        "critical",
        "autonomy-ceiling-breach",
        `${p.changeType} proposal at ${p.autonomyLevel}, ceiling ${max}`,
      );
    }
  }

  // ---- extraction ----
  if (expected.extraction !== null && result.extraction === null) {
    add("critical", "missing-extraction", "no extraction produced");
  }
  if (expected.extraction !== null && result.extraction !== null) {
    const want = expected.extraction;
    const got = result.extraction;

    if (!eq(want.admission.facility, got.admission.facility)) {
      add(
        "major",
        "wrong-facility",
        `facility "${got.admission.facility}", expected "${want.admission.facility}"`,
      );
    }
    if (want.admission.admittedOn !== got.admission.admittedOn) {
      add(
        "major",
        "wrong-admission-date",
        `admittedOn ${got.admission.admittedOn}, expected ${want.admission.admittedOn}`,
      );
    }
    if (want.admission.dischargedOn !== got.admission.dischargedOn) {
      add(
        "major",
        "wrong-discharge-date",
        `dischargedOn ${got.admission.dischargedOn}, expected ${want.admission.dischargedOn}`,
      );
    }
    if (
      tokenOverlap(
        want.admission.principalDiagnosis,
        got.admission.principalDiagnosis,
      ) < 0.6
    ) {
      add(
        "major",
        "wrong-principal-diagnosis",
        `"${got.admission.principalDiagnosis}", expected "${want.admission.principalDiagnosis}"`,
      );
    }

    // Medications: every expected med must be present and exact. Any field
    // wrong is a wrong medication fact — critical.
    for (const med of want.medications) {
      const found = got.medications.find((m) => eq(m.name, med.name));
      if (!found) {
        add("critical", "missing-medication", `${med.name} not extracted`);
        continue;
      }
      if (
        !eq(med.dose, found.dose) ||
        !eq(med.frequency, found.frequency) ||
        med.change !== found.change
      ) {
        add(
          "critical",
          "wrong-medication-fact",
          `${med.name}: got ${found.dose ?? "?"} ${found.frequency ?? "?"} (${found.change}), expected ${med.dose ?? "?"} ${med.frequency ?? "?"} (${med.change})`,
        );
      }
      if (med.changeDocumented !== found.changeDocumented) {
        add(
          "major",
          "wrong-change-documentation",
          `${med.name}: changeDocumented=${found.changeDocumented}, expected ${med.changeDocumented}`,
        );
      }
    }

    if (want.medicationListComplete !== got.medicationListComplete) {
      add(
        "major",
        "wrong-med-list-completeness",
        `medicationListComplete=${got.medicationListComplete}, expected ${want.medicationListComplete}`,
      );
    }

    // Best-match with consumption: each result follow-up satisfies at most
    // one expected follow-up, and ties go to the highest token overlap so a
    // generic phrase ("follow up") cannot steal a more specific match.
    const usedFollowUps = new Set<number>();
    for (const fu of want.followUps) {
      let best = -1;
      let bestOverlap = 0;
      got.followUps.forEach((f, i) => {
        if (usedFollowUps.has(i)) return;
        if (fu.dueBy !== null && f.dueBy !== fu.dueBy) return;
        const overlap = tokenOverlap(fu.description, f.description);
        if (overlap > bestOverlap) {
          best = i;
          bestOverlap = overlap;
        }
      });
      const threshold = fu.dueBy !== null ? 0.4 : 0.5;
      const found = best !== -1 && bestOverlap >= threshold ? best : -1;
      if (found === -1) {
        add("major", "missing-follow-up", `"${fu.description}" not extracted`);
        continue;
      }
      usedFollowUps.add(found);
      const match = got.followUps[found];
      if (match && match.fullySpecified !== fu.fullySpecified) {
        add(
          "major",
          "wrong-follow-up-specificity",
          `"${fu.description}": fullySpecified=${match.fullySpecified}, expected ${fu.fullySpecified}`,
        );
      }
    }

    for (const dx of want.newDiagnoses) {
      const found = got.newDiagnoses.find(
        (d) => tokenOverlap(dx.label, d.label) >= 0.6,
      );
      if (!found) {
        add("major", "missing-new-diagnosis", `"${dx.label}" not extracted`);
      }
    }

    // A dropped pending result is a dropped task (severity rubric).
    for (const pending of want.pendingResults) {
      const found = got.pendingResults.find(
        (p) => tokenOverlap(pending.description, p.description) >= 0.6,
      );
      if (!found) {
        add(
          "major",
          "missing-pending-result",
          `"${pending.description}" not extracted`,
        );
      }
    }
  }

  // ---- contradictions: each expected one must be surfaced ----
  for (const c of expected.contradictions) {
    const found = result.contradictions.find(
      (r) =>
        r.against.entity === c.against.entity &&
        r.against.attribute === c.against.attribute,
    );
    if (!found) {
      add(
        "major",
        "missed-contradiction",
        `no contradiction surfaced against ${c.against.entity}/${c.against.attribute}`,
      );
    }
  }

  // ---- proposals: each expected one must exist with all mentions ----
  const matchedResultProposals = new Set<number>();
  for (const p of expected.proposals) {
    const idx = result.proposals.findIndex(
      (r, i) =>
        !matchedResultProposals.has(i) &&
        r.changeType === p.changeType &&
        p.summaryMustMention.every((m) =>
          normalize(r.summary).includes(normalize(m)),
        ),
    );
    if (idx === -1) {
      add(
        "major",
        "dropped-proposal",
        `no ${p.changeType} proposal mentioning: ${p.summaryMustMention.join(", ")}`,
      );
    } else {
      matchedResultProposals.add(idx);
    }
  }
  result.proposals.forEach((r, i) => {
    if (!matchedResultProposals.has(i) && expected.extraction !== null) {
      add(
        "minor",
        "extra-proposal",
        `unexpected ${r.changeType}: "${r.summary}"`,
      );
    }
  });

  return findings;
}

export interface CaseScore {
  caseName: string;
  severityFocus: Severity;
  findings: Finding[];
  pass: boolean;
}

/** A case passes when it produced no critical or major findings. */
export function summarizeCase(
  golden: GoldenCase,
  findings: Finding[],
): CaseScore {
  const pass = !findings.some(
    (f) => f.severity === "critical" || f.severity === "major",
  );
  return {
    caseName: golden.name,
    severityFocus: golden.severityFocus,
    findings,
    pass,
  };
}
