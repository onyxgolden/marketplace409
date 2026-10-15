# Team Brain schema snapshot

Generated from `migrations/001_team_brain_schema.sql`. Do not hand-edit;
regenerate with `node scripts/team-brain/report/generateSchemaSnapshot.mjs` (local only).

## tables (6)
- team_brain_handoff_events
- team_brain_handoffs
- team_brain_obligation_dependencies
- team_brain_obligation_events
- team_brain_obligations
- team_brain_schema_version

## team_brain_handoff_events

columns:
- seq: integer identity(ALWAYS) nullable=NO default=none
- handoff_id: text nullable=NO default=none
- from_state: text nullable=NO default=none
- to_state: text nullable=NO default=none
- actor: text nullable=NO default=none
- recorded_at: text nullable=NO default=none
- reason: text nullable=NO default=none
- artifact_repo: text nullable=YES default=none
- artifact_path: text nullable=YES default=none
- artifact_commit: text nullable=YES default=none
- artifact_blob: text nullable=YES default=none
- artifact_head: text nullable=YES default=none
- queue_repo: text nullable=YES default=none
- queue_path: text nullable=YES default=none
- queue_commit: text nullable=YES default=none
- queue_blob: text nullable=YES default=none
constraints:
- team_brain_handoff_events_actor_not_null: CHECK check(actor IS NOT NULL)
- team_brain_handoff_events_from_state_not_null: CHECK check(from_state IS NOT NULL)
- team_brain_handoff_events_handoff_id_fkey: FOREIGN KEY
- team_brain_handoff_events_handoff_id_not_null: CHECK check(handoff_id IS NOT NULL)
- team_brain_handoff_events_pkey: PRIMARY KEY
- team_brain_handoff_events_reason_not_null: CHECK check(reason IS NOT NULL)
- team_brain_handoff_events_recorded_at_check: CHECK check(team_brain_is_valid_utc_iso(recorded_at))
- team_brain_handoff_events_recorded_at_not_null: CHECK check(recorded_at IS NOT NULL)
- team_brain_handoff_events_seq_not_null: CHECK check(seq IS NOT NULL)
- team_brain_handoff_events_to_state_not_null: CHECK check(to_state IS NOT NULL)
indexes:
- team_brain_handoff_events_handoff_id_idx
- team_brain_handoff_events_pkey

## team_brain_handoffs

columns:
- handoff_id: text nullable=NO default=none
- state: text nullable=NO default='OPEN'::text
- artifact_repo: text nullable=YES default=none
- artifact_path: text nullable=YES default=none
- artifact_commit: text nullable=YES default=none
- artifact_blob: text nullable=YES default=none
- artifact_head: text nullable=YES default=none
- queue_repo: text nullable=YES default=none
- queue_path: text nullable=YES default=none
- queue_commit: text nullable=YES default=none
- queue_blob: text nullable=YES default=none
- created_at: text nullable=NO default=none
- updated_at: text nullable=NO default=none
constraints:
- team_brain_handoffs_created_at_check: CHECK check(team_brain_is_valid_utc_iso(created_at))
- team_brain_handoffs_created_at_not_null: CHECK check(created_at IS NOT NULL)
- team_brain_handoffs_handoff_id_not_null: CHECK check(handoff_id IS NOT NULL)
- team_brain_handoffs_pkey: PRIMARY KEY
- team_brain_handoffs_state_check: CHECK check((state = ANY (ARRAY['OPEN'::text, 'OUTCOME_WRITTEN'::text, 'READBACK_VERIFIED'::text, 'QUEUE_UPDATED'::text, 'COMPLETE'::text])))
- team_brain_handoffs_state_not_null: CHECK check(state IS NOT NULL)
- team_brain_handoffs_updated_at_check: CHECK check(team_brain_is_valid_utc_iso(updated_at))
- team_brain_handoffs_updated_at_not_null: CHECK check(updated_at IS NOT NULL)
indexes:
- team_brain_handoffs_pkey

## team_brain_obligation_dependencies

columns:
- obligation_id: text nullable=NO default=none
- depends_on_id: text nullable=NO default=none
constraints:
- team_brain_obligation_dependencies_check: CHECK check((obligation_id <> depends_on_id))
- team_brain_obligation_dependencies_depends_on_id_fkey: FOREIGN KEY
- team_brain_obligation_dependencies_depends_on_id_not_null: CHECK check(depends_on_id IS NOT NULL)
- team_brain_obligation_dependencies_obligation_id_fkey: FOREIGN KEY
- team_brain_obligation_dependencies_obligation_id_not_null: CHECK check(obligation_id IS NOT NULL)
- team_brain_obligation_dependencies_pkey: PRIMARY KEY
indexes:
- team_brain_obligation_dependencies_pkey

