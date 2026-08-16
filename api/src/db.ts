import type { Member, MemberFact } from "@nola/shared";
import pg from "pg";

/**
 * Local Supabase Postgres. No real member data exists behind this URL, ever —
 * synthetic seed only (CLAUDE.md rule 2).
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54342/postgres";

export const pool = new pg.Pool({ connectionString: DATABASE_URL });

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
