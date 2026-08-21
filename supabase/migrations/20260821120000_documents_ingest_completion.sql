-- Ingest completion (plan section 9, POST /ingest).
--
-- A document's proposal set exists iff its metadata carries ingestCompleted,
-- set in the same transaction that commits the proposals. This makes three
-- states distinguishable that were not before:
--   * completed ingest        -> metadata.ingestCompleted = 'true'
--   * failed/crashed ingest   -> document present, no marker (retry allowed)
--   * legitimate zero-proposal run -> marker present, proposalCount 0
--
-- The partial unique index turns "one completed ingest per (member, content)"
-- into a database guarantee: two concurrent ingests of identical bytes can
-- both store evidence, but only one can complete — the loser's marker update
-- fails with 23505 and its proposals transaction rolls back.
create unique index documents_one_completed_ingest
  on documents (member_id, (metadata->>'sha256'))
  where metadata->>'ingestCompleted' = 'true' and member_id is not null;