## team_brain_obligation_events

columns:
- seq: integer identity(ALWAYS) nullable=NO default=none
- obligation_id: text nullable=NO default=none
- actor: text nullable=NO default=none
- recorded_at: text nullable=NO default=none
- event_type: text nullable=NO default=none
- reason: text nullable=NO default=none
- evidence_refs: text nullable=NO default='[]'::text
- extra: text nullable=NO default='{}'::text
constraints:
- team_brain_obligation_events_actor_not_null: CHECK check(actor IS NOT NULL)
- team_brain_obligation_events_event_type_not_null: CHECK check(event_type IS NOT NULL)
- team_brain_obligation_events_evidence_refs_not_null: CHECK check(evidence_refs IS NOT NULL)
- team_brain_obligation_events_extra_not_null: CHECK check(extra IS NOT NULL)
- team_brain_obligation_events_obligation_id_fkey: FOREIGN KEY
- team_brain_obligation_events_obligation_id_not_null: CHECK check(obligation_id IS NOT NULL)
- team_brain_obligation_events_pkey: PRIMARY KEY
- team_brain_obligation_events_reason_not_null: CHECK check(reason IS NOT NULL)
- team_brain_obligation_events_recorded_at_check: CHECK check(team_brain_is_valid_utc_iso(recorded_at))
- team_brain_obligation_events_recorded_at_not_null: CHECK check(recorded_at IS NOT NULL)
- team_brain_obligation_events_seq_not_null: CHECK check(seq IS NOT NULL)
indexes:
- team_brain_obligation_events_obligation_id_idx
- team_brain_obligation_events_pkey

## team_brain_obligations

columns:
- obligation_id: text nullable=NO default=none
- kind: text nullable=NO default=none
- filed_at: text nullable=NO default=none
- source_repo: text nullable=NO default=none
- source_path: text nullable=NO default=none
- source_commit: text nullable=YES default=none
- source_blob: text nullable=YES default=none
- source_head: text nullable=YES default=none
- state: text nullable=NO default='OPEN'::text
- retention_disposition: text nullable=NO default=none
- supersedes: text nullable=YES default=none
- superseded_by: text nullable=YES default=none
- priority_override: text nullable=YES default=none
- created_at: text nullable=NO default=none
constraints:
- team_brain_obligations_check: CHECK check(((supersedes IS NULL) OR (supersedes <> obligation_id)))
- team_brain_obligations_check1: CHECK check(((superseded_by IS NULL) OR (superseded_by <> obligation_id)))
- team_brain_obligations_created_at_check: CHECK check(team_brain_is_valid_utc_iso(created_at))
- team_brain_obligations_created_at_not_null: CHECK check(created_at IS NOT NULL)
- team_brain_obligations_filed_at_check: CHECK check(team_brain_is_valid_utc_iso(filed_at))
- team_brain_obligations_filed_at_not_null: CHECK check(filed_at IS NOT NULL)
- team_brain_obligations_kind_check: CHECK check((kind = ANY (ARRAY['TASK'::text, 'AUTHORIZATION'::text, 'VERDICT'::text, 'EVIDENCE'::text])))
- team_brain_obligations_kind_not_null: CHECK check(kind IS NOT NULL)
- team_brain_obligations_obligation_id_not_null: CHECK check(obligation_id IS NOT NULL)
- team_brain_obligations_pkey: PRIMARY KEY
- team_brain_obligations_retention_disposition_not_null: CHECK check(retention_disposition IS NOT NULL)
- team_brain_obligations_source_path_not_null: CHECK check(source_path IS NOT NULL)
- team_brain_obligations_source_repo_not_null: CHECK check(source_repo IS NOT NULL)
- team_brain_obligations_state_check: CHECK check((state = ANY (ARRAY['OPEN'::text, 'IN_PROGRESS'::text, 'CLOSED'::text, 'REVOKED'::text, 'SUPERSEDED'::text])))
- team_brain_obligations_state_not_null: CHECK check(state IS NOT NULL)
- team_brain_obligations_superseded_by_fkey: FOREIGN KEY
- team_brain_obligations_supersedes_fkey: FOREIGN KEY
indexes:
- team_brain_obligations_pkey

## team_brain_schema_version

columns:
- version: integer nullable=NO default=none
- applied_at: text nullable=NO default=none
constraints:
- team_brain_schema_version_applied_at_not_null: CHECK check(applied_at IS NOT NULL)
- team_brain_schema_version_pkey: PRIMARY KEY
- team_brain_schema_version_version_not_null: CHECK check(version IS NOT NULL)
indexes:
- team_brain_schema_version_pkey

