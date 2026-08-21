import type { Extraction } from "@nola/workflow-discharge-summary";
import { describe, expect, it } from "vitest";
import type { MemberContext } from "./context.js";
import { renderMemberContext } from "./context.js";
import type { ModelOutput } from "./run.js";
import { finalizeDischargeRun } from "./run.js";

/**
 * The deterministic half of the run path — everything downstream of the
 * model call. The model half is graded by the eval harness, not unit tests.
 */

const member: MemberContext = {
  memberId: "00000000-0000-4000-8000-000000000103",
  chosenName: "Mei-Ling Chau",
  legalName: "Mei-Ling Chau",
  dob: "1938-06-21",
  primaryLanguage: "Cantonese",
  interpreterNeeded: true,
  coverage: { type: "dual", planName: null },
  currentFacts: [
    {
      entity: "condition",
      attribute: "chf",
      value: { label: "Congestive heart failure", status: "active" },
    },
    {
      entity: "medication",
      attribute: "furosemide",
      value: { name: "Furosemide", dose: "20 mg", frequency: "daily" },
    },
  ],
  caregivers: [
    {
      name: "Kevin Chau",
      relationship: "son",
      involvement: "central",
      preferredLanguage: "English",
    },
  ],
};

const furosemide = {
  name: "Furosemide",
  dose: "40 mg",
  frequency: "daily",
  change: "changed",
  changeDocumented: true,
} as const;

const extraction: Extraction = {
  admission: {
    facility: "St. Test Medical Center",
    admittedOn: "2026-08-01",
    dischargedOn: "2026-08-05",
    principalDiagnosis: "CHF exacerbation",
  },
  medications: [furosemide],
  medicationListComplete: true,
  followUps: [
    {
      description: "PCP visit",
      with: "Dr. Test",
      dueBy: "2026-08-12",
      fullySpecified: true,
    },
  ],
  pendingResults: [],
  newDiagnoses: [],
};

const matchingIdentity = {
  matchesMember: true,
  documentName: "Chau, Mei-Ling",
  documentDob: "1938-06-21",
  note: "name and date of birth match",
};

describe("finalizeDischargeRun", () => {
  it("routes a clean, documented extraction prepared with L1 proposals", () => {
    const output: ModelOutput = {
      identity: matchingIdentity,
      extraction,
      contradictions: [
        {
          detail: "verified dose outdated",
          against: { entity: "medication", attribute: "furosemide" },
        },
      ],
      proposals: [
        {
          changeType: "medication_change",
          summary: "Furosemide changed to 40 mg daily",
        },
        {
          changeType: "task_creation",
          summary: "PCP visit with Dr. Test by 2026-08-12",
        },
      ],
    };
    const result = finalizeDischargeRun(member, output);
    expect(result.identity.matchesMember).toBe(true);
    expect(result.routing).toBe("prepared");
    expect(result.contradictions).toHaveLength(1);
    expect(result.proposals.map((p) => p.autonomyLevel)).toEqual(["L1", "L1"]);
  });

  it("routes judgment when a medication change is undocumented", () => {
    const output: ModelOutput = {
      identity: matchingIdentity,
      extraction: {
        ...extraction,
        medications: [{ ...furosemide, changeDocumented: false }],
      },
      contradictions: [],
      proposals: [],
    };
    expect(finalizeDischargeRun(member, output).routing).toBe("judgment");
  });

  it("forces a mismatch when the document date of birth differs, whatever the model judged", () => {
    const output: ModelOutput = {
      identity: { ...matchingIdentity, documentDob: "1952-07-01" },
      extraction,
      contradictions: [
        {
          detail: "should be cleared",
          against: { entity: "condition", attribute: "chf" },
        },
      ],
      proposals: [
        { changeType: "medication_change", summary: "must be dropped" },
        { changeType: "fact_proposal", summary: "must be dropped" },
      ],
    };
    const result = finalizeDischargeRun(member, output);
    expect(result.identity.matchesMember).toBe(false);
    expect(result.extraction).toBeNull();
    expect(result.contradictions).toEqual([]);
    expect(result.routing).toBe("judgment");
    expect(result.proposals).toHaveLength(1);
    const task = result.proposals[0];
    expect(task?.changeType).toBe("task_creation");
    expect(task?.summary.toLowerCase()).toContain("wrong member");
    expect(task?.summary.toLowerCase()).toContain("misrouted");
  });

  it("keeps the model's own escalation task on a declared mismatch, without duplicating it", () => {
    const output: ModelOutput = {
      identity: {
        matchesMember: false,
        documentName: "Delgado, Rosa M.",
        documentDob: "1952-07-01",
        note: "name and date of birth do not match",
      },
      extraction: null,
      contradictions: [],
      proposals: [
        {
          changeType: "task_creation",
          summary:
            "Wrong member: misrouted discharge summary for Delgado, Rosa M. — locate the intended member and notify the sender",
        },
      ],
    };
    const result = finalizeDischargeRun(member, output);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.summary).toContain("Delgado");
  });

  it("escalates an identity match with no extraction as a broken run", () => {
    const output: ModelOutput = {
      identity: matchingIdentity,
      extraction: null,
      contradictions: [],
      proposals: [],
    };
    const result = finalizeDischargeRun(member, output);
    expect(result.extraction).toBeNull();
    expect(result.routing).toBe("judgment");
  });

  it("escalates to judgment when a contradiction cites a fact that does not exist", () => {
    const output: ModelOutput = {
      identity: matchingIdentity,
      extraction,
      contradictions: [
        {
          detail: "dose conflict",
          // The baseline's exact mis-key shape: slash-joined entity, value
          // key as attribute. No such fact row exists.
          against: { entity: "medication/furosemide", attribute: "dose" },
        },
      ],
      proposals: [],
    };
    const result = finalizeDischargeRun(member, output);
    expect(result.routing).toBe("judgment");
    // The contradiction itself is kept for the human, never dropped.
    expect(result.contradictions).toHaveLength(1);
  });

  it("keeps prepared routing when every contradiction cites a real fact", () => {
    const output: ModelOutput = {
      identity: matchingIdentity,
      extraction,
      contradictions: [
        {
          detail: "verified dose outdated",
          against: { entity: "medication", attribute: "furosemide" },
        },
      ],
      proposals: [],
    };
    expect(finalizeDischargeRun(member, output).routing).toBe("prepared");
  });
});

describe("renderMemberContext", () => {
  it("renders each fact's citation object verbatim, with interpreter and caregiver context", () => {
    const text = renderMemberContext(member);
    expect(text).toContain('against={"entity":"condition","attribute":"chf"}');
    expect(text).toContain("Cantonese (interpreter needed)");
    expect(text).toContain(
      "Kevin Chau (son, involvement: central, prefers English)",
    );
  });
});
