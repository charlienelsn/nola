import { z } from "zod";

/**
 * Whole-member context snapshot — the compact projection the Brain assembles
 * before every model call (decision 4: whole member, no retrieval layer).
 * The shape matches the goldens' `member` block exactly so eval runs and
 * live runs share one context path: live assembly will read members,
 * caregiver_contacts, and the verified-facts view into this same type; the
 * eval runner parses it straight from the golden case file.
 */
export const MemberContextSchema = z.object({
  memberId: z.string().uuid(),
  chosenName: z.string(),
  legalName: z.string(),
  dob: z.string(), // ISO date
  primaryLanguage: z.string(),
  interpreterNeeded: z.boolean(),
  coverage: z.object({ type: z.string(), planName: z.string().nullable() }),
  currentFacts: z.array(
    z.object({ entity: z.string(), attribute: z.string(), value: z.unknown() }),
  ),
  caregivers: z.array(
    z.object({
      name: z.string(),
      relationship: z.string(),
      involvement: z.string(),
      preferredLanguage: z.string(),
    }),
  ),
});
export type MemberContext = z.infer<typeof MemberContextSchema>;

/**
 * Render the snapshot for the prompt. Each verified fact renders its
 * citation object (`against={"entity":...,"attribute":...}`) in exactly the
 * shape a contradiction must echo. (The earlier `entity/attribute`
 * slash-join read as one token: the 2026-08-21 baseline found all four
 * expected contradictions but mis-keyed every citation, taking "attribute"
 * from inside the JSON value — none resolvable against a fact row.)
 */
export function renderMemberContext(member: MemberContext): string {
  const facts = member.currentFacts
    .map(
      (f) =>
        `- against=${JSON.stringify({ entity: f.entity, attribute: f.attribute })} value=${JSON.stringify(f.value)}`,
    )
    .join("\n");
  const caregivers = member.caregivers
    .map(
      (c) =>
        `- ${c.name} (${c.relationship}, involvement: ${c.involvement}, prefers ${c.preferredLanguage})`,
    )
    .join("\n");
  return [
    `Member ${member.memberId}`,
    `- Chosen name: ${member.chosenName}`,
    `- Legal name: ${member.legalName}`,
    `- Date of birth: ${member.dob}`,
    `- Primary language: ${member.primaryLanguage}${member.interpreterNeeded ? " (interpreter needed)" : ""}`,
    `- Coverage: ${member.coverage.type}${member.coverage.planName ? ` — ${member.coverage.planName}` : ""}`,
    "",
    'Verified facts (a contradiction\'s "against" copies one of these against= objects verbatim):',
    facts || "- none on record",
    "",
    "Caregivers:",
    caregivers || "- none recorded",
  ].join("\n");
}
