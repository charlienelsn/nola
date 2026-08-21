import { describe, expect, it } from "vitest";
import type { Extraction } from "./schema.js";
import { routeExtraction, validateExtraction } from "./validate.js";

/** A coherent baseline extraction; each test breaks exactly one thing. */
function baseExtraction(): Extraction {
  return {
    admission: {
      facility: "Synthetic General Hospital",
      admittedOn: "2026-08-01",
      dischargedOn: "2026-08-04",
      principalDiagnosis: "Community-acquired pneumonia",
    },
    medications: [
      {
        name: "Cefpodoxime",
        dose: "200 mg",
        frequency: "twice daily",
        change: "new",
        changeDocumented: true,
      },
    ],
    medicationListComplete: true,
    followUps: [
      {
        description: "PCP visit",
        with: "Dr. Example",
        dueBy: "2026-08-11",
        fullySpecified: true,
      },
    ],
    pendingResults: [],
    newDiagnoses: [],
  };
}

describe("validateExtraction", () => {
  it("passes a coherent extraction", () => {
    expect(validateExtraction(baseExtraction())).toEqual([]);
  });

  it("passes a stop with no regimen, flags a stop carrying one", () => {
    const e = baseExtraction();
    e.medications.push({
      name: "Insulin glargine",
      dose: null,
      frequency: null,
      change: "stopped",
      changeDocumented: false,
    });
    expect(validateExtraction(e)).toEqual([]);
    const carried = e.medications[1];
    if (!carried) throw new Error("unexpected");
    carried.dose = "20 units";
    carried.frequency = "nightly";
    expect(validateExtraction(e)).toEqual([
      "stopped medication Insulin glargine carries a regimen " +
        "(20 units nightly) — record the stop; prior values belong to the verified fact",
    ]);
  });

  it("flags discharge before admission", () => {
    const e = baseExtraction();
    e.admission.dischargedOn = "2026-07-30";
    expect(validateExtraction(e)).toEqual([
      "discharged (2026-07-30) before admitted (2026-08-01)",
    ]);
  });

  it("flags duplicate medication entries, ignoring case and spacing", () => {
    const e = baseExtraction();
    e.medications.push({
      name: "  CEFPODOXIME ",
      dose: "200 mg",
      frequency: "twice daily",
      change: "new",
      changeDocumented: true,
    });
    expect(validateExtraction(e)).toEqual([
      "duplicate medication entry:   CEFPODOXIME ",
    ]);
  });

  it("flags a new or changed medication without dose or frequency", () => {
    const e = baseExtraction();
    const med = e.medications[0];
    if (!med) throw new Error("unexpected");
    med.change = "changed";
    med.dose = null;
    med.frequency = null;
    expect(validateExtraction(e)).toEqual([
      "changed medication Cefpodoxime has no dose",
      "changed medication Cefpodoxime has no frequency",
    ]);
  });

  it("accepts a stopped medication without dose or frequency", () => {
    const e = baseExtraction();
    e.medications.push({
      name: "Metformin",
      dose: null,
      frequency: null,
      change: "stopped",
      changeDocumented: false,
    });
    expect(validateExtraction(e)).toEqual([]);
  });

  it("flags fullySpecified follow-ups missing an owner or a due date", () => {
    const e = baseExtraction();
    const followUp = e.followUps[0];
    if (!followUp) throw new Error("unexpected");
    followUp.with = null;
    expect(validateExtraction(e)).toEqual([
      'follow-up "PCP visit" marked fully specified without an owner',
    ]);
    followUp.with = "Dr. Example";
    followUp.dueBy = null;
    expect(validateExtraction(e)).toEqual([
      'follow-up "PCP visit" marked fully specified without a due date',
    ]);
  });

  it("flags a follow-up due before discharge", () => {
    const e = baseExtraction();
    const followUp = e.followUps[0];
    if (!followUp) throw new Error("unexpected");
    followUp.dueBy = "2026-08-03";
    expect(validateExtraction(e)).toEqual([
      'follow-up "PCP visit" due 2026-08-03, before discharge',
    ]);
  });

  it("accepts a follow-up due on the discharge date itself", () => {
    const e = baseExtraction();
    const followUp = e.followUps[0];
    if (!followUp) throw new Error("unexpected");
    followUp.dueBy = "2026-08-04";
    expect(validateExtraction(e)).toEqual([]);
  });
});

describe("routeExtraction", () => {
  it("routes a clean, documented extraction prepared", () => {
    expect(routeExtraction(baseExtraction(), [])).toBe("prepared");
  });

  it("escalates on any validation issue", () => {
    expect(routeExtraction(baseExtraction(), ["anything"])).toBe("judgment");
  });

  it("escalates an undocumented medication change", () => {
    const e = baseExtraction();
    const med = e.medications[0];
    if (!med) throw new Error("unexpected");
    med.changeDocumented = false;
    expect(routeExtraction(e, [])).toBe("judgment");
  });

  it("does not escalate an undocumented continuation", () => {
    const e = baseExtraction();
    const med = e.medications[0];
    if (!med) throw new Error("unexpected");
    med.change = "continued";
    med.changeDocumented = false;
    expect(routeExtraction(e, [])).toBe("prepared");
  });

  it("escalates when follow-ups exist but none is actionable", () => {
    const e = baseExtraction();
    e.followUps = [
      {
        description: "Follow up with pulmonology",
        with: null,
        dueBy: null,
        fullySpecified: false,
      },
      {
        description: "Repeat labs",
        with: null,
        dueBy: null,
        fullySpecified: false,
      },
    ];
    expect(routeExtraction(e, [])).toBe("judgment");
  });

  it("stays prepared when at least one follow-up is actionable", () => {
    const e = baseExtraction();
    e.followUps.push({
      description: "Repeat labs",
      with: null,
      dueBy: null,
      fullySpecified: false,
    });
    expect(routeExtraction(e, [])).toBe("prepared");
  });

  it("routes an extraction with no follow-ups at all prepared", () => {
    const e = baseExtraction();
    e.followUps = [];
    expect(routeExtraction(e, [])).toBe("prepared");
  });

  it("never returns quiet", () => {
    // Type-level: the return type has no "quiet" arm. Runtime spot-check:
    const routes = [
      routeExtraction(baseExtraction(), []),
      routeExtraction(baseExtraction(), ["issue"]),
    ];
    for (const r of routes) expect(["prepared", "judgment"]).toContain(r);
  });
});
