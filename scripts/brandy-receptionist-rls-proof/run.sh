#!/bin/bash
# Behavioral RLS + FK + encryption-shape proof for
# 20261108020000_brandy_receptionist_track2.sql (fix round 2).
# Self-contained: drops/recreates the scratch rlsproof database on the local
# PG16 cluster (socket /tmp, port 5444 — see README.md), applies setup.sql,
# applies the real migration twice, then proves the post-fix authorization
# for every persona. Exits non-zero on any failed case.
# Never point it at production.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20261108020000_brandy_receptionist_track2.sql"
PSQL="psql -h /tmp -p 5444 -U postgres -d rlsproof -v ON_ERROR_STOP=1 -q -t -A"
PSQL_ADMIN="psql -h /tmp -p 5444 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A"
A=11111111-1111-1111-1111-111111111111  # workspace A primary owner
B=22222222-2222-2222-2222-222222222222  # unrelated owner (workspace B)
C=33333333-3333-3333-3333-333333333333  # A: active co_owner
I=44444444-4444-4444-4444-444444444444  # A: invited co_owner
S=55555555-5555-5555-5555-555555555555  # A: suspended co_owner
M=66666666-6666-6666-6666-666666666666  # A: active manager
K=77777777-7777-7777-7777-777777777777  # A: active bookkeeper
R=88888888-8888-8888-8888-888888888888  # A: active read_only member
PASS=0; FAIL=0

run_case() { # $1 name, $2 expect (ok|deny), $3 sql (includes set/role preamble)
  local name="$1" expect="$2" sql="$3" out code
  out=$($PSQL -c "$sql" 2>&1); code=$?
  if [ "$expect" = ok ]; then
    if [ $code -eq 0 ]; then echo "PASS: $name"; PASS=$((PASS+1));
    else echo "FAIL: $name (expected success, exit $code: $out)"; FAIL=$((FAIL+1)); fi
  else
    # Denial evidence: an RLS violation, a 42501 code, the RPCs' own
    # owner-check exception, or an ACL "permission denied" (psql's default
    # verbosity does not print the SQLSTATE, so match the message text).
    if [ $code -ne 0 ] && { echo "$out" | grep -q "violates row-level security policy" || echo "$out" | grep -q "42501" || echo "$out" | grep -q "permission denied for" || echo "$out" | grep -q "does not match authenticated owner"; }; then echo "PASS: $name (denied)"; PASS=$((PASS+1));
    else echo "FAIL: $name (expected RLS/42501 denial, exit $code: $out)"; FAIL=$((FAIL+1)); fi
  fi
}
run_bool() { # $1 name, $2 expect (t|f), $3 sql returning one boolean
  local name="$1" expect="$2" sql="$3" out code
  out=$($PSQL -c "$sql" 2>&1); code=$?
  if [ $code -eq 0 ] && [ "$out" = "$expect" ]; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (expected $expect, exit $code: $out)"; FAIL=$((FAIL+1)); fi
}
run_count() { # $1 name, $2 expect (int), $3 sql returning one count
  local name="$1" expect="$2" sql="$3" out code
  out=$($PSQL -c "$sql" 2>&1); code=$?
  if [ $code -eq 0 ] && [ "$out" = "$expect" ]; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (expected count $expect, exit $code: $out)"; FAIL=$((FAIL+1)); fi
}
# RLS UPDATE with a failing USING clause affects 0 rows and exits 0, so prove
# the denial by reading the row back as superuser (bypasses RLS) and comparing.
run_update_unchanged() { # $1 name, $2 persona sql, $3 read sql, $4 expected value
  local name="$1" psql_sql="$2" read_sql="$3" expected="$4" before after
  before=$($PSQL -c "$read_sql" 2>&1)
  $PSQL -c "$psql_sql" > /dev/null 2>&1
  after=$($PSQL -c "$read_sql" 2>&1)
  if [ "$before" = "$expected" ] && [ "$after" = "$expected" ]; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (before='$before' after='$after', expected '$expected')"; FAIL=$((FAIL+1)); fi
}
run_update_changed() { # $1 name, $2 persona sql, $3 read sql, $4 expected value
  local name="$1" psql_sql="$2" read_sql="$3" expected="$4" after
  $PSQL -c "$psql_sql" > /dev/null 2>&1
  after=$($PSQL -c "$read_sql" 2>&1)
  if [ "$after" = "$expected" ]; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (after='$after', expected '$expected')"; FAIL=$((FAIL+1)); fi
}
run_fails_with() { # $1 name, $2 pattern, $3 sql — expect nonzero exit + message match
  local name="$1" pattern="$2" sql="$3" out code
  out=$($PSQL -c "$sql" 2>&1); code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -q "$pattern"; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (expected failure matching '$pattern', exit $code: $out)"; FAIL=$((FAIL+1)); fi
}
as_uid() { printf "set app.test_uid='%s'; set role authenticated; %s" "$1" "$2"; }
as_service() { printf "set role service_role; %s" "$1"; }
as_anon() { printf "set role anon; %s" "$1"; }

