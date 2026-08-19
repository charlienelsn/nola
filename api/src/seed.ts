/**
 * Deterministic synthetic seed (plan section 8; docs/member-population.md).
 * Every id and timestamp is a fixed literal, so every run produces identical
 * rows. All five members are invented people — no real member data, ever.
 *
 * Wipes seeded tables first (TRUNCATE, which the events append-only trigger
 * intentionally does not block), so `pnpm seed` always converges to the same
 * state. `pnpm reset` additionally rebuilds the schema via `supabase db reset`.
 */
import { pool } from "./db.js";

const ORG = "00000000-0000-4000-8000-000000000001";
const CM = "care-manager:sofia-reyes (synthetic)";
const SEEDED_AT = "2026-08-12T09:00:00Z";

// Members m1..m5, intake events e1..e5 — fixed UUIDs.
const M = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000010${n}`);
const E = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000020${n}`);

const at = (ids: readonly string[], i: number): string => {
  const id = ids[i];
  if (!id) throw new Error(`no seed id at index ${i}`);
  return id;
};

const selfReported = (value: string) => ({
  value,
  selfReported: true,
  source: "member intake conversation",
  recordedAt: "2026-08-10",
});

/** docs/member-population.md is the source of truth for this profile. */
const members = [
  {
    id: M[0],
    legalName: "Rosa Delgado Marín",
    chosenName: "Rosa Delgado",
    pronouns: "she/her",
    dob: "1947-03-12", // 79
    primaryLanguage: "Spanish",
    interpreterNeeded: true,
    coverageType: "dual",
    coveragePlanName: "Bluebell Health D-SNP (synthetic plan)",
    raceEthnicity: selfReported("Latina (Puerto Rican)"),
    sexualOrientation: null,
    genderIdentity: null,
  },
  {
    id: M[1],
    legalName: "Walter T. Boone",
    chosenName: "Walt Boone",
    pronouns: "he/him",
    dob: "1942-11-02", // 83
    primaryLanguage: "English",
    interpreterNeeded: false,
    coverageType: "medicare",
    coveragePlanName: "Harborview Medicare Advantage (synthetic plan)",
    raceEthnicity: selfReported("Black"),
    sexualOrientation: null,
    genderIdentity: null,
  },
  {
    id: M[2],
    legalName: "Mei-Ling Chau",
    chosenName: "Mei-Ling Chau",
    pronouns: "she/her",
    dob: "1938-06-21", // 88
    primaryLanguage: "Cantonese",
    interpreterNeeded: true,
    coverageType: "dual",
    coveragePlanName: "Jade Harbor D-SNP (synthetic plan)",
    raceEthnicity: selfReported("Chinese American"),
    sexualOrientation: null,
    genderIdentity: null,
  },
  {
    // Chosen name differs from legal name; display uses chosen_name everywhere.
    id: M[3],
    legalName: "Samuel Ortiz Rivera",
    chosenName: "Samantha Ortiz",
    pronouns: "she/her",
    dob: "1958-01-30", // 68
    primaryLanguage: "English",
    interpreterNeeded: false,
    coverageType: "dual",
    coveragePlanName: "Bluebell Health D-SNP (synthetic plan)",
    raceEthnicity: selfReported("Latina (Dominican)"),
    sexualOrientation: null,
    genderIdentity: selfReported("transgender woman"),
  },
  {
    id: M[4],
    legalName: "Denise A. Whitfield",
    chosenName: "Miss Dee",
    pronouns: "she/her",
    dob: "1951-09-08", // 74
    primaryLanguage: "English",
    interpreterNeeded: false,
    coverageType: "medicaid",
    coveragePlanName: "Riverbend Medicaid Managed Care (synthetic plan)",
    raceEthnicity: selfReported("Black"),
    sexualOrientation: selfReported("lesbian"),
    genderIdentity: null,
  },
] as const;

type FactSeed = {
  id: string;
  memberId: string;
  entity: string;
  attribute: string;
  value: unknown;
  status: "proposed" | "verified";
  eventId: string;
  confidence: number;
};

let factSerial = 0;
const fact = (
  memberIdx: number,
  entity: string,
  attribute: string,
  value: unknown,
  status: "proposed" | "verified" = "verified",
  confidence = 0.95,
): FactSeed => {
  factSerial += 1;
  return {
    id: `00000000-0000-4000-8000-0000000003${String(factSerial).padStart(2, "0")}`,
    memberId: at(M, memberIdx),
    entity,
    attribute,
    value,
    status,
    eventId: at(E, memberIdx),
    confidence,
  };
};

const condition = (label: string) => ({ label, status: "active" });
const med = (name: string, dose: string, frequency: string) => ({
  name,
  dose,
  frequency,
});

