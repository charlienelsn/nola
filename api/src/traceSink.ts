import type { TraceRecord, TraceSink } from "@nola/brain";
import type pg from "pg";

/**
 * Postgres TraceSink — every live model call lands one row in `traces`
 * (CLAUDE.md conventions; the eval runner sinks the same records to JSONL).
 * Uses its own pool handle so trace writes never ride the ingest
 * transaction: a trace is observability, recorded even when the run's
 * downstream writes roll back.
 */
export function pgTraceSink(pool: pg.Pool, orgId: string): TraceSink {
  return {
    async write(record: TraceRecord): Promise<void> {
      await pool.query(
        `insert into traces (org_id, trace_id, span_id, parent_span_id,
           operation, model, prompt_ref, context_refs, output,
           input_tokens, output_tokens, latency_ms, cost_usd,
           member_id, workflow, attributes, started_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          orgId,
          record.traceId,
          record.spanId,
          record.parentSpanId,
          record.operation,
          record.model,
          record.promptRef,
          JSON.stringify(record.contextRefs),
          record.output == null ? null : JSON.stringify(record.output),
          record.inputTokens,
          record.outputTokens,
          record.latencyMs,
          record.costUsd,
          record.memberId,
          record.workflow,
          JSON.stringify(record.attributes),
          record.startedAt,
        ],
      );
    },
  };
}