# --- recreate scratch db ---------------------------------------------------
$PSQL_ADMIN -c "drop database if exists rlsproof;" > /tmp/rls-rec.log 2>&1 \
  && $PSQL_ADMIN -c "create database rlsproof;" >> /tmp/rls-rec.log 2>&1 \
  && echo "PASS: scratch database recreated" && PASS=$((PASS+1)) || { echo "FAIL: could not recreate scratch database"; cat /tmp/rls-rec.log; FAIL=$((FAIL+1)); }
$PSQL -f "$SCRIPT_DIR/setup.sql" > /tmp/rls-setup.log 2>&1 \
  && echo "PASS: setup.sql applies (live-faithful pre-fix state)" && PASS=$((PASS+1)) || { echo "FAIL: setup.sql"; cat /tmp/rls-setup.log; FAIL=$((FAIL+1)); }

# --- P0: the predicate itself ----------------------------------------------
run_bool "P0 owner has access" t "$(as_uid "$A" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active co-owner has access" t "$(as_uid "$C" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 invited co-owner denied" f "$(as_uid "$I" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 suspended co-owner denied" f "$(as_uid "$S" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active manager denied" f "$(as_uid "$M" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active bookkeeper denied" f "$(as_uid "$K" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active read-only member denied" f "$(as_uid "$R" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 unrelated owner denied" f "$(as_uid "$B" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 owner has no access to B's workspace" f "$(as_uid "$A" "select coalesce(has_workspace_access('$B'), false);")"

# --- migration applies twice (idempotent) -----------------------------------
$PSQL -f "$MIGRATION" > /tmp/rls-mig-1.log 2>&1 \
  && echo "PASS: migration applies cleanly" && PASS=$((PASS+1)) || { echo "FAIL: migration first apply"; cat /tmp/rls-mig-1.log; FAIL=$((FAIL+1)); }
$PSQL -f "$MIGRATION" > /tmp/rls-mig-2.log 2>&1 \
  && echo "PASS: migration re-applies cleanly (idempotent)" && PASS=$((PASS+1)) || { echo "FAIL: migration second apply"; cat /tmp/rls-mig-2.log; FAIL=$((FAIL+1)); }

# --- RLS is enabled + forced on all 7 tables --------------------------------
run_count "RLS enabled + forced on all 7 receptionist tables" 7 \
  "select count(*) from pg_class where relname like 'forge_rental_receptionist%' and relrowsecurity and relforcerowsecurity;"

# --- P1-1: composite FKs are valid on real Postgres --------------------------
run_bool "P1-1 calls has UNIQUE(owner_id, id)" t \
  "select exists (select 1 from pg_indexes where tablename = 'forge_rental_receptionist_calls' and indexdef like '%(owner_id, id)%');"
run_count "P1-1 composite FKs present (events, drafts, alert attempts)" 3 \
  "select count(*) from pg_constraint where conrelid in ('forge_rental_receptionist_events'::regclass, 'forge_rental_receptionist_drafts'::regclass, 'forge_rental_receptionist_alert_attempts'::regclass) and contype = 'f' and (pg_get_constraintdef(oid) like '%(owner_id, call_id)%' or pg_get_constraintdef(oid) like '%(owner_id, emergency_event_id)%');"
