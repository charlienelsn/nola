import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@nola/shared";
import {
  CHANGE_TYPES,
  CHANGE_TYPE_CEILINGS,
  type ChangeType,
  type Extraction,
  ExtractionSchema,
  dischargeSummary,
  routeExtraction,
  validateExtraction,
} from "@nola/workflow-discharge-summary";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { MemberContext } from "./context.js";
import { PROMPT_REF, buildSystemPrompt, buildUserMessage } from "./prompt.js";
import {
  type TraceRecord,
  type TraceSink,
  newSpanId,
  newTraceId,
} from "./trace.js";

/**
 * The discharge-summary run path, built concretely (plan weeks 1-2; the
 * generic loop is extracted in weeks 4-5): assemble whole-member context ->
 * one structured-output model call -> deterministic validation and routing.
 *
 * The model judges content: identity, the extraction, contradictions, and
 * proposal summaries. It never decides routing or autonomy — those are
 * computed here from the workflow's own validate/route functions and
 * per-change-type ceilings, and a deterministic guard forces the
 * wrong-member behavior the severity rubric treats as critical.
 */

/** What the model must return. Wraps the founder-reviewed ExtractionSchema. */
export const ModelOutputSchema = z.object({
  identity: z.object({
    matchesMember: z.boolean(),
    /** Name exactly as the document writes it. */
    documentName: z.string().nullable(),
    /** Document date of birth converted to ISO YYYY-MM-DD. */
    documentDob: z.string().nullable(),
    note: z.string(),
  }),
  extraction: ExtractionSchema.nullable(),
  contradictions: z.array(
    z.object({
      detail: z.string(),
      against: z.object({ entity: z.string(), attribute: z.string() }),
    }),
  ),
  proposals: z.array(
    z.object({ changeType: z.enum(CHANGE_TYPES), summary: z.string() }),
  ),
});
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** Structurally identical to the eval harness's RunResultSchema. */
export interface DischargeRunResult {
  identity: { matchesMember: boolean };
  extraction: Extraction | null;
  contradictions: {
    detail: string;
    against: { entity: string; attribute: string };
  }[];
  proposals: {
    changeType: ChangeType;
    summary: string;
    autonomyLevel: AutonomyLevel;
  }[];
  routing: "prepared" | "judgment";
}

const ladder = (level: AutonomyLevel): number => AUTONOMY_LEVELS.indexOf(level);

/** Workflow level clamped by the per-change-type ceiling (decision 11). */
function clampAutonomy(changeType: ChangeType): AutonomyLevel {
  const ceiling = CHANGE_TYPE_CEILINGS[changeType];
  return ladder(dischargeSummary.autonomyLevel) <= ladder(ceiling)
    ? dischargeSummary.autonomyLevel
    : ceiling;
}

const MISROUTE_TASK =
  "Wrong member: document name/date-of-birth do not match the member record — " +
  "misrouted discharge summary; locate the intended member and notify the sender.";

/**
 * Deterministic post-processing. Pure — unit-tested without model calls.
 *
 * Guards, in order:
 * 1. A document date of birth that differs from the member record forces a
 *    mismatch, whatever the model judged.
 * 2. A mismatch writes nothing: extraction nulled, contradictions cleared,
 *    non-task proposals dropped, and a misroute escalation task guaranteed
 *    (mentioning "wrong member" and "misrouted") — routing judgment.
 * 3. Autonomy levels come from the workflow and its ceilings, never the model.
 * 4. A contradiction must cite a verified fact that exists. A citation
 *    matching no fact row cannot be resolved against member_facts
 *    (requirement 6) — the run escalates to judgment for a human to re-key.
 */
