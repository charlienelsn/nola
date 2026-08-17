import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { type GoldenCase, type RunResult, loadGoldens } from "./goldenCase.js";
import { scoreCase, summarizeCase } from "./score.js";

const goldensRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "goldens",
);

/**
 * Derive the run result a flawless workflow run would produce for a golden:
 * the expected extraction verbatim, every expected contradiction surfaced,
 * every expected proposal emitted at L1 with all required mentions.
 */
function perfectResult(golden: GoldenCase): RunResult {
  // Deep-clone so mutation-based tests never touch the golden itself.
  const e = structuredClone(golden.expected);
  return {
    identity: { matchesMember: e.identity.matchesMember },
    extraction: e.extraction,
    contradictions: e.contradictions.map((c) => ({
      detail: c.detail,
      against: c.against,
    })),
    proposals: e.proposals.map((p) => ({
      changeType: p.changeType,
      summary: `[synthetic] ${p.summaryMustMention.join(" — ")}`,
      autonomyLevel: "L1" as const,
    })),
    routing: e.routing,
  };
}

let cases: GoldenCase[];

beforeAll(() => {
  const all = loadGoldens(goldensRoot);
  const ds = all.find((w) => w.workflow === "discharge-summary");
  if (!ds) throw new Error("discharge-summary goldens not found");
  cases = ds.cases;
});

function byName(name: string): GoldenCase {
  const c = cases.find((g) => g.name === name);
  if (!c) throw new Error(`golden ${name} not found`);
  return c;
}

describe("golden case loading", () => {
  it("loads ten valid discharge-summary cases", () => {
    expect(cases).toHaveLength(10);
  });

  it("caps every expected proposal at L1", () => {
    for (const c of cases) {
      for (const p of c.expected.proposals) {
        expect(p.autonomyLevelMax).toBe("L1");
      }
    }
  });
});

describe("scoring a flawless run", () => {
  it("passes every case with zero findings", () => {
    for (const golden of cases) {
      const findings = scoreCase(golden, perfectResult(golden));
      expect(findings, golden.name).toEqual([]);
      expect(summarizeCase(golden, findings).pass).toBe(true);
    }
  });
});

describe("severity rubric", () => {
  it("flags a wrong medication dose as critical", () => {
    const golden = byName("03-dose-change-buried");
    const result = perfectResult(golden);
    if (result.extraction === null) throw new Error("unexpected");
    const lisinopril = result.extraction.medications.find(
      (m) => m.name === "Lisinopril",
    );
    if (!lisinopril) throw new Error("unexpected");
    lisinopril.dose = "10 mg"; // the exact failure this golden exists to catch
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "critical" && f.code === "wrong-medication-fact",
      ),
    ).toBe(true);
  });

  it("flags a missed contradiction as major", () => {
    const golden = byName("04-omitted-home-med");
    const result = perfectResult(golden);
    result.contradictions = [];
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "major" && f.code === "missed-contradiction",
      ),
    ).toBe(true);
  });

  it("flags a dropped task as major", () => {
    const golden = byName("10-multi-agency-coordination");
    const result = perfectResult(golden);
    result.proposals = result.proposals.filter(
      (p) => !p.summary.includes("SNAP"),
    );
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "major" && f.code === "dropped-proposal",
      ),
    ).toBe(true);
  });

  it("flags any write from a wrong-member document as critical", () => {
    const golden = byName("07-wrong-member-document");
    const result = perfectResult(golden);
    result.proposals.push({
      changeType: "medication_change",
      summary: "Cephalexin 500 mg new",
      autonomyLevel: "L1",
    });
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "critical" && f.code === "wrong-member-write",
      ),
    ).toBe(true);
  });

  it("flags extraction from a wrong-member document as critical", () => {
    const golden = byName("07-wrong-member-document");
    const clean = byName("01-clean-routine-discharge");
    const result = perfectResult(golden);
    result.extraction = clean.expected.extraction;
    const findings = scoreCase(golden, result);
    expect(findings.some((f) => f.code === "wrong-member-extraction")).toBe(
      true,
    );
  });

  it("flags quiet routing as critical at L1", () => {
    const golden = byName("01-clean-routine-discharge");
    const result = perfectResult(golden);
    result.routing = "quiet";
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "critical" && f.code === "quiet-at-l1",
      ),
    ).toBe(true);
  });

  it("flags a proposal above its ceiling as critical", () => {
    const golden = byName("02-new-medication-started");
    const result = perfectResult(golden);
    const med = result.proposals.find(
      (p) => p.changeType === "medication_change",
    );
    if (!med) throw new Error("unexpected");
    med.autonomyLevel = "L2";
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) =>
          f.severity === "critical" && f.code === "autonomy-ceiling-breach",
      ),
    ).toBe(true);
  });

  it("treats missed escalation as major and over-escalation as minor", () => {
    const shouldEscalate = byName("06-unexplained-med-stop");
    const missed = perfectResult(shouldEscalate);
    missed.routing = "prepared";
    expect(
      scoreCase(shouldEscalate, missed).some(
        (f) => f.severity === "major" && f.code === "missed-escalation",
      ),
    ).toBe(true);

    const clean = byName("01-clean-routine-discharge");
    const over = perfectResult(clean);
    over.routing = "judgment";
    const findings = scoreCase(clean, over);
    expect(
      findings.some(
        (f) => f.severity === "minor" && f.code === "over-escalation",
      ),
    ).toBe(true);
    expect(summarizeCase(clean, findings).pass).toBe(true);
  });

  it("flags a missing follow-up as major", () => {
    const golden = byName("05-vague-followup");
    const result = perfectResult(golden);
    if (result.extraction === null) throw new Error("unexpected");
    result.extraction = {
      ...result.extraction,
      followUps: result.extraction.followUps.slice(1),
    };
    const findings = scoreCase(golden, result);
    expect(
      findings.some(
        (f) => f.severity === "major" && f.code === "missing-follow-up",
      ),
    ).toBe(true);
  });

  it("reports extra proposals as minor noise, still passing", () => {
    const golden = byName("01-clean-routine-discharge");
    const result = perfectResult(golden);
    result.proposals.push({
      changeType: "task_creation",
      summary: "Check in about the weather",
      autonomyLevel: "L1",
    });
    const findings = scoreCase(golden, result);
    expect(findings.map((f) => f.code)).toEqual(["extra-proposal"]);
    expect(summarizeCase(golden, findings).pass).toBe(true);
  });
});