run_fails_with "P1-1 FK without a matching unique fails (why the unique matters)" "no unique constraint matching given keys" \
  "create table tmp_p11_parent (id uuid primary key, owner_id uuid not null); create table tmp_p11_child (owner_id uuid, call_id uuid, foreign key (owner_id, call_id) references tmp_p11_parent (owner_id, id));"

# --- seed fixtures as service_role (same shapes as the ingest route) --------
CALL_A=$($PSQL -c "$(as_service "insert into forge_rental_receptionist_calls (owner_id, provider_call_sid, direction, processing_state, policy_version) values ('$A', 'CA-seed-a', 'INBOUND', 'IN_PROGRESS', 'policy-v1') returning id;")" 2>&1)
CALL_B=$($PSQL -c "$(as_service "insert into forge_rental_receptionist_calls (owner_id, provider_call_sid, direction, processing_state, policy_version) values ('$B', 'CA-seed-b', 'INBOUND', 'IN_PROGRESS', 'policy-v1') returning id;")" 2>&1)
if [ -n "$CALL_A" ] && [ -n "$CALL_B" ] && [ "${#CALL_A}" = 36 ] && [ "${#CALL_B}" = 36 ]; then echo "PASS: seed calls created (service_role)"; PASS=$((PASS+1));
else echo "FAIL: seed calls not created (A='$CALL_A' B='$CALL_B')"; FAIL=$((FAIL+1)); fi
$PSQL -c "$(as_service "insert into forge_rental_receptionist_events (owner_id, call_id, event_id, event_type, payload_minimal, ingest_idempotency_key, policy_version) values ('$A', '$CALL_A', 'evt-seed-1', 'CALL_STARTED', '{}', 'idem-seed-1', 'policy-v1');")" > /dev/null 2>&1 \
  && echo "PASS: seed event created (service_role)" && PASS=$((PASS+1)) || { echo "FAIL: seed event"; FAIL=$((FAIL+1)); }
$PSQL -c "$(as_service "insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_A', 'MAINTENANCE_INTAKE', '{}');")" > /dev/null 2>&1 \
  && echo "PASS: seed draft created (service_role)" && PASS=$((PASS+1)) || { echo "FAIL: seed draft"; FAIL=$((FAIL+1)); }
$PSQL -c "$(as_service "insert into forge_rental_receptionist_alerts (owner_id, emergency_event_id, hazard) values ('$A', 'emg-seed-1', 'WATER');")" > /dev/null 2>&1 \
  && echo "PASS: seed alert created (service_role)" && PASS=$((PASS+1)) || { echo "FAIL: seed alert"; FAIL=$((FAIL+1)); }
$PSQL -c "$(as_service "insert into forge_rental_receptionist_alert_attempts (owner_id, emergency_event_id, target_role, channel, dedupe_key) values ('$A', 'emg-seed-1', 'PRIMARY', 'VOICE', 'dedupe-seed-1');")" > /dev/null 2>&1 \
  && echo "PASS: seed alert attempt created (service_role)" && PASS=$((PASS+1)) || { echo "FAIL: seed alert attempt"; FAIL=$((FAIL+1)); }

$PSQL -c "$(as_service "insert into forge_rental_receptionist_alerts (owner_id, emergency_event_id, hazard) values ('$B', 'emg-seed-b', 'FIRE');")" > /dev/null 2>&1 \
  && echo "PASS: seed alert (workspace B) created (service_role)" && PASS=$((PASS+1)) || { echo "FAIL: seed alert (workspace B)"; FAIL=$((FAIL+1)); }

run_fails_with "P1-1 cross-owner event insert fails the composite FK" "violates foreign key constraint" \
  "$(as_service "insert into forge_rental_receptionist_events (owner_id, call_id, event_id, event_type, payload_minimal, ingest_idempotency_key, policy_version) values ('$A', '$CALL_B', 'evt-x', 'CALL_STARTED', '{}', 'idem-x', 'policy-v1');")"
run_fails_with "P1-1 cross-owner draft insert fails the composite FK" "violates foreign key constraint" \
  "$(as_service "insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_B', 'MAINTENANCE_INTAKE', '{}');")"
