/**
 * Decision write-back tests (plan section 10: "decisions written back").
 * Same contract as db.invariants.test.ts: they run against a real Postgres
 * with migrations applied, skip without one, and fail loudly under
 * REQUIRE_DB. Synthetic rows only, distinct UUID range from the seed.
 */
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL } from "./db.js";
import { DecisionError, decideProposal } from "./decisions.js";

const ORG = "00000000-0000-4000-8000-000000009101";
const MEMBER = "00000000-0000-4000-8000-000000009102";
const EVENT = "00000000-0000-4000-8000-000000009103";

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

const decision = {
  actor: "cm-reviewer (synthetic)",
  durationSeconds: 90,
  activityDescription:
    "Reviewed the proposal against its source intake assessment and decided (synthetic test)",
} as const;

async function insertProposal(
  changeType: string,
  payload: unknown,
  sourceEventId: string | null = EVENT,
): Promise<string> {
  const { rows } = await pool.query(
    `insert into proposals (org_id, member_id, workflow, change_type, status,
       summary, payload, source_event_id, autonomy_level)
     values ($1,$2,'test-workflow',$3,'pending',$4,$5,$6,'L1')
     returning id`,
    [
      ORG,
      MEMBER,
      changeType,
      `Synthetic ${changeType} proposal`,
      JSON.stringify(payload),
      sourceEventId,
    ],
  );
  return rows[0].id;
}

const decide = async (
  proposalId: string,
  overrides: Partial<Parameters<typeof decideProposal>[2]> = {},
) => {
  const client = await pool.connect();
  try {
    return await decideProposal(client, proposalId, {
      action: "accept",
      ...decision,
      ...overrides,
    });
  } finally {
    client.release();
  }
};

