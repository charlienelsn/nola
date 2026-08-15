import { describe, expect, it } from "vitest";
import { AUTONOMY_LEVELS, FACT_STATUSES, MemberSchema } from "./index.js";

describe("shared ontology", () => {
  it("defines the four-rung autonomy ladder", () => {
    expect(AUTONOMY_LEVELS).toEqual(["L0", "L1", "L2", "L3"]);
  });
  it("defines the fact status lifecycle", () => {
    expect(FACT_STATUSES).toContain("proposed");
    expect(FACT_STATUSES).toContain("verified");
  });
  it("rejects a member without required fields", () => {
    expect(MemberSchema.safeParse({}).success).toBe(false);
  });
});