const facts: FactSeed[] = [
  // m1 Rosa — hypertension, T2D, CKD; polypharmacy; SNAP + Access-A-Ride
  fact(0, "condition", "hypertension", condition("Hypertension")),
  fact(0, "condition", "type_2_diabetes", condition("Type 2 diabetes")),
  fact(
    0,
    "condition",
    "ckd_stage_3",
    condition("Chronic kidney disease, stage 3"),
  ),
  fact(0, "medication", "lisinopril", med("Lisinopril", "10 mg", "daily")),
  fact(0, "medication", "metformin", med("Metformin", "500 mg", "twice daily")),
  fact(0, "medication", "active_count", { count: 9 }),
  fact(0, "sdoh", "food", { need: "SNAP", status: "enrolled" }),
  fact(0, "sdoh", "transportation", {
    need: "Access-A-Ride",
    status: "enrolled",
  }),

  // m2 Walt — CHF, COPD, arthritis; lives alone, socially isolated
  fact(1, "condition", "chf", condition("Congestive heart failure")),
  fact(1, "condition", "copd", condition("COPD")),
  fact(1, "condition", "osteoarthritis", condition("Osteoarthritis")),
  fact(1, "medication", "furosemide", med("Furosemide", "40 mg", "daily")),
  fact(1, "medication", "active_count", { count: 11 }),
  fact(1, "sdoh", "isolation", {
    need: "social connection",
    status: "identified",
    detail: "lives alone, no regular visitors",
  }),
  fact(1, "sdoh", "transportation", {
    need: "Access-A-Ride",
    status: "application_started",
  }),
  // Suspected CKD from labs — proposed, awaiting care-manager verification
  fact(
    1,
    "condition",
    "ckd_stage_2",
    condition("Chronic kidney disease, stage 2"),
    "proposed",
    0.7,
  ),

  // m3 Mei-Ling — CHF, CKD, mild cognitive impairment; son is central caregiver
  fact(2, "condition", "chf", condition("Congestive heart failure")),
  fact(
    2,
    "condition",
    "ckd_stage_3",
    condition("Chronic kidney disease, stage 3"),
  ),
  fact(
    2,
    "condition",
    "mild_cognitive_impairment",
    condition("Mild cognitive impairment"),
  ),
  fact(2, "medication", "active_count", { count: 8 }),
  fact(2, "sdoh", "utilities", { need: "HEAP", status: "enrolled" }),

  // m4 Samantha — hypertension, COPD, anxiety; housing instability (NYCHA waitlist)
  fact(3, "condition", "hypertension", condition("Hypertension")),
  fact(3, "condition", "copd", condition("COPD")),
  fact(3, "condition", "anxiety", condition("Generalized anxiety disorder")),
  fact(3, "medication", "amlodipine", med("Amlodipine", "5 mg", "daily")),
  fact(3, "medication", "active_count", { count: 6 }),
  fact(3, "sdoh", "housing", {
    need: "stable housing",
    status: "identified",
    detail: "NYCHA waitlist",
  }),
  // Recently reported tobacco cessation — proposed until verified
  fact(
    3,
    "lifestyle",
    "tobacco_use",
    { status: "recently quit" },
    "proposed",
    0.75,
  ),

  // m5 Miss Dee — T2D, hypertension, depression; SNAP + HEAP
  fact(4, "condition", "type_2_diabetes", condition("Type 2 diabetes")),
  fact(4, "condition", "hypertension", condition("Hypertension")),
  fact(4, "condition", "depression", condition("Major depressive disorder")),
  fact(
    4,
    "medication",
    "insulin_glargine",
    med("Insulin glargine", "20 units", "nightly"),
  ),
  fact(4, "medication", "active_count", { count: 7 }),
  fact(4, "sdoh", "food", { need: "SNAP", status: "recertification_due" }),
  fact(4, "sdoh", "utilities", { need: "HEAP", status: "application_started" }),
];

const caregivers = [
  {
    id: "00000000-0000-4000-8000-000000000401",
    memberIdx: 0,
    name: "Carmen Delgado",
    relationship: "daughter",
    phone: "+1-555-0101",
    preferredLanguage: "Spanish",
    involvement: "central",
    isPrimary: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000402",
    memberIdx: 2,
    name: "Kevin Chau",
    relationship: "son",
    phone: "+1-555-0102",
    preferredLanguage: "English",
    involvement: "central",
    isPrimary: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000403",
    memberIdx: 3,
    name: "Luz Ferrer",
    relationship: "friend (chosen family)",
    phone: "+1-555-0103",
    preferredLanguage: "Spanish",
    involvement: "regular",
    isPrimary: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000404",
    memberIdx: 4,
    name: "Gloria Simms",
    relationship: "neighbor",
    phone: "+1-555-0104",
    preferredLanguage: "English",
    involvement: "occasional",
    isPrimary: false,
  },
  // m2 Walt intentionally has no caregiver contact: involvement varies from none to central.
];

const proposals = [
  {
    id: "00000000-0000-4000-8000-000000000501",
    memberIdx: 0,
    changeType: "task_creation",
    summary:
      "Schedule interpreter-supported follow-up call to review new CKD diet guidance",
  },
  {
    id: "00000000-0000-4000-8000-000000000502",
    memberIdx: 1,
    changeType: "task_creation",
    summary: "Verify suspected CKD stage 2 with PCP and confirm lab follow-up",
  },
  {
    id: "00000000-0000-4000-8000-000000000503",
    memberIdx: 2,
    changeType: "task_creation",
    summary: "Coordinate with son on memory-support referral options",
  },
  {
    id: "00000000-0000-4000-8000-000000000504",
    memberIdx: 3,
    changeType: "task_creation",
    summary: "Check NYCHA waitlist status and HRA housing options",
  },
  {
    id: "00000000-0000-4000-8000-000000000505",
    memberIdx: 4,
    changeType: "task_creation",
    summary: "Start SNAP recertification before the deadline",
  },
];