run_fails_with "P1-1 cross-owner alert-attempt insert fails the composite FK" "violates foreign key constraint" \
  "$(as_service "insert into forge_rental_receptionist_alert_attempts (owner_id, emergency_event_id, target_role, channel, dedupe_key) values ('$A', 'emg-seed-b', 'PRIMARY', 'VOICE', 'dedupe-x');")"

# --- P1-2: service upsert leg + draft link (same shape as the ingest route) -
run_case "P1-2 service upsert (1st call) succeeds" ok \
  "$(as_service "insert into forge_rental_receptionist_calls (owner_id, provider_call_sid, direction, processing_state, policy_version) values ('$A', 'CA-upsert-1', 'INBOUND', 'IN_PROGRESS', 'policy-v1') on conflict (owner_id, provider_call_sid) do update set processing_state = excluded.processing_state, updated_at = now();")"
run_case "P1-2 service upsert (repeat call) succeeds" ok \
  "$(as_service "insert into forge_rental_receptionist_calls (owner_id, provider_call_sid, direction, processing_state, policy_version) values ('$A', 'CA-upsert-1', 'INBOUND', 'ANSWERED', 'policy-v1') on conflict (owner_id, provider_call_sid) do update set processing_state = excluded.processing_state, updated_at = now();")"
run_bool "P1-2 repeated upsert kept one row" t \
  "select count(*) = 1 from forge_rental_receptionist_calls where provider_call_sid = 'CA-upsert-1';"
run_bool "P1-2 repeated upsert applied the new state" t \
  "select processing_state = 'ANSWERED' from forge_rental_receptionist_calls where provider_call_sid = 'CA-upsert-1';"
