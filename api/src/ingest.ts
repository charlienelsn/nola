import { createHash } from "node:crypto";
import type { DischargeInput, DischargeRunResult } from "@nola/brain";
import type { IngestRequest, IngestResponse } from "@nola/shared";
import { dischargeSummary } from "@nola/workflow-discharge-summary";
import type pg from "pg";
import { safeRollback } from "./db.js";
import { assembleMemberContext } from "./memberContext.js";

/**
 * POST /ingest — any workflow's input enters here (API contract v1). The
 * discharge-summary path, concretely (weeks 1-2; the workflow lookup
 * generalizes with the factory):
 *
 *  1. The ingestion event is appended and the document stored verbatim —
 *     evidence first, whatever the run does (requirements 1 and 6: source
 *     text is retained untouched; every proposal will cite this event).
 *  2. Whole-member context is assembled live from the same shape the eval
 *     path uses, and the Brain runs once. No database connection is held
 *     during the model call: each phase checks out its own client, so a
 *     burst of concurrent ingests cannot drain the pool into a deadlock.
 *  3. Every proposal lands `pending` for the review screen; nothing is
 *     applied here (requirement 7). The same transaction stamps the
 *     document's completion marker (ingestCompleted, routing, proposal
 *     count) — proposals exist iff the marker does, so a crash-orphaned
 *     document (no marker) is distinguishable from a completed run and
 *     stays re-ingestable.
 *
 * Duplicate guard: re-posting byte-identical content for the same member is
 * refused only when a COMPLETED ingest exists — a re-ingested duplicate
 * would double the proposal set and, accepted twice, double the written
 * work (decision 22's duplicate-charge lesson, upstream). The pre-check is
 * the fast path; the partial unique index documents_one_completed_ingest is
 * the guarantee, and a concurrent loser's completion fails 23505 -> 409.
 */

export class IngestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** The Brain call, injectable so DB behavior is testable without a model. */
export type RunDischarge = (
  input: DischargeInput,
) => Promise<DischargeRunResult>;

const sha256 = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

async function withClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function ingestDischarge(
  pool: pg.Pool,
  req: IngestRequest,
  run: RunDischarge,
): Promise<IngestResponse> {
  if (req.eventType !== dischargeSummary.trigger.eventType) {
    throw new IngestError(
      422,
      `no workflow is registered for eventType ${req.eventType}; only ${dischargeSummary.trigger.eventType} ingests until the factory lands`,
    );
  }

  const contentHash = sha256(req.document);

  // Phase 1 — checks, evidence transaction, and context assembly. The
  // client is released before the model call.
  const phase1 = await withClient(pool, async (client) => {
    const member = await client.query(
      "select org_id from members where id = $1",
      [req.memberId],
    );
    const orgId: string | undefined = member.rows[0]?.org_id;
    if (!orgId) throw new IngestError(404, "member not found");

    const duplicate = await client.query(
      `select id from documents
       where member_id = $1 and metadata->>'sha256' = $2
         and metadata->>'ingestCompleted' = 'true'
       limit 1`,
      [req.memberId, contentHash],
    );
    if (duplicate.rows[0]) {
      throw new IngestError(
        409,
        `this document content was already ingested for this member (document ${duplicate.rows[0].id}); re-sends do not create a second proposal set`,
      );
    }

    // Evidence first, in its own transaction: the arrival event and the
    // verbatim document exist even if the model call fails. Without a
    // completion marker the document stays re-ingestable, so a failed run
    // is genuinely recoverable by re-sending — a lost document is not.
    await client.query("begin");
    try {
      const event = await client.query(
        `insert into events (org_id, member_id, event_type, actor, occurred_at,
           duration_seconds, purpose, activity_description, payload)
         values ($1,$2,$3,$4,$5,null,$6,$7,$8)
         returning id`,
        [
          orgId,
          req.memberId,
          req.eventType,
          req.actor,
          req.receivedAt,
          `Document arrival: ${dischargeSummary.name} input from ${req.source}`,
          `Ingested a ${dischargeSummary.name} document from ${req.source} and stored it verbatim as evidence`,
          JSON.stringify({ source: req.source, sha256: contentHash }),
        ],
      );
      const eventId: string = event.rows[0].id;

      const document = await client.query(
        `insert into documents (org_id, member_id, event_id, doc_type, source,
           received_at, content, metadata)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id`,
        [
          orgId,
          req.memberId,
          eventId,
          dischargeSummary.name,
          req.source,
          req.receivedAt,
          req.document,
          JSON.stringify({ sha256: contentHash }),
        ],
      );
      const documentId: string = document.rows[0].id;
      await client.query("commit");

      const context = await assembleMemberContext(client, req.memberId);
      if (!context) throw new IngestError(404, "member not found");
      return { orgId, eventId, documentId, context };
    } catch (err) {
      await safeRollback(client);
      throw err;
    }
  });

  // Model call — no connection held.
  const result = await run({
    member: phase1.context,
    source: req.source,
    receivedAt: req.receivedAt,
    document: req.document,
  });

  // Phase 2 — proposals and the completion marker, one transaction: the
  // proposal set exists iff the marker does. A partial proposal set (or a
  // marker without its proposals) would read as the Brain having concluded
  // something it did not.
  const proposalIds = await withClient(pool, async (client) => {
    await client.query("begin");
    const ids: string[] = [];
    try {
      for (const p of result.proposals) {
        const inserted = await client.query(
          `insert into proposals (org_id, member_id, workflow, change_type,
             status, summary, payload, source_event_id, autonomy_level)
           values ($1,$2,$3,$4,'pending',$5,$6,$7,$8)
           returning id`,
          [
            phase1.orgId,
            req.memberId,
            dischargeSummary.name,
            p.changeType,
            p.summary,
            JSON.stringify(p.payload ?? { kind: p.changeType }),
            phase1.eventId,
            p.autonomyLevel,
          ],
        );
        ids.push(inserted.rows[0].id);
      }
      await client.query(
        "update documents set metadata = metadata || $2::jsonb where id = $1",
        [
          phase1.documentId,
          JSON.stringify({
            ingestCompleted: true,
            routing: result.routing,
            identityMatches: result.identity.matchesMember,
            proposalCount: ids.length,
          }),
        ],
      );
      await client.query("commit");
      return ids;
    } catch (err) {
      await safeRollback(client);
      if ((err as { code?: string }).code === "23505") {
        throw new IngestError(
          409,
          "a concurrent ingest of this document completed first; this arrival is recorded as evidence only",
        );
      }
      throw err;
    }
  });

  return {
    eventId: phase1.eventId,
    documentId: phase1.documentId,
    memberId: req.memberId,
    workflow: dischargeSummary.name,
    routing: result.routing,
    identityMatches: result.identity.matchesMember,
    proposalIds,
    traceId: null,
  };
}