const workflows = [
  {
    id: "00000000-0000-4000-8000-000000000601",
    name: "discharge-summary",
    trigger: "DischargeReceived",
    medicationRelated: false,
  },
  // Medication-related: capped at L1 by the medication_ceiling constraint.
  {
    id: "00000000-0000-4000-8000-000000000602",
    name: "medication-reconciliation",
    trigger: "MedListReceived",
    medicationRelated: true,
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    // TRUNCATE bypasses the events append-only row trigger by design: it is
    // the reset path for local synthetic data, never a data-plane operation.
    await client.query(
      `truncate orgs, members, caregiver_contacts, events, member_facts,
        documents, interactions, proposals, tasks, evidence_entries, traces,
        eval_cases, workflow_registry cascade`,
    );

    await client.query(
      "insert into orgs (id, name, created_at) values ($1, $2, $3)",
      [ORG, "Nola (synthetic sandbox)", SEEDED_AT],
    );

    for (const m of members) {
      await client.query(
        `insert into members (id, org_id, legal_name, chosen_name, pronouns, dob,
           primary_language, interpreter_needed, coverage_type, coverage_plan_name,
           race_ethnicity, sexual_orientation, gender_identity, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          m.id,
          ORG,
          m.legalName,
          m.chosenName,
          m.pronouns,
          m.dob,
          m.primaryLanguage,
          m.interpreterNeeded,
          m.coverageType,
          m.coveragePlanName,
          m.raceEthnicity,
          m.sexualOrientation,
          m.genderIdentity,
          SEEDED_AT,
        ],
      );
    }

    for (const [i, memberId] of M.entries()) {
      await client.query(
        `insert into events (id, org_id, member_id, event_type, actor, occurred_at,
           duration_seconds, purpose, activity_description, payload, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$6)`,
        [
          E[i],
          ORG,
          memberId,
          "IntakeAssessmentCompleted",
          CM,
          `2026-08-10T${13 + i}:00:00Z`,
          2700,
          "Initial CCM intake assessment (synthetic)",
          "45-minute intake conversation with the member: reviewed hospital " +
            "discharge instructions, reconciled the current medication list, " +
            "confirmed coverage details, and drafted initial care goals " +
            "(synthetic)",
          {},
        ],
      );
    }

    for (const f of facts) {
      const verified = f.status === "verified";
      await client.query(
        `insert into member_facts (id, org_id, member_id, entity, attribute, value,
           status, source_event_id, confidence, verified_by, verified_at,
           valid_from, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,
        [
          f.id,
          ORG,
          f.memberId,
          f.entity,
          f.attribute,
          JSON.stringify(f.value),
          f.status,
          f.eventId,
          f.confidence,
          verified ? CM : null,
          verified ? SEEDED_AT : null,
          verified ? SEEDED_AT : null,
          SEEDED_AT,
        ],
      );
    }

    for (const c of caregivers) {
      await client.query(
        `insert into caregiver_contacts (id, org_id, member_id, name, relationship,
           phone, preferred_language, involvement, is_primary, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          c.id,
          ORG,
          M[c.memberIdx],
          c.name,
          c.relationship,
          c.phone,
          c.preferredLanguage,
          c.involvement,
          c.isPrimary,
          SEEDED_AT,
        ],
      );
    }

    for (const p of proposals) {
      await client.query(
        `insert into proposals (id, org_id, member_id, workflow, change_type, status,
           summary, payload, source_event_id, autonomy_level, created_at)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,'L1',$9)`,
        [
          p.id,
          ORG,
          M[p.memberIdx],
          "intake-review",
          p.changeType,
          p.summary,
          JSON.stringify({ kind: p.changeType }),
          E[p.memberIdx],
          SEEDED_AT,
        ],
      );
    }

    for (const w of workflows) {
      await client.query(
        `insert into workflow_registry (id, org_id, name, trigger_event_type,
           autonomy_level, medication_related, enabled, goldens_dir, created_at, updated_at)
         values ($1,$2,$3,$4,'L1',$5,true,$6,$7,$7)`,
        [
          w.id,
          ORG,
          w.name,
          w.trigger,
          w.medicationRelated,
          `evals/goldens/${w.name}`,
          SEEDED_AT,
        ],
      );
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  const counts = await pool.query(
    `select
       (select count(*) from members) as members,
       (select count(*) from member_facts where status = 'verified') as verified_facts,
       (select count(*) from member_facts where status = 'proposed') as proposed_facts,
       (select count(*) from proposals where status = 'pending') as pending_proposals`,
  );
  console.log("Seed complete (synthetic, deterministic):", counts.rows[0]);
  await pool.end();
}

await seed();
