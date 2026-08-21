import cors from "@fastify/cors";
import { runDischargeSummary } from "@nola/brain";
import {
  IngestRequestSchema,
  type IngestResponse,
  IngestResponseSchema,
  type Member,
  MemberSchema,
  type MemberState,
  MemberStateSchema,
  PROPOSAL_STATUSES,
  ProposalDecisionRequestSchema,
  type ProposalDecisionResponse,
  ProposalDecisionResponseSchema,
  type ProposalWithSource,
  ProposalWithSourceSchema,
} from "@nola/shared";
import Fastify from "fastify";
import { z } from "zod";
import {
  factFromRow,
  memberFromRow,
  pool,
  proposalWithSourceFromRow,
} from "./db.js";
import { DecisionError, decideProposal } from "./decisions.js";
import { IngestError, ingestDischarge } from "./ingest.js";
import { pgTraceSink } from "./traceSink.js";

/**
 * Nola API — contract endpoints (plan section 9, API contract v1).
 * Day 2: members and member state served from local Supabase, validated
 * through @nola/shared Zod schemas at the boundary. Synthetic data only.
 * pg-boss jobs run inside this same process from Day 3 on.
 */
const app = Fastify({ logger: true });
// Dev CORS is pinned to the local frontend; deploy overrides via env. An
// open origin would expose the unauthenticated decision endpoint to any page.
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
});

// Internal failures log in full and return a generic message — raw driver
// errors (SQL, constraint names) are not a client contract.
app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  reply.code(500).send({ error: "internal error" });
});

app.get("/health", async () => ({ ok: true, service: "nola-api" }));

app.get("/members", async (): Promise<Member[]> => {
  const { rows } = await pool.query(
    "select * from members order by created_at, id",
  );
  return z.array(MemberSchema).parse(rows.map(memberFromRow));
});

app.get<{ Params: { id: string } }>(
  "/members/:id/state",
  async (req, reply): Promise<MemberState | undefined> => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      reply.code(400).send({ error: "invalid member id" });
      return;
    }
    const member = await pool.query("select 1 from members where id = $1", [
      id.data,
    ]);
    if (member.rowCount === 0) {
      reply.code(404).send({ error: "member not found" });
      return;
    }
    // member_current_state is the derived view: active verified facts only.
    const { rows } = await pool.query(
      "select * from member_current_state where member_id = $1 order by entity, attribute",
      [id.data],
    );
    return MemberStateSchema.parse({
      memberId: id.data,
      facts: rows.map(factFromRow),
    });
  },
);

// GET /proposals?status=pending — the review queue, cross-workflow. Each
// proposal arrives beside its member and the source event that produced it
// (requirement 6), so the review screen renders source beside proposal.
app.get<{ Querystring: { status?: string } }>(
  "/proposals",
  async (req, reply): Promise<ProposalWithSource[] | undefined> => {
    const status = z
      .enum(PROPOSAL_STATUSES)
      .safeParse(req.query.status ?? "pending");
    if (!status.success) {
      reply.code(400).send({ error: "invalid proposal status" });
      return;
    }
    const { rows } = await pool.query(
      `select p.*,
              m.chosen_name, m.primary_language, m.interpreter_needed,
              e.id as event_id, e.event_type, e.actor as event_actor,
              e.occurred_at, e.purpose, e.activity_description,
              d.id as document_id, d.doc_type as document_doc_type,
              d.source as document_source, d.content as document_content
       from proposals p
       join members m on m.id = p.member_id
       left join events e on e.id = p.source_event_id
       left join documents d on d.event_id = p.source_event_id
       where p.status = $1
       order by p.created_at, p.id`,
      [status.data],
    );
    return z
      .array(ProposalWithSourceSchema)
      .parse(rows.map(proposalWithSourceFromRow));
  },
);

// POST /proposals/:id/decision — accept | reject; the decision is written
// back in one transaction (see decisions.ts for the requirement 6/7/9 rules).
// Trust boundary note: `actor` is caller-asserted until managed auth (email
// allowlist) lands with the deploy loop — acceptable only because every
// environment is synthetic-only (requirement 2); auth must precede any
// environment where reviewed_by/verified_by carry real accountability.
app.post<{ Params: { id: string } }>(
  "/proposals/:id/decision",
  async (req, reply): Promise<ProposalDecisionResponse | undefined> => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) {
      reply.code(400).send({ error: "invalid proposal id" });
      return;
    }
    const body = ProposalDecisionRequestSchema.safeParse(req.body);
    if (!body.success) {
      reply
        .code(400)
        .send({ error: body.error.issues[0]?.message ?? "invalid decision" });
      return;
    }
    const client = await pool.connect();
    try {
      const result = await decideProposal(client, id.data, body.data);
      return ProposalDecisionResponseSchema.parse(result);
    } catch (err) {
      if (err instanceof DecisionError) {
        reply.code(err.statusCode).send({ error: err.message });
        return;
      }
      throw err;
    } finally {
      client.release();
    }
  },
);

// POST /ingest — any workflow's input enters here (contract v1). Runs the
// Brain synchronously for now: one model call, ~30-45s. pg-boss moves this
// to a job when arrival volume needs it; the contract does not change.
app.post("/ingest", async (req, reply): Promise<IngestResponse | undefined> => {
  // Bridge auth for the cost-bearing endpoint until managed auth lands:
  // when NOLA_INGEST_TOKEN is set, ingestion requires it. The dev default
  // (unset) stays open on loopback only — every model call here costs real
  // money, so any non-loopback deployment must set the token.
  const token = process.env.NOLA_INGEST_TOKEN;
  if (token && req.headers["x-ingest-token"] !== token) {
    reply.code(401).send({ error: "ingest token required" });
    return;
  }
  const body = IngestRequestSchema.safeParse(req.body);
  if (!body.success) {
    reply
      .code(400)
      .send({ error: body.error.issues[0]?.message ?? "invalid ingest" });
    return;
  }
  const { rows: memberRows } = await pool.query(
    "select org_id from members where id = $1",
    [body.data.memberId],
  );
  const orgId: string | undefined = memberRows[0]?.org_id;
  if (!orgId) {
    reply.code(404).send({ error: "member not found" });
    return;
  }
  try {
    // The sink writes each trace row as the run emits it and remembers the
    // root trace id so the response can point at it. Connections are
    // checked out per phase inside ingestDischarge — nothing is held
    // across the model call, so the sink can share the pool safely.
    const sink = pgTraceSink(pool, orgId);
    let traceId: string | null = null;
    const capturingSink = {
      write: async (record: Parameters<typeof sink.write>[0]) => {
        traceId = traceId ?? record.traceId;
        await sink.write(record);
      },
    };
    const result = await ingestDischarge(pool, body.data, (input) =>
      runDischargeSummary(input, { sink: capturingSink }),
    );
    return IngestResponseSchema.parse({ ...result, traceId });
  } catch (err) {
    if (err instanceof IngestError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    throw err;
  }
});

const port = Number(process.env.PORT ?? 3001);
// Dev binds loopback; the deploy platform sets HOST=0.0.0.0 explicitly.
await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
