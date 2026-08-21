/**
 * Ingest tests (plan section 9: POST /ingest). Same contract as
 * db.invariants.test.ts: real Postgres, skip without one, fail loudly under
 * REQUIRE_DB. The Brain is injected as a fake — these tests own the DB
 * behavior; the model half is graded by the eval harness.
 */
import type { DischargeRunResult } from "@nola/brain";
import type { IngestRequest } from "@nola/shared";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL } from "./db.js";
import { IngestError, ingestDischarge } from "./ingest.js";
import { pgTraceSink } from "./traceSink.js";

const ORG = "00000000-0000-4000-8000-000000009201";
const MEMBER = "00000000-0000-4000-8000-000000009202";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

const dbUp = await pool
  .query("select 1")
  .then(() => true)
  .catch(() => false);
if (!dbUp && process.env.REQUIRE_DB) {
  throw new Error(
    `REQUIRE_DB is set but no database is reachable at ${DATABASE_URL}`,
  );
}

const request: IngestRequest = {
  eventType: "DischargeReceived",
  memberId: MEMBER,
  source: "Synthetic General Hospital HIE feed",
  receivedAt: "2026-08-21T12:00:00Z",
  document: "Synthetic discharge summary text — stable at discharge.",
  actor: "ingest-gateway (synthetic)",
};

const preparedRun = (): DischargeRunResult => ({
  identity: { matchesMember: true },
  extraction: null, // DB tests do not exercise extraction content
  contradictions: [],
  proposals: [
    {
      changeType: "task_creation",
      summary: "Track the synthetic follow-up",
      autonomyLevel: "L1",
      payload: null,
    },
    {
      changeType: "medication_change",
      summary: "Change synthetic med to 20 mg daily",
      autonomyLevel: "L1",
      payload: {
        entity: "medication",
        attribute: "synthetic_med",
        value: { name: "Synthetic med", dose: "20 mg", frequency: "daily" },
      },
    },
  ],
  routing: "prepared",
});

const ingest = (
  overrides: Partial<IngestRequest> = {},
  run: () => Promise<DischargeRunResult> = async () => preparedRun(),
) => ingestDischarge(pool, { ...request, ...overrides }, run);

/** Delete this org's append-only event rows (test cleanup only): the SET
 * must ride the same connection as the DELETE, so pin one client. */
async function deleteOrgEvents(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("set session_replication_role = replica");
    await client.query("delete from events where org_id = $1", [ORG]);
    await client.query("set session_replication_role = origin");
  } finally {
    client.release();
  }
}

