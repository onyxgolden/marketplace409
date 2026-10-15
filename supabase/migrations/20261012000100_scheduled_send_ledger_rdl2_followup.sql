-- Receipt-delivery confirmation ledger: RDL-002A / RDL-002B / RDL-004A / RDL-004B
-- follow-up corrections (2026-10-12 re-review, PR #619).
--
-- RDL-002B: pin the provider request to the durable logical send. The
-- ledger row persists the FIRST provider idempotency key and the payload
-- digest rendered for it (provider_request_key, payload_digest) BEFORE the
-- first provider call. Retries reconcile/retry THAT request under the same
-- key; a changed payload is an explicit separate logical operation, never
-- a silent replacement of an ambiguous send.
--
-- RDL-004A: bind each attempt row to its real attempt identity/generation.
-- claim_token on the ledger row is an unguessable per-claim-generation
-- secret, rotated on every fresh claim and every takeover; each attempt
-- row carries the token it was recorded under plus a monotonic
-- attempt_ordinal per (ledger_id, delivery_id). Recording verifies the
-- token, and derivation orders by ordinal -- never by wall-clock
-- insertion/completion time or UUID ordering.
--
-- RDL-004B: summary_version is the compare-and-swap guard for the
-- derived summary update; concurrent derivations retry instead of
-- clobbering each other. (The watchdog additionally derives failure
-- state directly from attempt evidence, treating the stored summary as
-- a cache -- it never repairs the summary itself.)
--
-- DEPLOY NOTE: migration file only. Applying to production Supabase is a
-- separate, explicit Jason authorization (not granted by the proposal or
-- by this PR).

alter table scheduled_send_ledger
  add column if not exists provider_request_key text;
alter table scheduled_send_ledger
  add column if not exists payload_digest text;
alter table scheduled_send_ledger
  add column if not exists claim_token text;
alter table scheduled_send_ledger
  add column if not exists summary_version integer not null default 0;

alter table scheduled_send_attempts
  add column if not exists claim_token text;
alter table scheduled_send_attempts
  add column if not exists attempt_ordinal integer not null default 0;
