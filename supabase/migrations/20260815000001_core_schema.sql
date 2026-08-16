-- Core schema, Day 2 (plan sections 3, 7, 8).
-- The people Nola serves are members. Synthetic data only, every environment.
-- org_id on every table: single org today, but the boundary is explicit from day one.

-- ---------------------------------------------------------------------------
-- orgs — FK target so org_id means something.
-- ---------------------------------------------------------------------------
create table orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- members — identity and coverage. Display uses chosen_name everywhere.
-- Demographic fields are self-reported, nullable, provenance-carrying jsonb:
--   { "value": text, "selfReported": true, "source": text, "recordedAt": date }
-- They are context for care, never inputs to escalation or autonomy decisions
-- (docs/member-population.md).
-- ---------------------------------------------------------------------------
create table members (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  legal_name         text not null,
  chosen_name        text not null,
  pronouns           text,
  dob                date not null,
  primary_language   text not null default 'English',
  interpreter_needed boolean not null default false,
  coverage_type      text not null check (coverage_type in ('medicare', 'medicaid', 'dual')),
  coverage_plan_name text,
  race_ethnicity     jsonb check (race_ethnicity is null or (race_ethnicity ? 'value' and (race_ethnicity ->> 'selfReported')::boolean)),
  sexual_orientation jsonb check (sexual_orientation is null or (sexual_orientation ? 'value' and (sexual_orientation ->> 'selfReported')::boolean)),
  gender_identity    jsonb check (gender_identity is null or (gender_identity ? 'value' and (gender_identity ->> 'selfReported')::boolean)),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index members_org_idx on members (org_id);

-- ---------------------------------------------------------------------------
-- caregiver_contacts — involvement varies from none (no row) to central.
-- ---------------------------------------------------------------------------
create table caregiver_contacts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  member_id          uuid not null references members(id),
  name               text not null,
  relationship       text not null,
  phone              text,
  preferred_language text,
  involvement        text not null check (involvement in ('occasional', 'regular', 'central')),
  is_primary         boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now()
);

create index caregiver_contacts_member_idx on caregiver_contacts (member_id);

-- ---------------------------------------------------------------------------
-- events — append-only log; carries the billing evidence fields.
-- TRUNCATE is intentionally not blocked: it is reserved for local reset tooling
-- and never runs against shared data.
-- ---------------------------------------------------------------------------
create table events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id),
  member_id        uuid not null references members(id),
  event_type       text not null,
  actor            text not null,
  occurred_at      timestamptz not null,
  duration_seconds integer check (duration_seconds >= 0),
  purpose          text not null,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index events_member_occurred_idx on events (member_id, occurred_at);

create function reject_event_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'events is append-only: % rejected', tg_op;
end;
$$;

create trigger events_append_only
  before update or delete on events
  for each row execute function reject_event_mutation();

-- ---------------------------------------------------------------------------
-- member_facts — facts, not blobs. Lifecycle: proposed -> verified ->
-- superseded/retracted, forward only. Current state is a derived view.
-- ---------------------------------------------------------------------------
create table member_facts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  member_id       uuid not null references members(id),
  entity          text not null,
  attribute       text not null,
  value           jsonb not null,
  status          text not null default 'proposed'
                    check (status in ('proposed', 'verified', 'superseded', 'retracted')),
  source_event_id uuid not null references events(id),
  confidence      numeric check (confidence between 0 and 1),
  verified_by     text,
  verified_at     timestamptz,
  valid_from      timestamptz,
  valid_to        timestamptz,
  invalidated_by  uuid references member_facts(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- a fact cannot be (or have been) verified without a verifier
  constraint verified_facts_have_verifier
    check (status in ('proposed', 'retracted') or (verified_by is not null and verified_at is not null))
);

create index member_facts_member_idx on member_facts (member_id, entity, attribute);
create index member_facts_status_idx on member_facts (member_id, status);

-- THE CONSTRAINT THAT MATTERS: at most one active verified fact per
-- (member_id, entity, attribute).
create unique index member_facts_one_active_verified
  on member_facts (member_id, entity, attribute)
  where status = 'verified' and valid_to is null;

-- Forward-only status transitions; identity and provenance columns immutable;
-- a verified fact's value is immutable — supersede it, never rewrite it.
create function enforce_fact_transitions() returns trigger
language plpgsql as $$
begin
  if new.member_id  is distinct from old.member_id
    or new.entity   is distinct from old.entity
    or new.attribute is distinct from old.attribute
    or new.source_event_id is distinct from old.source_event_id then
    raise exception 'member_facts identity and provenance columns are immutable';
  end if;

  if old.status = 'verified' and new.value is distinct from old.value then
    raise exception 'a verified fact''s value is immutable: supersede it with a new fact';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'proposed' and new.status in ('verified', 'superseded', 'retracted'))
      or (old.status = 'verified' and new.status in ('superseded', 'retracted'))
    ) then
      raise exception 'member_facts status only moves forward: % -> % rejected',
        old.status, new.status;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger member_facts_transitions
  before update on member_facts
  for each row execute function enforce_fact_transitions();

