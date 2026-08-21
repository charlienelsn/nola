import type { MemberContext } from "@nola/brain";
import type pg from "pg";

/**
 * Live whole-member context assembly (decision 4: whole member, no retrieval
 * layer) — members, caregiver_contacts, and the derived verified-facts view
 * read into the same MemberContext shape the goldens' `member` block uses,
 * so eval runs and live ingestion share one context path exactly as
 * brain/src/context.ts promises.
 */
export async function assembleMemberContext(
  client: pg.PoolClient,
  memberId: string,
): Promise<MemberContext | null> {
  const member = await client.query("select * from members where id = $1", [
    memberId,
  ]);
  const m = member.rows[0];
  if (!m) return null;

  const facts = await client.query(
    `select entity, attribute, value from member_current_state
     where member_id = $1 order by entity, attribute`,
    [memberId],
  );
  const caregivers = await client.query(
    `select name, relationship, involvement, preferred_language
     from caregiver_contacts where member_id = $1 order by created_at, id`,
    [memberId],
  );

  return {
    memberId: m.id,
    chosenName: m.chosen_name,
    legalName: m.legal_name,
    dob: m.dob, // verbatim ISO date (db.ts pins the DATE type parser)
    primaryLanguage: m.primary_language,
    interpreterNeeded: m.interpreter_needed,
    coverage: { type: m.coverage_type, planName: m.coverage_plan_name ?? null },
    currentFacts: facts.rows.map((f) => ({
      entity: f.entity,
      attribute: f.attribute,
      value: f.value,
    })),
    caregivers: caregivers.rows.map((c) => ({
      name: c.name,
      relationship: c.relationship,
      involvement: c.involvement,
      preferredLanguage: c.preferred_language ?? "English",
    })),
  };
}
