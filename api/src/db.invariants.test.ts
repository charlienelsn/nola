/**
 * Database invariant tests (plan section 3):
 *  1. member_facts status transitions only move forward.
 *  2. A proposed fact can never overwrite a verified fact.
 *
 * These run against a real Postgres with the migrations applied (local
 * Supabase or the CI service container). Without a reachable database they
 * skip locally and fail in CI.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATABASE_URL } from "./db.js";

const ORG = "00000000-0000-4000-8000-000000009001";
const MEMBER = "00000000-0000-4000-8000-000000009002";
const EVENT = "00000000-0000-4000-8000-000000009003";

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });

const dbUp = await pool
  .query("select 1")
  .then(() => true)
  .catch(() => false);
if (!dbUp && process.env.CI) {
  throw new Error(`CI requires a reachable database at ${DATABASE_URL}`);
}

const insertFact = async (
  attribute: string,
  status: "proposed" | "verified",
  value: unknown = { label: "test" },
): Promise<string> => {
  const verified = status === "verified";
  const { rows } = await pool.query(
    `insert into member_facts (org_id, member_id, entity, attribute, value, status,
       source_event_id, confidence, verified_by, verified_at, valid_from)
     values ($1, $2, 'condition', $3, $4, $5, $6, 0.9, $7, $8, $8)
     returning id`,
    [
      ORG,
      MEMBER,
      attribute,
      JSON.stringify(value),
      status,
      EVENT,
      verified ? "test-verifier" : null,
      verified ? new Date().toISOString() : null,
    ],
  );
  return rows[0].id;
};

const setStatus = (id: string, status: string) =>
  pool.query(
    `update member_facts
     set status = $2,
         verified_by = coalesce(verified_by, 'test-verifier'),
         verified_at = coalesce(verified_at, now()),
         valid_to = case when $2 in ('superseded', 'retracted') then now() else valid_to end
     where id = $1`,
    [id, status],
  );

describe.skipIf(!dbUp)("member_facts invariants", () => {
  beforeAll(async () => {
    await pool.query(
      "insert into orgs (id, name) values ($1, 'test-org (synthetic)')",
      [ORG],
    );
    await pool.query(
      `insert into members (id, org_id, legal_name, chosen_name, dob, primary_language, coverage_type)
       values ($1, $2, 'Test Member (synthetic)', 'Test Member (synthetic)', '1950-01-01', 'English', 'medicare')`,
      [MEMBER, ORG],
    );
    await pool.query(
      `insert into events (id, org_id, member_id, event_type, actor, occurred_at, purpose)
       values ($1, $2, $3, 'TestEvent', 'test-actor', now(), 'invariant tests')`,
      [EVENT, ORG, MEMBER],
    );
  });

  afterAll(async () => {
    await pool.query("delete from member_facts where member_id = $1", [MEMBER]);
    // events is append-only for the data plane; test cleanup disables the
    // trigger for its own synthetic rows only.
    await pool.query("set session_replication_role = replica");
    await pool.query("delete from events where id = $1", [EVENT]);
    await pool.query("set session_replication_role = origin");
    await pool.query("delete from members where id = $1", [MEMBER]);
    await pool.query("delete from orgs where id = $1", [ORG]);
    await pool.end();
  });

  it("moves status forward: proposed -> verified -> superseded", async () => {
    const id = await insertFact("forward_path", "proposed");
    await expect(setStatus(id, "verified")).resolves.toBeTruthy();
    await expect(setStatus(id, "superseded")).resolves.toBeTruthy();
  });

  it("rejects every backward or out-of-terminal transition", async () => {
    const verified = await insertFact("no_backward", "verified");
    await expect(setStatus(verified, "proposed")).rejects.toThrow(
      /only moves forward/,
    );

    const superseded = await insertFact("terminal_super", "proposed");
    await setStatus(superseded, "superseded");
    await expect(setStatus(superseded, "verified")).rejects.toThrow(
      /only moves forward/,
    );

    const retracted = await insertFact("terminal_retract", "proposed");
    await setStatus(retracted, "retracted");
    await expect(setStatus(retracted, "proposed")).rejects.toThrow(
      /only moves forward/,
    );
  });

  it("a proposed fact can never overwrite a verified fact", async () => {
    const verifiedId = await insertFact("bp_target", "verified", {
      label: "BP target 130/80",
    });
    // A competing proposal may coexist…
    const proposedId = await insertFact("bp_target", "proposed", {
      label: "BP target 140/90",
    });

    // …but verifying it while the verified fact is still active must fail:
    // THE CONSTRAINT THAT MATTERS (partial unique index).
    await expect(setStatus(proposedId, "verified")).rejects.toThrow(
      /member_facts_one_active_verified/,
    );

    // Demoting the verified fact back to proposed is not a path around it.
    await expect(setStatus(verifiedId, "proposed")).rejects.toThrow(
      /only moves forward/,
    );

    // Neither is editing the verified fact's value in place.
    await expect(
      pool.query("update member_facts set value = $2 where id = $1", [
        verifiedId,
        JSON.stringify({ label: "BP target 140/90" }),
      ]),
    ).rejects.toThrow(/immutable/);

    // The sanctioned path: supersede the old fact, then verify the new one.
    await setStatus(verifiedId, "superseded");
    await expect(setStatus(proposedId, "verified")).resolves.toBeTruthy();
  });

  it("rejects UPDATE and DELETE on events (append-only)", async () => {
    await expect(
      pool.query("update events set purpose = 'edited' where id = $1", [EVENT]),
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query("delete from events where id = $1", [EVENT]),
    ).rejects.toThrow(/append-only/);
  });
});