-- Current state is a derived view: active verified facts only.
create view member_current_state as
  select *
  from member_facts
  where status = 'verified' and valid_to is null;

-- ---------------------------------------------------------------------------
-- documents — source documents are evidence; content is retained verbatim and
-- may use the source's own terminology. Mapping to the member happens at
-- ingestion.
-- ---------------------------------------------------------------------------
create table documents (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  member_id   uuid references members(id),
  event_id    uuid references events(id),
  doc_type    text not null,
  source      text not null,
  received_at timestamptz not null,
  content     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index documents_member_idx on documents (member_id);

-- ---------------------------------------------------------------------------
-- interactions — calls, messages, visits with or about a member.
-- ---------------------------------------------------------------------------
create table interactions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id),
  member_id        uuid not null references members(id),
  event_id         uuid references events(id),
  channel          text not null,
  direction        text check (direction in ('inbound', 'outbound')),
  occurred_at      timestamptz not null,
  duration_seconds integer check (duration_seconds >= 0),
  summary          text,
  created_by       text not null,
  created_at       timestamptz not null default now()
);

create index interactions_member_idx on interactions (member_id, occurred_at);

-- ---------------------------------------------------------------------------
-- proposals — what the Brain wants to do; humans review per autonomy level.
-- ---------------------------------------------------------------------------
create table proposals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id),
  member_id       uuid not null references members(id),
  workflow        text not null,
  change_type     text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'expired')),
  summary         text not null,
  payload         jsonb not null,
  source_event_id uuid references events(id),
  autonomy_level  text not null default 'L1'
                    check (autonomy_level in ('L0', 'L1', 'L2', 'L3')),
  reviewed_by     text,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index proposals_member_status_idx on proposals (member_id, status);

-- ---------------------------------------------------------------------------
-- tasks — work for humans (and later, agents) to do.
-- ---------------------------------------------------------------------------
create table tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  member_id   uuid references members(id),
  proposal_id uuid references proposals(id),
  title       text not null,
  detail      text,
  status      text not null default 'open'
                check (status in ('open', 'in_progress', 'done', 'cancelled')),
  assignee    text,
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index tasks_member_status_idx on tasks (member_id, status);

-- ---------------------------------------------------------------------------
-- evidence_entries — verbatim excerpts tying facts/proposals to their sources.
-- ---------------------------------------------------------------------------
create table evidence_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id),
  member_id   uuid not null references members(id),
  fact_id     uuid references member_facts(id),
  proposal_id uuid references proposals(id),
  document_id uuid references documents(id),
  event_id    uuid references events(id),
  excerpt     text not null,
  location    jsonb,
  created_at  timestamptz not null default now(),
  constraint evidence_supports_something
    check (fact_id is not null or proposal_id is not null)
);

create index evidence_entries_fact_idx on evidence_entries (fact_id);

-- ---------------------------------------------------------------------------
-- traces — every model call, OpenTelemetry GenAI format.
-- ---------------------------------------------------------------------------
create table traces (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  trace_id       text not null,
  span_id        text not null,
  parent_span_id text,
  operation      text not null,
  model          text not null,
  prompt_ref     text not null,
  context_refs   jsonb not null default '[]'::jsonb,
  output         jsonb,
  input_tokens   integer not null,
  output_tokens  integer not null,
  latency_ms     integer not null,
  cost_usd       numeric(12, 6),
  member_id      uuid references members(id),
  workflow       text,
  attributes     jsonb not null default '{}'::jsonb,
  started_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index traces_trace_idx on traces (trace_id);
create index traces_member_idx on traces (member_id);

-- ---------------------------------------------------------------------------
-- eval_cases — golden cases; synthetic, written fresh (the evidence firewall).
-- ---------------------------------------------------------------------------
create table eval_cases (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id),
  workflow       text not null,
  name           text not null,
  description    text,
  input          jsonb not null,
  expected       jsonb not null,
  severity_focus text check (severity_focus in ('critical', 'major', 'minor')),
  tags           text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workflow, name)
);

-- ---------------------------------------------------------------------------
-- workflow_registry — one row per workflow module. The medication ceiling
-- (CLAUDE.md rule 5) is a table constraint, not a convention.
-- ---------------------------------------------------------------------------
create table workflow_registry (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references orgs(id),
  name               text not null unique,
  trigger_event_type text not null,
  autonomy_level     text not null default 'L1'
                       check (autonomy_level in ('L0', 'L1', 'L2', 'L3')),
  medication_related boolean not null default false,
  enabled            boolean not null default true,
  goldens_dir        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint medication_ceiling
    check (not medication_related or autonomy_level in ('L0', 'L1'))
);
