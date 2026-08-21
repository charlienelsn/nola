import type {
  Member,
  MemberFact,
  Proposal,
  ProposalWithSource,
} from "@nola/shared";
import pg from "pg";

/**
 * Local Supabase Postgres. No real member data exists behind this URL, ever —
 * synthetic seed only (CLAUDE.md rule 2).
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54342/postgres";

// DATE columns (oid 1082) return as the verbatim ISO string, not a JS Date
// at local midnight: the Brain's identity guard compares member dob to the
// document's ISO date, and a Date-stringified dob would force a mismatch on
// every ingest (and a toISOString round-trip shifts a day west of UTC).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

/**
 * Roll back without masking the original failure: if the connection itself
 * died, rollback throws too — log it and let the first error surface. The
 * pool discards broken connections on release.
 */
export async function safeRollback(client: pg.PoolClient): Promise<void> {
  try {
    await client.query("rollback");
  } catch (rollbackErr) {
    console.error("rollback failed (original error follows)", rollbackErr);
  }
}

const iso = (v: unknown): string | null => {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
};

// biome-ignore lint/suspicious/noExplicitAny: raw pg row boundary; Zod validates downstream
type Row = Record<string, any>;

export function memberFromRow(r: Row): Member {
  return {
    id: r.id,
    orgId: r.org_id,
    legalName: r.legal_name,
    chosenName: r.chosen_name,
    pronouns: r.pronouns ?? null,
    dob: String(r.dob),
    primaryLanguage: r.primary_language,
    interpreterNeeded: r.interpreter_needed,
    coverage: { type: r.coverage_type, planName: r.coverage_plan_name ?? null },
    raceEthnicity: r.race_ethnicity ?? null,
    sexualOrientation: r.sexual_orientation ?? null,
    genderIdentity: r.gender_identity ?? null,
    createdAt: iso(r.created_at) ?? "",
  };
}

export function factFromRow(r: Row): MemberFact {
  return {
    id: r.id,
    orgId: r.org_id,
    memberId: r.member_id,
    entity: r.entity,
    attribute: r.attribute,
    value: r.value,
    status: r.status,
    sourceEventId: r.source_event_id,
    confidence: r.confidence == null ? null : Number(r.confidence),
    verifiedBy: r.verified_by ?? null,
    verifiedAt: iso(r.verified_at),
    validFrom: iso(r.valid_from),
    validTo: iso(r.valid_to),
    invalidatedBy: r.invalidated_by ?? null,
  };
}

export function proposalFromRow(r: Row): Proposal {
  return {
    id: r.id,
    orgId: r.org_id,
    memberId: r.member_id,
    workflow: r.workflow,
    changeType: r.change_type,
    status: r.status,
    summary: r.summary,
    payload: r.payload,
    sourceEventId: r.source_event_id ?? null,
    autonomyLevel: r.autonomy_level,
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: iso(r.created_at) ?? "",
  };
}

/** Row from the proposals join in GET /proposals (member + source event). */
export function proposalWithSourceFromRow(r: Row): ProposalWithSource {
  return {
    ...proposalFromRow(r),
    member: {
      id: r.member_id,
      chosenName: r.chosen_name,
      primaryLanguage: r.primary_language,
      interpreterNeeded: r.interpreter_needed,
    },
    sourceEvent:
      r.event_id == null
        ? null
        : {
            id: r.event_id,
            eventType: r.event_type,
            actor: r.event_actor,
            occurredAt: iso(r.occurred_at) ?? "",
            purpose: r.purpose,
            activityDescription: r.activity_description,
          },
    sourceDocument:
      r.document_id == null
        ? null
        : {
            id: r.document_id,
            docType: r.document_doc_type,
            source: r.document_source,
            content: r.document_content,
          },
  };
}
