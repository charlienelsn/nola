import type {
  Proposal,
  ProposalDecisionRequest,
  ProposalDecisionResponse,
} from "@nola/shared";
import type pg from "pg";
import { z } from "zod";
import { proposalFromRow } from "./db.js";

/**
 * POST /proposals/:id/decision — the write-back half of the review loop
 * (plan section 10: "decisions written back").
 *
 * One transaction, in order:
 *  1. Lock the proposal; only `pending` can be decided (409 otherwise).
 *  2. Append the decision event — requirement 9: actor, timestamp, measured
 *     duration, non-blank activity description, member link. The decision is
 *     itself billable-adjacent care work and must survive a records request.
 *  3. Mark the proposal approved/rejected with reviewer and time.
 *  4. Apply the accepted change:
 *     - task_creation -> a `tasks` row (title from the summary).
 *     - a fact-shaped payload -> verify: supersede any active verified fact
 *       for the same (member, entity, attribute), then insert the new fact as
 *       verified by this reviewer (requirement 7 — this human act is exactly
 *       the verification that lets a proposal become state). The fact's
 *       source_event_id is the proposal's source event, never the decision
 *       event: provenance points at the evidence, not the review
 *       (requirement 6). A fact-shaped accept with no source event is
 *       refused — writing it would fabricate a source link.
 */

/** Payload shape a fact-carrying proposal must have to be applied on accept. */
export const FactPayloadSchema = z
  .object({
    entity: z.string().min(1),
    attribute: z.string().min(1),
    value: z.unknown(),
  })
  // z.unknown() parses even when the key is absent; an absent value would
  // reach the NOT NULL column as SQL NULL and 500. jsonb cannot hold
  // undefined, so this check is exactly "the key exists".
  .refine((o) => o.value !== undefined, "value is required");

export class DecisionError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const FACT_CHANGE_TYPES = new Set(["fact_proposal", "medication_change"]);

export async function decideProposal(
  client: pg.PoolClient,
  proposalId: string,
  decision: ProposalDecisionRequest,
): Promise<ProposalDecisionResponse> {
  await client.query("begin");
  try {
    const { rows } = await client.query(
      "select * from proposals where id = $1 for update",
      [proposalId],
    );
    const row = rows[0];
    if (!row) throw new DecisionError(404, "proposal not found");
    if (row.status !== "pending") {
      throw new DecisionError(
        409,
        `proposal already ${row.status}; decisions apply to pending proposals only`,
      );
    }

    const accepted = decision.action === "accept";
    const applies =
      row.change_type === "task_creation" ||
      FACT_CHANGE_TYPES.has(row.change_type);
    if (accepted && !applies) {
      // An accept the write-back cannot apply would mark the proposal
      // approved while dropping the change — requirement 4's dropped task,
      // permanently, since decided proposals cannot be re-decided.
      throw new DecisionError(
        422,
        `change_type ${row.change_type} has no write-back; accepting it would drop the approved change`,
      );
    }

    const eventInsert = await client.query(
      `insert into events (org_id, member_id, event_type, actor, occurred_at,
         duration_seconds, purpose, activity_description, payload)
       values ($1,$2,'ProposalDecided',$3,now(),$4,$5,$6,$7)
       returning id`,
      [
        row.org_id,
        row.member_id,
        decision.actor,
        decision.durationSeconds,
        `L1 review decision on ${row.workflow} ${row.change_type} proposal`,
        decision.activityDescription,
        JSON.stringify({
          proposalId,
          action: decision.action,
          note: decision.note ?? null,
          workflow: row.workflow,
          changeType: row.change_type,
        }),
      ],
    );
    const decisionEventId: string = eventInsert.rows[0].id;

    const updated = await client.query(
      `update proposals
       set status = $2, reviewed_by = $3, reviewed_at = now()
       where id = $1
       returning *`,
      [proposalId, accepted ? "approved" : "rejected", decision.actor],
    );

    let createdTaskId: string | null = null;
    let verifiedFactId: string | null = null;
    let supersededFactId: string | null = null;

    if (accepted && row.change_type === "task_creation") {
      const task = await client.query(
        `insert into tasks (org_id, member_id, proposal_id, title, detail, status)
         values ($1,$2,$3,$4,$5,'open')
         returning id`,
        [
          row.org_id,
          row.member_id,
          proposalId,
          row.summary,
          decision.note ?? null,
        ],
      );
      createdTaskId = task.rows[0].id;
    }

    if (accepted && FACT_CHANGE_TYPES.has(row.change_type)) {
      const parsed = FactPayloadSchema.safeParse(row.payload);
      if (!parsed.success) {
        throw new DecisionError(
          422,
          `${row.change_type} proposal payload is not fact-shaped (entity, attribute, value required); nothing was written`,
        );
      }
      if (row.source_event_id === null) {
        // Requirement 6: a verified fact without a real source event would be
        // a fabricated source link — a critical, never an automatic default.
        throw new DecisionError(
          422,
          `${row.change_type} proposal has no source event; verifying it would fabricate provenance`,
        );
      }
      const { entity, attribute, value } = parsed.data;

      // Serialize concurrent accepts targeting the same fact key: without
      // this, two decisions racing on (member, entity, attribute) both pass
      // the supersede step and the loser dies on the one-active-verified
      // unique index with a raw 23505. The advisory lock is transaction-
      // scoped and released on commit/rollback.
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`member_fact:${row.member_id}:${entity}:${attribute}`],
      );

      // Supersede-not-overwrite: close the prior active verified fact first
      // (the partial unique index allows one active verified per key), then
      // insert the replacement and link invalidated_by forward.
      const prior = await client.query(
        `update member_facts
         set status = 'superseded', valid_to = now()
         where member_id = $1 and entity = $2 and attribute = $3
           and status = 'verified' and valid_to is null
         returning id`,
        [row.member_id, entity, attribute],
      );
      supersededFactId = prior.rows[0]?.id ?? null;

      const fact = await client.query(
        `insert into member_facts (org_id, member_id, entity, attribute, value,
           status, source_event_id, verified_by, verified_at, valid_from)
         values ($1,$2,$3,$4,$5,'verified',$6,$7,now(),now())
         returning id`,
        [
          row.org_id,
          row.member_id,
          entity,
          attribute,
          JSON.stringify(value),
          row.source_event_id,
          decision.actor,
        ],
      );
      verifiedFactId = fact.rows[0].id;

      if (supersededFactId !== null) {
        await client.query(
          "update member_facts set invalidated_by = $2 where id = $1",
          [supersededFactId, verifiedFactId],
        );
      }
    }

    await client.query("commit");
    const proposal: Proposal = proposalFromRow(updated.rows[0]);
    return {
      proposal,
      decisionEventId,
      createdTaskId,
      verifiedFactId,
      supersededFactId,
    };
  } catch (err) {
    await client.query("rollback");
    // Backstop for races the advisory lock does not cover: surface a
    // conflict, not a raw database error.
    if ((err as { code?: string }).code === "23505") {
      throw new DecisionError(
        409,
        "a concurrent decision already verified a fact for this key; reload and re-review",
      );
    }
    throw err;
  }
}