export function finalizeDischargeRun(
  member: MemberContext,
  output: ModelOutput,
): DischargeRunResult {
  const dobMismatch =
    output.identity.documentDob !== null &&
    output.identity.documentDob !== member.dob;
  const matches = output.identity.matchesMember && !dobMismatch;

  const withLevel = (p: { changeType: ChangeType; summary: string }) => ({
    ...p,
    autonomyLevel: clampAutonomy(p.changeType),
  });

  if (!matches) {
    const tasks = output.proposals.filter(
      (p) => p.changeType === "task_creation",
    );
    const escalated = tasks.some(
      (t) => /wrong member/i.test(t.summary) && /misrouted/i.test(t.summary),
    )
      ? tasks
      : [
          { changeType: "task_creation" as const, summary: MISROUTE_TASK },
          ...tasks,
        ];
    return {
      identity: { matchesMember: false },
      extraction: null,
      contradictions: [],
      proposals: escalated.map(withLevel),
      routing: "judgment",
    };
  }

  const extraction = output.extraction;
  if (extraction === null) {
    // Identity matched but nothing was extracted — a broken run, escalated
    // as such rather than dressed up.
    return {
      identity: { matchesMember: true },
      extraction: null,
      contradictions: output.contradictions,
      proposals: output.proposals.map(withLevel),
      routing: "judgment",
    };
  }

  const factKeys = new Set(
    member.currentFacts.map((f) => `${f.entity}\u0000${f.attribute}`),
  );
  const uncitable = output.contradictions.some(
    (c) => !factKeys.has(`${c.against.entity}\u0000${c.against.attribute}`),
  );

  const issues = validateExtraction(extraction);
  return {
    identity: { matchesMember: true },
    extraction,
    contradictions: output.contradictions,
    proposals: output.proposals.map(withLevel),
    routing: uncitable ? "judgment" : routeExtraction(extraction, issues),
  };
}

export const DEFAULT_MODEL = "claude-opus-5";

/** $ per million tokens. Cache reads bill 0.1x input; cache writes 1.25x. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function costUsd(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens * price.input +
      cacheWrite * price.input * 1.25 +
      cacheRead * price.input * 0.1 +
      usage.output_tokens * price.output) /
    1_000_000
  );
}

/**
 * Output format for the structured-output call. zod-to-json-schema keeps the
 * founder-reviewed zod-3 schemas as the single source of truth (the SDK's
 * zodOutputFormat helper requires zod 4); the SDK transform prunes the schema
 * to the API's supported subset, and the response is re-validated against
 * ModelOutputSchema before anything downstream sees it.
 */
const OUTPUT_FORMAT = jsonSchemaOutputFormat(
  zodToJsonSchema(ModelOutputSchema, {
    $refStrategy: "none",
  }) as unknown as Parameters<typeof jsonSchemaOutputFormat>[0],
);

export interface DischargeInput {
  member: MemberContext;
  source: string;
  receivedAt: string;
  document: string;
}

export interface RunOptions {
  client?: Anthropic;
  model?: string;
  /** Strips PATCHES from the prompt; defaults to env MINIMAL_PROMPT=1. */
  minimalPrompt?: boolean;
  sink?: TraceSink;
}

export async function runDischargeSummary(
  input: DischargeInput,
  opts: RunOptions = {},
): Promise<DischargeRunResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? process.env.NOLA_BRAIN_MODEL ?? DEFAULT_MODEL;
  const minimal = opts.minimalPrompt ?? process.env.MINIMAL_PROMPT === "1";

  const startedAt = new Date().toISOString();
  const t0 = performance.now();
  const response = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: buildSystemPrompt({ minimal }),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserMessage(input.member, {
          source: input.source,
          receivedAt: input.receivedAt,
          document: input.document,
        }),
      },
    ],
    output_config: { format: OUTPUT_FORMAT },
  });
  const latencyMs = Math.round(performance.now() - t0);

  const trace: TraceRecord = {
    traceId: newTraceId(),
    spanId: newSpanId(),
    parentSpanId: null,
    operation: "chat",
    model: response.model,
    promptRef: minimal ? `${PROMPT_REF}#minimal` : PROMPT_REF,
    contextRefs: [
      { type: "member", memberId: input.member.memberId },
      {
        type: "event",
        eventType: "DischargeReceived",
        source: input.source,
        receivedAt: input.receivedAt,
      },
    ],
    output: response.parsed_output ?? null,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
    costUsd: costUsd(model, response.usage),
    memberId: input.member.memberId,
    workflow: dischargeSummary.name,
    attributes: {
      "gen_ai.system": "anthropic",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "gen_ai.response.model": response.model,
      "gen_ai.response.id": response.id,
      "gen_ai.response.finish_reasons": [response.stop_reason],
      "gen_ai.usage.input_tokens": response.usage.input_tokens,
      "gen_ai.usage.output_tokens": response.usage.output_tokens,
      "gen_ai.usage.cache_read_input_tokens":
        response.usage.cache_read_input_tokens ?? 0,
      "gen_ai.usage.cache_creation_input_tokens":
        response.usage.cache_creation_input_tokens ?? 0,
    },
    startedAt,
  };
  if (opts.sink) await opts.sink.write(trace);

  const parsed = ModelOutputSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new Error(
      `model output violates ModelOutputSchema (stop_reason: ${response.stop_reason}) — ${parsed.error.message}`,
    );
  }
  return finalizeDischargeRun(input.member, parsed.data);
}
