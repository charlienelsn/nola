import type { WorkflowDefinition } from "@nola/shared";

/**
 * The Case Brain — founder-owned (CODEOWNERS).
 *
 * Core loop (plan section 3):
 *   event arrives → classify → assemble member context (whole member, no
 *   retrieval layer) → model proposes facts against the workflow's schema →
 *   deterministic validation → safe update, review, or escalation.
 *
 * Weeks 1–2 build this concretely for the discharge-summary workflow
 * (context.ts, prompt.ts, run.ts). The generic version is EXTRACTED in
 * weeks 4–5, after two real workflows exist. Nothing workflow-specific may
 * live in this package from week 4 on.
 */
export function registerWorkflow(def: WorkflowDefinition): void {
  // Registry lands with the factory extraction (weeks 4–5).
  void def;
}

export {
  MemberContextSchema,
  type MemberContext,
  renderMemberContext,
} from "./context.js";
export { PROMPT_REF, buildSystemPrompt, buildUserMessage } from "./prompt.js";
export {
  DEFAULT_MODEL,
  type DischargeInput,
  type DischargeRunResult,
  type ProposalFactPayload,
  ModelOutputSchema,
  type ModelOutput,
  type RunOptions,
  finalizeDischargeRun,
  runDischargeSummary,
} from "./run.js";
export {
  type TraceRecord,
  type TraceSink,
  newSpanId,
  newTraceId,
} from "./trace.js";
