# Member population — synthetic generation profile

Who Nola serves, expressed as **distributions for synthetic generation**.
This document is the source of truth for all synthetic members, seed data,
and golden cases. It describes a population, never real individuals; the
evidence firewall (CLAUDE.md rule 3) applies — nothing here derives from any
real person's record, and no observed detail from shadowing may be copied in.

## Population profile

**Age and place.** 65 and older, with the distribution skewed to 68–88.
Based in New York City, across all five boroughs.

**Chronic conditions.** Two or more chronic conditions — CCM-eligible by
definition. Draw from realistic elder prevalence: hypertension, type 2
diabetes, congestive heart failure, COPD, chronic kidney disease, arthritis,
depression/anxiety, mild cognitive impairment.

**Medications.** Polypharmacy is the norm: typically 5–12 active
medications, correlated with condition count.

**Coverage.** Medicare across the board; most members are dual-eligible
(Medicare + Medicaid), often enrolled in a D-SNP or a Medicaid managed care
plan. Plan names in synthetic data are invented and marked synthetic.

**Communities.** Largely from underserved communities: Black, Latino, LGBT,
and immigrant elders. Language mix includes Spanish and others (Cantonese,
Mandarin, Russian, Haitian Creole, Bengali among them); interpreter needs
are common and recorded per member.

**Social drivers (SDOH).** Common needs: housing (including NYCHA), food
(SNAP), transportation (Access-A-Ride), utilities (HEAP), and social
isolation. Caregiver involvement varies from none to central; caregivers may
be family, friends, chosen family, or neighbors, with their own language
preferences.

**NYC context for realistic documents.** Synthetic source documents should
read like they came from the real system of care: NYC Health + Hospitals and
other safety-net hospitals, borough-specific community-based organizations,
and HRA benefit workflows (SNAP, HEAP, Medicaid recertification).

## Generation rules

Sample attributes with realistic prevalence but independent variation — no
demographic caricatures; a domain expert reviews generated cases;
demographic attributes are context for care, never inputs to escalation or
autonomy decisions.

Additionally:

- Demographic fields (race/ethnicity, sexual orientation, gender identity)
  are **self-reported**, nullable, and carry provenance (source and date).
- Display names use `chosen_name` everywhere; some members' chosen names
  differ from their legal names, and generation must respect that.
- SDOH needs are modeled as `member_facts` entities (housing, food,
  transportation, utilities, isolation), not member columns.
- Names are plausible for the population but clearly invented; never reuse
  a real person's full name.
