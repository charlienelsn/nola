import { randomBytes } from "node:crypto";

/**
 * Trace record for one model call — every call logs one (CLAUDE.md
 * conventions), shaped to the `traces` table with OpenTelemetry GenAI
 * attribute names in `attributes`. The Brain emits records through a
 * TraceSink so the transport stays out of founder-owned code: the eval
 * runner sinks to JSONL; the API process gains a Postgres sink when live
 * ingestion lands.
 */
export interface TraceRecord {
  traceId: string; // 32 hex chars (W3C trace-id)
  spanId: string; // 16 hex chars (W3C span-id)
  parentSpanId: string | null;
  operation: "chat";
  model: string;
  promptRef: string;
  contextRefs: unknown[];
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  costUsd: number | null;
  memberId: string | null;
  workflow: string | null;
  attributes: Record<string, unknown>;
  startedAt: string; // ISO timestamp
}

export interface TraceSink {
  write(record: TraceRecord): Promise<void>;
}

export const newTraceId = (): string => randomBytes(16).toString("hex");
export const newSpanId = (): string => randomBytes(8).toString("hex");