describe.skipIf(!dbUp)("decideProposal", () => {
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
    await pool.query(
      `insert into events (id, org_id, member_id, event_type, actor, occurred_at,
         duration_seconds, purpose, activity_description)
       values ($1, $2, $3, 'IntakeAssessmentCompleted', 'test-cm', now(),
               600, 'test source event', 'synthetic source work description')`,
      [EVENT, ORG, MEMBER],
    );
  });

  afterEach(async () => {
    // events is append-only; decision events accumulate harmlessly. Facts,
    // tasks, and proposals are cleaned so each test starts from nothing.
    await pool.query("delete from tasks where org_id = $1", [ORG]);
    await pool.query("delete from member_facts where org_id = $1", [ORG]);
    await pool.query("delete from proposals where org_id = $1", [ORG]);
  });

  afterAll(async () => {
    await pool.query("delete from tasks where org_id = $1", [ORG]);
    await pool.query("delete from member_facts where org_id = $1", [ORG]);
    await pool.query("delete from proposals where org_id = $1", [ORG]);
    // events is append-only for the data plane; test cleanup disables the
    // trigger for its own synthetic rows only (decision events included),
    // so the fixture inserts are re-runnable.
    await pool.query("set session_replication_role = replica");
    await pool.query("delete from events where org_id = $1", [ORG]);
    await pool.query("set session_replication_role = origin");
    await pool.query("delete from members where id = $1", [MEMBER]);
    await pool.query("delete from orgs where id = $1", [ORG]);
    await pool.end();
  });

  it("accepting a task_creation proposal creates the task and the decision event", async () => {
    const id = await insertProposal("task_creation", { kind: "task_creation" });
    const result = await decide(id, { note: "looks right" });

    expect(result.proposal.status).toBe("approved");
    expect(result.proposal.reviewedBy).toBe(decision.actor);
    expect(result.createdTaskId).not.toBeNull();
    expect(result.verifiedFactId).toBeNull();

    const task = await pool.query("select * from tasks where id = $1", [
      result.createdTaskId,
    ]);
    expect(task.rows[0].title).toBe("Synthetic task_creation proposal");
    expect(task.rows[0].detail).toBe("looks right");
    expect(task.rows[0].proposal_id).toBe(id);

    // Requirement 9: the decision event carries actor, duration, description,
    // and the member link.
    const event = await pool.query("select * from events where id = $1", [
      result.decisionEventId,
    ]);
    expect(event.rows[0].actor).toBe(decision.actor);
    expect(event.rows[0].duration_seconds).toBe(90);
    expect(event.rows[0].member_id).toBe(MEMBER);
    expect(event.rows[0].activity_description).toContain("Reviewed");
  });

  it("rejecting writes the decision event and nothing else", async () => {
    const id = await insertProposal("task_creation", { kind: "task_creation" });
    const result = await decide(id, { action: "reject" });

    expect(result.proposal.status).toBe("rejected");
    expect(result.createdTaskId).toBeNull();
    const tasks = await pool.query("select * from tasks where org_id = $1", [
      ORG,
    ]);
    expect(tasks.rowCount).toBe(0);
  });

  it("refuses to decide a proposal twice", async () => {
    const id = await insertProposal("task_creation", { kind: "task_creation" });
    await decide(id);
    await expect(decide(id)).rejects.toThrowError(DecisionError);
    await expect(decide(id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("accepting a fact-shaped proposal verifies the fact and supersedes the prior one", async () => {
    // Prior active verified fact for the same key.
    const prior = await pool.query(
      `insert into member_facts (org_id, member_id, entity, attribute, value,
         status, source_event_id, verified_by, verified_at, valid_from)
       values ($1,$2,'medication','lisinopril','{"dose":"10 mg"}','verified',$3,
               'earlier-verifier',now(),now())
       returning id`,
      [ORG, MEMBER, EVENT],
    );
    const priorId = prior.rows[0].id;

    const id = await insertProposal("medication_change", {
      entity: "medication",
      attribute: "lisinopril",
      value: { dose: "20 mg" },
    });
    const result = await decide(id);

    expect(result.verifiedFactId).not.toBeNull();
    expect(result.supersededFactId).toBe(priorId);

    // Requirement 7 written down: old fact superseded and linked forward,
    // new fact verified by this reviewer, provenance on the source event.
    const facts = await pool.query(
      `select id, status, value, verified_by, source_event_id, invalidated_by
       from member_facts where member_id = $1 and attribute = 'lisinopril'
       order by created_at`,
      [MEMBER],
    );
    expect(facts.rows[0].status).toBe("superseded");
    expect(facts.rows[0].invalidated_by).toBe(result.verifiedFactId);
    expect(facts.rows[1].status).toBe("verified");
    expect(facts.rows[1].value).toEqual({ dose: "20 mg" });
    expect(facts.rows[1].verified_by).toBe(decision.actor);
    expect(facts.rows[1].source_event_id).toBe(EVENT);
  });

  it("refuses a fact-shaped accept with no source event — provenance is never fabricated", async () => {
    const id = await insertProposal(
      "fact_proposal",
      { entity: "condition", attribute: "ckd", value: { label: "CKD" } },
      null,
    );
    await expect(decide(id)).rejects.toMatchObject({ statusCode: 422 });

    // The whole decision rolled back: proposal still pending, no fact rows.
    const p = await pool.query("select status from proposals where id = $1", [
      id,
    ]);
    expect(p.rows[0].status).toBe("pending");
    const facts = await pool.query(
      "select * from member_facts where org_id = $1",
      [ORG],
    );
    expect(facts.rowCount).toBe(0);
  });

  it("refuses to accept a change_type the write-back cannot apply", async () => {
    const id = await insertProposal("outreach_scheduling", { kind: "mystery" });
    await expect(decide(id)).rejects.toMatchObject({ statusCode: 422 });
    // Not silently approved: still pending, still decidable once supported.
    const row = await pool.query("select status from proposals where id = $1", [
      id,
    ]);
    expect(row.rows[0].status).toBe("pending");
    // Rejecting it is still allowed — nothing needs applying.
    const rejected = await decide(id, { action: "reject" });
    expect(rejected.proposal.status).toBe("rejected");
  });

  it("serializes concurrent accepts on the same fact key instead of erroring", async () => {
    const payload = {
      entity: "medication",
      attribute: "metformin",
      value: { dose: "500 mg" },
    };
    const a = await insertProposal("medication_change", payload);
    const b = await insertProposal("medication_change", {
      ...payload,
      value: { dose: "1000 mg" },
    });
    const [ra, rb] = await Promise.all([decide(a), decide(b)]);

    // Both human approvals land; the advisory lock serializes them so the
    // loser supersedes the winner instead of dying on the unique index.
    expect(ra.verifiedFactId).not.toBeNull();
    expect(rb.verifiedFactId).not.toBeNull();
    const active = await pool.query(
      `select id from member_facts
       where member_id = $1 and attribute = 'metformin'
         and status = 'verified' and valid_to is null`,
      [MEMBER],
    );
    expect(active.rowCount).toBe(1);
    const chain = await pool.query(
      `select status from member_facts
       where member_id = $1 and attribute = 'metformin'`,
      [MEMBER],
    );
    expect(chain.rowCount).toBe(2);
    expect(chain.rows.filter((r) => r.status === "superseded")).toHaveLength(1);
  });

  it("refuses a fact accept whose payload is not fact-shaped", async () => {
    const id = await insertProposal("fact_proposal", { kind: "mystery" });
    await expect(decide(id)).rejects.toMatchObject({ statusCode: 422 });
  });

  it("a blank activity description dies at the database, not just the API boundary", async () => {
    const id = await insertProposal("task_creation", { kind: "task_creation" });
    await expect(
      decide(id, { activityDescription: "   " }),
    ).rejects.toThrowError(/activity_described/);
    const p = await pool.query("select status from proposals where id = $1", [
      id,
    ]);
    expect(p.rows[0].status).toBe("pending");
  });
});