describe.skipIf(!dbUp)("ingestDischarge", () => {
  beforeAll(async () => {
    await pool.query(
      "insert into orgs (id, name) values ($1, 'test-org (synthetic)')",
      [ORG],
    );
    await pool.query(
      `insert into members (id, org_id, legal_name, chosen_name, dob, coverage_type)
       values ($1, $2, 'Test Member (synthetic)', 'Test Member (synthetic)',
               '1950-01-01', 'medicare')`,
      [MEMBER, ORG],
    );
  });

  afterEach(async () => {
    await pool.query("delete from proposals where org_id = $1", [ORG]);
    await pool.query("delete from documents where org_id = $1", [ORG]);
    await pool.query("delete from traces where org_id = $1", [ORG]);
    await deleteOrgEvents();
  });

  afterAll(async () => {
    await pool.query("delete from members where id = $1", [MEMBER]);
    await pool.query("delete from orgs where id = $1", [ORG]);
    await pool.end();
  });

  it("writes the arrival event, the verbatim document, pending proposals, and the completion marker", async () => {
    const result = await ingest();
    expect(result.routing).toBe("prepared");
    expect(result.proposalIds).toHaveLength(2);

    const doc = await pool.query("select * from documents where id = $1", [
      result.documentId,
    ]);
    expect(doc.rows[0].content).toBe(request.document);
    expect(doc.rows[0].event_id).toBe(result.eventId);
    // Completion is stamped with the proposals commit, carrying the run's
    // conclusion for reconciliation.
    expect(doc.rows[0].metadata.ingestCompleted).toBe(true);
    expect(doc.rows[0].metadata.routing).toBe("prepared");
    expect(doc.rows[0].metadata.proposalCount).toBe(2);

    const proposals = await pool.query(
      "select * from proposals where source_event_id = $1",
      [result.eventId],
    );
    expect(proposals.rowCount).toBe(2);
    for (const row of proposals.rows) {
      expect(row.status).toBe("pending"); // requirement 7: nothing applied
      expect(row.autonomy_level).toBe("L1");
      expect(row.workflow).toBe("discharge-summary");
    }
    // The fact-shaped payload survives to the row the decision path reads.
    const medRow = proposals.rows.find(
      (r) => r.change_type === "medication_change",
    );
    expect(medRow?.payload).toEqual({
      entity: "medication",
      attribute: "synthetic_med",
      value: { name: "Synthetic med", dose: "20 mg", frequency: "daily" },
    });
  });

  it("refuses a byte-identical re-send after a completed ingest", async () => {
    await ingest();
    await expect(ingest()).rejects.toMatchObject({ statusCode: 409 });
    const proposals = await pool.query(
      "select count(*)::int as n from proposals where org_id = $1",
      [ORG],
    );
    expect(proposals.rows[0].n).toBe(2); // still one proposal set
  });

  it("keeps the evidence when the Brain call fails — and allows the retry to complete", async () => {
    await expect(
      ingest({}, async () => {
        throw new Error("model unavailable (synthetic)");
      }),
    ).rejects.toThrowError("model unavailable");

    // Evidence survives without a completion marker; no proposals exist.
    const failedDoc = await pool.query(
      "select metadata from documents where org_id = $1",
      [ORG],
    );
    expect(failedDoc.rowCount).toBe(1);
    expect(failedDoc.rows[0].metadata.ingestCompleted).toBeUndefined();

    // The same bytes are NOT stuck: the retry runs and completes.
    const retry = await ingest();
    expect(retry.proposalIds).toHaveLength(2);
    const docs = await pool.query(
      `select count(*)::int as n from documents
       where org_id = $1 and metadata->>'ingestCompleted' = 'true'`,
      [ORG],
    );
    expect(docs.rows[0].n).toBe(1);
  });

  it("the database itself allows only one completed ingest per (member, content)", async () => {
    // The pre-check is a fast path; the partial unique index is the
    // guarantee two concurrent ingests cannot both complete.
    const meta = { sha256: "f".repeat(64), ingestCompleted: true };
    await pool.query(
      `insert into documents (org_id, member_id, doc_type, source, received_at, content, metadata)
       values ($1,$2,'discharge-summary','test','2026-08-21T12:00:00Z','x',$3)`,
      [ORG, MEMBER, JSON.stringify(meta)],
    );
    await expect(
      pool.query(
        `insert into documents (org_id, member_id, doc_type, source, received_at, content, metadata)
         values ($1,$2,'discharge-summary','test','2026-08-21T12:00:00Z','x',$3)`,
        [ORG, MEMBER, JSON.stringify(meta)],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses an eventType no workflow ingests", async () => {
    await expect(
      ingest({ eventType: "CallTranscriptReceived" }),
    ).rejects.toThrowError(IngestError);
    await expect(
      ingest({ eventType: "CallTranscriptReceived" }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("404s an unknown member before writing anything", async () => {
    await expect(
      ingest({ memberId: "00000000-0000-4000-8000-000000009999" }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("assembles live member context with an ISO dob for the identity guard", async () => {
    let seenDob: string | null = null;
    await ingestDischarge(pool, request, async (input) => {
      seenDob = input.member.dob;
      return preparedRun();
    });
    // The whole wrong-member guard rests on this format.
    expect(seenDob).toBe("1950-01-01");
  });

  it("pgTraceSink writes a traces row shaped like the Brain's records", async () => {
    const sink = pgTraceSink(pool, ORG);
    await sink.write({
      traceId: "a".repeat(32),
      spanId: "b".repeat(16),
      parentSpanId: null,
      operation: "chat",
      model: "claude-opus-5",
      promptRef: "discharge-summary/extract@v1",
      contextRefs: [{ type: "member", memberId: MEMBER }],
      output: { ok: true },
      inputTokens: 100,
      outputTokens: 200,
      latencyMs: 1234,
      costUsd: 0.0123,
      memberId: MEMBER,
      workflow: "discharge-summary",
      attributes: { "gen_ai.system": "anthropic" },
      startedAt: "2026-08-21T12:00:00Z",
    });
    const row = await pool.query("select * from traces where trace_id = $1", [
      "a".repeat(32),
    ]);
    expect(row.rows[0].model).toBe("claude-opus-5");
    expect(row.rows[0].input_tokens).toBe(100);
    expect(Number(row.rows[0].cost_usd)).toBeCloseTo(0.0123);
    expect(row.rows[0].member_id).toBe(MEMBER);
  });
});