UPSERT_ID=$($PSQL -c "select id from forge_rental_receptionist_calls where provider_call_sid = 'CA-upsert-1';" 2>&1)
run_update_changed "P1-2 service links maintenance_draft_id" \
  "$(as_service "update forge_rental_receptionist_calls set maintenance_draft_id = (select id from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A' limit 1) where id = '$UPSERT_ID';")" \
  "select maintenance_draft_id is not null from forge_rental_receptionist_calls where id = '$UPSERT_ID';" "t"

# --- P1-5 / hardening: authenticated persona matrix -------------------------
run_count "P1-5 owner SELECT calls sees own rows only (seed + upsert)" 2 "$(as_uid "$A" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 co-owner SELECT calls sees own workspace" 2 "$(as_uid "$C" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 unrelated owner SELECT calls sees own row only" 1 "$(as_uid "$B" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 manager SELECT calls sees nothing" 0 "$(as_uid "$M" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 bookkeeper SELECT calls sees nothing" 0 "$(as_uid "$K" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 read-only SELECT calls sees nothing" 0 "$(as_uid "$R" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 invited co-owner SELECT calls sees nothing" 0 "$(as_uid "$I" "select count(*) from forge_rental_receptionist_calls;")"
run_count "P1-5 suspended co-owner SELECT calls sees nothing" 0 "$(as_uid "$S" "select count(*) from forge_rental_receptionist_calls;")"
run_case "hardening anon SELECT calls denied" deny "$(as_anon "select count(*) from forge_rental_receptionist_calls;")"
run_case "hardening authenticated INSERT calls denied" deny "$(as_uid "$A" "insert into forge_rental_receptionist_calls (owner_id, provider_call_sid, direction, policy_version) values ('$A', 'CA-forged', 'INBOUND', 'policy-v1');")"
run_case "hardening authenticated INSERT events denied" deny "$(as_uid "$A" "insert into forge_rental_receptionist_events (owner_id, call_id, event_id, event_type, payload_minimal, ingest_idempotency_key, policy_version) values ('$A', '$CALL_A', 'evt-forged', 'CALL_STARTED', '{}', 'idem-forged', 'policy-v1');")"
run_case "hardening authenticated INSERT drafts denied" deny "$(as_uid "$A" "insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_A', 'MAINTENANCE_INTAKE', '{}');")"
run_case "hardening authenticated INSERT alerts denied" deny "$(as_uid "$A" "insert into forge_rental_receptionist_alerts (owner_id, emergency_event_id, hazard) values ('$A', 'emg-forged', 'WATER');")"
run_case "hardening authenticated INSERT alert attempts denied" deny "$(as_uid "$A" "insert into forge_rental_receptionist_alert_attempts (owner_id, emergency_event_id, target_role, channel, dedupe_key) values ('$A', 'emg-seed-1', 'PRIMARY', 'VOICE', 'dedupe-forged');")"
run_update_unchanged "hardening authenticated UPDATE calls leaves row unchanged" \
  "$(as_uid "$A" "update forge_rental_receptionist_calls set processing_state = 'FAILED' where id = '$CALL_A';")" \
  "select processing_state from forge_rental_receptionist_calls where id = '$CALL_A';" "IN_PROGRESS"
run_update_unchanged "hardening authenticated DELETE calls leaves row" \
  "$(as_uid "$A" "delete from forge_rental_receptionist_calls where id = '$CALL_A';")" \
  "select count(*) from forge_rental_receptionist_calls where id = '$CALL_A';" "1"
run_update_changed "P1-5 owner UPDATE drafts (review reason) succeeds" \
  "$(as_uid "$A" "update forge_rental_receptionist_drafts set review_reason = 'preliminary: verified by owner' where owner_id = '$A' and call_id = '$CALL_A';")" \
  "select review_reason from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A';" "preliminary: verified by owner"
run_update_unchanged "P1-5 manager UPDATE drafts leaves row unchanged" \
  "$(as_uid "$M" "update forge_rental_receptionist_drafts set review_reason = 'forged' where owner_id = '$A' and call_id = '$CALL_A';")" \
  "select review_reason from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A';" "preliminary: verified by owner"
run_count "P1-5 co-owner SELECT drafts sees workspace draft" 1 "$(as_uid "$C" "select count(*) from forge_rental_receptionist_drafts;")"
run_count "P1-5 manager SELECT drafts sees nothing" 0 "$(as_uid "$M" "select count(*) from forge_rental_receptionist_drafts;")"
run_count "P1-5 owner SELECT alerts sees own alert" 1 "$(as_uid "$A" "select count(*) from forge_rental_receptionist_alerts;")"
run_count "P1-5 unrelated owner SELECT alerts sees own alert only" 1 "$(as_uid "$B" "select count(*) from forge_rental_receptionist_alerts;")"
run_count "P1-5 owner SELECT events sees own event" 1 "$(as_uid "$A" "select count(*) from forge_rental_receptionist_events;")"
run_count "P1-5 unrelated owner SELECT events sees nothing" 0 "$(as_uid "$B" "select count(*) from forge_rental_receptionist_events;")"
run_count "P1-5 owner SELECT alert attempts sees own attempt" 1 "$(as_uid "$A" "select count(*) from forge_rental_receptionist_alert_attempts;")"
run_count "P1-5 manager SELECT alert attempts sees nothing" 0 "$(as_uid "$M" "select count(*) from forge_rental_receptionist_alert_attempts;")"

# --- P1-6: callback column holds versioned ciphertext, never plaintext -----
# The column is text because the ciphertext is stored as a versioned
# encoding: v1.<keyId>.<base64(iv||tag||ciphertext)> (see
# src/lib/receptionist/callbackCrypto.js — its roundtrip, access, log and
# rotation tests are the crypto proof; this leg proves the DB shape).
run_bool "P1-6 callback column exists as text" t \
  "select data_type = 'text' from information_schema.columns where table_schema = 'public' and table_name = 'forge_rental_receptionist_calls' and column_name = 'callback_e164_encrypted';"
run_bool "P1-6 no bare plaintext callback column exists" f \
  "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'forge_rental_receptionist_calls' and column_name in ('callback_e164', 'callback_phone', 'caller_phone')); "
run_bool "P1-6 caller ANI is masked-only" t \
  "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'forge_rental_receptionist_calls' and column_name = 'caller_ani_masked');"
run_case "P1-6 service can store a v1 ciphertext value" ok \
  "$(as_service "update forge_rental_receptionist_calls set callback_e164_encrypted = 'v1.test-key.ABCDEFGHijklmnopQRSTUV==' where id = '$CALL_A';")"
run_bool "P1-6 stored value keeps the v1 format" t \
  "select callback_e164_encrypted like 'v1.%' from forge_rental_receptionist_calls where id = '$CALL_A';"
run_bool "P1-6 stored value is not a phone number" f \
  "select callback_e164_encrypted ~ '^\\+?[0-9]{7,15}$' from forge_rental_receptionist_calls where id = '$CALL_A';"

# --- P2-1: nonce lifecycle (fix round 2, P1-2) ------------------------------
# Claim does not commit: only complete_ingest_nonce does, after the
# ingest writes land. A failed delivery is marked FAILED so an identical
# retry re-runs the ingest; a committed replay returns the stored
# original result; a different hash is rejected.
run_bool "P2-1 claim fresh nonce returns status fresh" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1') ->> 'status') = 'fresh';")"
run_bool "P2-1 claim same nonce+hash before complete returns retry" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1') ->> 'status') = 'retry';")"
run_bool "P2-1 claim same nonce+different hash returns hash_mismatch" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-2') ->> 'status') = 'hash_mismatch';")"
run_bool "P2-1 fail marks the in-progress nonce FAILED" t \
  "$(as_service "select receptionist_fail_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1');")"
run_bool "P2-1 claim after fail with same hash returns retry" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1') ->> 'status') = 'retry';")"
run_bool "P2-1 complete commits the nonce" t \
  "$(as_service "select receptionist_complete_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1', '$CALL_A', '{\"success\": true, \"callId\": \"$CALL_A\"}'::jsonb);")"
run_bool "P2-1 claim after complete returns committed with stored result" t \
  "$(as_service "select (c ->> 'status') = 'committed' and (c -> 'result' ->> 'callId') = '$CALL_A' from (select receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1') as c) s;")"
run_bool "P2-1 complete twice: second returns false" f \
  "$(as_service "select receptionist_complete_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1', '$CALL_A', '{}'::jsonb);")"
run_bool "P2-1 fail after complete returns false (never un-completes)" f \
  "$(as_service "select receptionist_fail_ingest_nonce('$A'::uuid, 'nonce-lc-1', 'hash-1');")"
run_bool "P2-1 claim fresh nonce-lc-3 returns fresh" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-3', 'hash-3') ->> 'status') = 'fresh';")"
run_bool "P2-1 complete with wrong hash returns false" f \
  "$(as_service "select receptionist_complete_ingest_nonce('$A'::uuid, 'nonce-lc-3', 'hash-wrong', '$CALL_A', '{}'::jsonb);")"
run_bool "P2-1 fail with wrong hash returns false" f \
  "$(as_service "select receptionist_fail_ingest_nonce('$A'::uuid, 'nonce-lc-3', 'hash-wrong');")"
run_bool "P2-1 complete after fail commits (FAILED -> COMMITTED allowed)" t \
  "$(as_service "select receptionist_fail_ingest_nonce('$A'::uuid, 'nonce-lc-3', 'hash-3') and receptionist_complete_ingest_nonce('$A'::uuid, 'nonce-lc-3', 'hash-3', '$CALL_A', '{}'::jsonb);")"
run_bool "P2-1 same nonce for another owner is independent" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$B'::uuid, 'nonce-lc-1', 'hash-1') ->> 'status') = 'fresh';")"
run_case "P2-1 claim RPC denied to authenticated" deny \
  "$(as_uid "$A" "select receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-proof-2', 'hash-2');")"
run_case "P2-1 complete RPC denied to authenticated" deny \
  "$(as_uid "$A" "select receptionist_complete_ingest_nonce('$A'::uuid, 'nonce-proof-2', 'hash-2', '$CALL_A', '{}'::jsonb);")"
run_case "P2-1 fail RPC denied to authenticated" deny \
  "$(as_uid "$A" "select receptionist_fail_ingest_nonce('$A'::uuid, 'nonce-proof-2', 'hash-2');")"
$PSQL -c "$(as_service "insert into forge_rental_receptionist_ingest_nonces (owner_id, nonce, request_hash, expires_at) values ('$A', 'nonce-stale', 'h', now() - interval '10 minutes');")" > /dev/null 2>&1
run_bool "P2-1 nonce claim still works with a stale row present" t \
  "$(as_service "select (receptionist_claim_ingest_nonce('$A'::uuid, 'nonce-lc-4', 'hash-4') ->> 'status') = 'fresh';")"
run_count "P2-1 stale nonce purged by the claim" 0 \
  "select count(*) from forge_rental_receptionist_ingest_nonces where nonce = 'nonce-stale';"
run_bool "P2-1 fresh nonce carries a 600s expiry" t \
  "select expires_at > created_at + interval '590 seconds' from forge_rental_receptionist_ingest_nonces where nonce = 'nonce-lc-4';"
run_bool "P2-1 old commit-before-write consume RPC is gone" f \
  "select exists (select 1 from pg_proc where proname = 'receptionist_consume_ingest_nonce');"
run_bool "P2-1 nonce row carries a lifecycle state" t \
  "select state = 'COMMITTED' from forge_rental_receptionist_ingest_nonces where owner_id = '$A' and nonce = 'nonce-lc-1';"

# --- P1-3: conflict-ignored draft upsert returns zero rows ------------------
# ON CONFLICT DO NOTHING returns no row, so .single() 500s on the
# conflict path. The route now reads the id back owner-scoped; these
# cases prove the DB shape the fix relies on.
run_count "P1-3 conflict-ignored draft upsert returns zero rows" 0 \
  "$(as_service "with ins as (insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_A', 'MAINTENANCE_INTAKE', '{}') on conflict (owner_id, call_id, draft_kind) do nothing returning id) select count(*) from ins;")"
run_count "P1-3 fallback SELECT finds exactly the one existing draft" 1 \
  "$(as_service "select count(*) from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A' and draft_kind = 'MAINTENANCE_INTAKE';")"
run_bool "P1-3 conflict path did not reset the draft state" t \
  "$(as_service "select review_state = 'PENDING' from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A' and draft_kind = 'MAINTENANCE_INTAKE';")"

# --- P2-2: draft uniqueness + preliminary review -----------------------------
$PSQL -c "$(as_service "insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_A', 'MAINTENANCE_INTAKE', '{}') on conflict (owner_id, call_id, draft_kind) do nothing;")" > /dev/null 2>&1
run_count "P2-2 duplicate draft upsert keeps exactly one draft" 1 \
  "select count(*) from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A' and draft_kind = 'MAINTENANCE_INTAKE';"
run_fails_with "P2-2 plain duplicate draft insert fails the unique" "violates unique constraint" \
  "$(as_service "insert into forge_rental_receptionist_drafts (owner_id, call_id, draft_kind, proposed_payload) values ('$A', '$CALL_A', 'MAINTENANCE_INTAKE', '{}');")"
run_update_changed "P2-2 owner APPROVES as a preliminary decision" \
  "$(as_uid "$A" "update forge_rental_receptionist_drafts set review_state = 'APPROVED', review_reason = 'preliminary decision only' where owner_id = '$A' and call_id = '$CALL_A';")" \
  "select review_state from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A';" "APPROVED"
run_bool "P2-2 approval creates NO canonical maintenance record" t \
  "select committed_record_id is null from forge_rental_receptionist_drafts where owner_id = '$A' and call_id = '$CALL_A';"

# --- append-only events ------------------------------------------------------
# The trigger fires for the table owner (postgres): an owner UPDATE must
# hit the append-only exception, not succeed. Application roles hold no
# UPDATE/DELETE grant on events at all, so they fail at the ACL layer.
run_fails_with "events UPDATE blocked by trigger (owner)" "is append-only" \
  "update forge_rental_receptionist_events set event_type = 'FORGED' where owner_id = '$A' and call_id = '$CALL_A';"
run_fails_with "events DELETE blocked by trigger (owner)" "is append-only" \
  "delete from forge_rental_receptionist_events where owner_id = '$A' and call_id = '$CALL_A';"
run_case "events UPDATE denied to service_role (ACL)" deny \
  "$(as_service "update forge_rental_receptionist_events set event_type = 'FORGED' where owner_id = '$A' and call_id = '$CALL_A';")"
run_case "events DELETE denied to service_role (ACL)" deny \
  "$(as_service "delete from forge_rental_receptionist_events where owner_id = '$A' and call_id = '$CALL_A';")"

# --- grants + policy inventory ----------------------------------------------
run_bool "grants authenticated SELECT on calls" t "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_calls', 'SELECT');"
run_bool "grants authenticated INSERT on calls denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_calls', 'INSERT');"
run_bool "grants authenticated UPDATE on calls denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_calls', 'UPDATE');"
run_bool "grants authenticated DELETE on calls denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_calls', 'DELETE');"
run_bool "grants service SELECT on calls" t "select has_table_privilege('service_role', 'public.forge_rental_receptionist_calls', 'SELECT');"
run_bool "grants service INSERT on calls" t "select has_table_privilege('service_role', 'public.forge_rental_receptionist_calls', 'INSERT');"
run_bool "grants service UPDATE on calls" t "select has_table_privilege('service_role', 'public.forge_rental_receptionist_calls', 'UPDATE');"
run_bool "grants service DELETE on calls denied" f "select has_table_privilege('service_role', 'public.forge_rental_receptionist_calls', 'DELETE');"
run_bool "grants authenticated UPDATE on drafts" t "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_drafts', 'UPDATE');"
run_bool "grants authenticated INSERT on drafts denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_drafts', 'INSERT');"
run_bool "grants authenticated DELETE on drafts denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_drafts', 'DELETE');"
run_bool "grants authenticated SELECT on events" t "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_events', 'SELECT');"
run_bool "grants authenticated INSERT on events denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_events', 'INSERT');"
run_bool "grants authenticated UPDATE on events denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_events', 'UPDATE');"
run_bool "grants service UPDATE on events denied" f "select has_table_privilege('service_role', 'public.forge_rental_receptionist_events', 'UPDATE');"
run_bool "grants anon SELECT on calls denied" f "select has_table_privilege('anon', 'public.forge_rental_receptionist_calls', 'SELECT');"
run_bool "grants authenticated EXECUTE claim RPC denied" f "select has_function_privilege('authenticated', 'public.receptionist_claim_ingest_nonce(uuid, text, text)', 'EXECUTE');"
run_bool "grants service EXECUTE claim RPC" t "select has_function_privilege('service_role', 'public.receptionist_claim_ingest_nonce(uuid, text, text)', 'EXECUTE');"
run_bool "grants authenticated EXECUTE complete RPC denied" f "select has_function_privilege('authenticated', 'public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb)', 'EXECUTE');"
run_bool "grants service EXECUTE complete RPC" t "select has_function_privilege('service_role', 'public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb)', 'EXECUTE');"
run_bool "grants authenticated EXECUTE fail RPC denied" f "select has_function_privilege('authenticated', 'public.receptionist_fail_ingest_nonce(uuid, text, text)', 'EXECUTE');"
run_bool "grants service EXECUTE fail RPC" t "select has_function_privilege('service_role', 'public.receptionist_fail_ingest_nonce(uuid, text, text)', 'EXECUTE');"
run_bool "grants authenticated any access to nonce table denied" f "select has_table_privilege('authenticated', 'public.forge_rental_receptionist_ingest_nonces', 'SELECT');"
run_bool "grants service EXECUTE append-only trigger fn" t "select has_function_privilege('service_role', 'public.forge_rental_receptionist_events_append_only()', 'EXECUTE');"
run_count "policy inventory: exactly the 7 expected policies" 7 \
  "select count(*) from pg_policies where schemaname = 'public' and tablename like 'forge_rental_receptionist%';"
run_count "policy inventory: no GUC-based policy remains" 0 \
  "select count(*) from pg_policies where schemaname = 'public' and tablename like 'forge_rental_receptionist%' and (qual like '%app.current_owner_id%' or with_check like '%app.current_owner_id%');"
run_bool "policy inventory: calls select policy exists" t \
  "select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_calls' and policyname = 'receptionist_calls_owner_select');"
run_bool "policy inventory: drafts update policy exists" t \
  "select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_drafts' and policyname = 'receptionist_drafts_owner_update');"
run_bool "policy inventory: outbox select policy exists" t \
  "select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_delivery_outbox' and policyname = 'receptionist_outbox_owner_select');"
run_bool "policy inventory: no INSERT/UPDATE/DELETE policy on calls" f \
  "select exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'forge_rental_receptionist_calls' and cmd in ('INSERT', 'UPDATE', 'DELETE'));"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
