#!/bin/bash
# Behavioral RLS proof v2 for 20261108000000_rental_billing_audit_insert_policies.sql
# (fix round 1: same-workspace role matrix + RPC paths).
# Self-contained: drops/recreates the scratch rlsproof database on the local PG16
# cluster (socket /tmp, port 5444 — see README.md), applies setup.sql, reproduces
# the pre-fix bug, simulates the already-live cutover policy, applies the real
# migration twice, then proves the post-fix authorization for every persona.
# Exits non-zero on any failed case. Never point it at production.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/20261108000000_rental_billing_audit_insert_policies.sql"
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
    # Denial evidence: an RLS violation, a 42501 code, or the RPCs' own owner-check
    # exception ("... does not match authenticated owner", raised with errcode
    # 42501 — psql's default verbosity does not print the SQLSTATE, so match the
    # message text as well).
    if [ $code -ne 0 ] && { echo "$out" | grep -q "violates row-level security policy" || echo "$out" | grep -q "42501" || echo "$out" | grep -q "does not match authenticated owner"; }; then echo "PASS: $name (denied)"; PASS=$((PASS+1));
    else echo "FAIL: $name (expected RLS/42501 denial, exit $code: $out)"; FAIL=$((FAIL+1)); fi
  fi
}
run_bool() { # $1 name, $2 expect (t|f), $3 sql returning one boolean
  local name="$1" expect="$2" sql="$3" out code
  out=$($PSQL -c "$sql" 2>&1); code=$?
  if [ $code -eq 0 ] && [ "$out" = "$expect" ]; then echo "PASS: $name"; PASS=$((PASS+1));
  else echo "FAIL: $name (expected $expect, exit $code: $out)"; FAIL=$((FAIL+1)); fi
}
# RLS UPDATE with a failing USING clause affects 0 rows and exits 0, so prove the
# denial by reading the row back as superuser (bypasses RLS) and comparing.
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
as_uid() { printf "set app.test_uid='%s'; set role authenticated; %s" "$1" "$2"; }
as_anon() { printf "set role anon; %s" "$1"; }
# Direct-write builders. $1 = owner_id the row claims, $2 = schedule id (FK must exist).
audit_cutover() { printf "insert into rent_schedule_collection_cutover_audit (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, performed_by) values ('%s', '%s', 'lx', 'external', 'forge', 'actor')" "$1" "$2"; }
audit_settings() { printf "insert into rental_billing_settings_audit (owner_id, from_enabled, to_enabled, performed_by) values ('%s', false, true, 'actor')" "$1"; }
audit_latefee() { printf "insert into rental_late_fee_settings_audit (owner_id, change, performed_by) values ('%s', '{}', 'actor')" "$1"; }
audit_policy() { printf "insert into rental_payment_policy_audit (owner_id, change, performed_by) values ('%s', '{}', 'actor')" "$1"; }
audit_fee() { printf "insert into rental_convenience_fee_audit (owner_id, change, performed_by) values ('%s', '{}', 'actor')" "$1"; }
settings_upsert() { printf "insert into rental_billing_settings (owner_id, billing_enabled, updated_at, updated_by) values ('%s', true, now(), 'actor') on conflict (owner_id) do update set billing_enabled = excluded.billing_enabled, updated_at = now()" "$1"; }

echo "--- RESET: recreate scratch database from setup.sql ---"
$PSQL_ADMIN -c "drop database if exists rlsproof;" -c "create database rlsproof;" > /dev/null 2>&1 \
  && echo "PASS: scratch database recreated" && PASS=$((PASS+1)) || { echo "FAIL: could not recreate scratch database"; FAIL=$((FAIL+1)); }
$PSQL -q -f "$SCRIPT_DIR/setup.sql" > /tmp/rls-setup.log 2>&1 \
  && echo "PASS: setup.sql applies (live-faithful pre-fix state)" && PASS=$((PASS+1)) || { echo "FAIL: setup.sql"; cat /tmp/rls-setup.log; FAIL=$((FAIL+1)); }
# B-owned rows seeded as superuser for cross-workspace read/update cases.
$PSQL -q -c "insert into rental_billing_settings (owner_id, billing_enabled) values ('$B', true);" \
  -c "insert into rent_schedule_collection_cutover_audit (owner_id, schedule_id, lease_id, from_collection_mode, to_collection_mode, performed_by) values ('$B', 's9', 'l9', 'external', 'forge', '$B');"

echo "--- PHASE 0: has_workspace_access('A') per persona (live predicate, verbatim) ---"
run_bool "P0 owner has access" t "$(as_uid "$A" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active co-owner has access" t "$(as_uid "$C" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 invited co-owner denied" f "$(as_uid "$I" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 suspended co-owner denied" f "$(as_uid "$S" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active manager denied" f "$(as_uid "$M" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active bookkeeper denied" f "$(as_uid "$K" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 active read-only member denied" f "$(as_uid "$R" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 unrelated owner denied" f "$(as_uid "$B" "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 anon (no uid) denied" f "$(as_anon "select coalesce(has_workspace_access('$A'), false);")"
run_bool "P0 owner has no access to B's workspace" f "$(as_uid "$A" "select coalesce(has_workspace_access('$B'), false);")"

echo "--- PHASE 1: pre-fix state — owner AND co-owner writes denied (bug reproduced) ---"
run_case "P1 cutover audit insert (owner) denied" deny "$(as_uid "$A" "$(audit_cutover "$A" s1)")"
run_case "P1 cutover audit insert (co-owner) denied" deny "$(as_uid "$C" "$(audit_cutover "$A" s1)")"
run_case "P1 billing-settings upsert (owner) denied" deny "$(as_uid "$A" "$(settings_upsert "$A")")"
run_case "P1 billing-settings upsert (co-owner) denied" deny "$(as_uid "$C" "$(settings_upsert "$A")")"
run_case "P1 activate RPC (owner) denied by RLS" deny "$(as_uid "$A" "select activate_forge_billing_collection('$A', 's1', '2026-11-06');")"
run_case "P1 activate RPC (co-owner) denied by RLS" deny "$(as_uid "$C" "select activate_forge_billing_collection('$A', 's2', '2026-11-06');")"

echo "--- SIMULATE LIVE STATE: cutover INSERT policy already applied by hand (2026-11-08) ---"
$PSQL -q -c "create policy \"rent_schedule_cutover_audit_owner_insert\" on rent_schedule_collection_cutover_audit for insert to authenticated with check (has_workspace_access(owner_id));" \
  && echo "PASS: pre-existing cutover policy in place" && PASS=$((PASS+1)) || { echo "FAIL: could not pre-create cutover policy"; FAIL=$((FAIL+1)); }

echo "--- APPLY MIGRATION (twice: idempotency) ---"
$PSQL -q -f "$MIGRATION" > /tmp/rls-mig-1.log 2>&1 \
  && echo "PASS: migration applies cleanly" && PASS=$((PASS+1)) || { echo "FAIL: migration first apply"; cat /tmp/rls-mig-1.log; FAIL=$((FAIL+1)); }
$PSQL -q -f "$MIGRATION" > /tmp/rls-mig-2.log 2>&1 \
  && echo "PASS: migration re-applies cleanly (idempotent)" && PASS=$((PASS+1)) || { echo "FAIL: migration second apply"; cat /tmp/rls-mig-2.log; FAIL=$((FAIL+1)); }
pcount=$($PSQL -c "select count(*) from pg_policies where policyname in ('rent_schedule_cutover_audit_owner_insert','rental_billing_settings_audit_owner_insert','late_fee_settings_audit_owner_insert','payment_policy_audit_owner_insert','convenience_fee_audit_owner_insert','rental_billing_settings_owner_insert','rental_billing_settings_owner_update');" 2>&1)
if [ "$pcount" = "7" ]; then echo "PASS: all 7 policies present exactly once after guarded apply"; PASS=$((PASS+1));
else echo "FAIL: policy count after apply is '$pcount', expected 7"; FAIL=$((FAIL+1)); fi

echo "--- PHASE 2: post-fix direct INSERT — full persona matrix on all 5 audit tables ---"
# Each table: owner ok, co-owner ok, manager/bookkeeper/read-only/invited/suspended/
# unrelated denied. (FK: A rows use schedule s1, B rows use schedule s9.)
for spec in "cutover|$(audit_cutover "$A" s1)|$(audit_cutover "$B" s9)" \
            "settings-audit|$(audit_settings "$A")|$(audit_settings "$B")" \
            "latefee-audit|$(audit_latefee "$A")|$(audit_latefee "$B")" \
            "policy-audit|$(audit_policy "$A")|$(audit_policy "$B")" \
            "fee-audit|$(audit_fee "$A")|$(audit_fee "$B")"; do
  tbl="${spec%%|*}"; rest="${spec#*|}"; sql_a="${rest%%|*}"; sql_b="${rest#*|}"
  run_case "P2 $tbl insert (owner, own workspace) succeeds" ok "$(as_uid "$A" "$sql_a")"
  run_case "P2 $tbl insert (co-owner, own workspace) succeeds" ok "$(as_uid "$C" "$sql_a")"
  run_case "P2 $tbl insert (manager, same workspace) denied" deny "$(as_uid "$M" "$sql_a")"
  run_case "P2 $tbl insert (bookkeeper, same workspace) denied" deny "$(as_uid "$K" "$sql_a")"
  run_case "P2 $tbl insert (read-only member, same workspace) denied" deny "$(as_uid "$R" "$sql_a")"
  run_case "P2 $tbl insert (invited co-owner) denied" deny "$(as_uid "$I" "$sql_a")"
  run_case "P2 $tbl insert (suspended co-owner) denied" deny "$(as_uid "$S" "$sql_a")"
  run_case "P2 $tbl insert (unrelated owner forging A row) denied" deny "$(as_uid "$B" "$sql_a")"
  run_case "P2 $tbl insert (unrelated owner, own workspace B) succeeds" ok "$(as_uid "$B" "$sql_b")"
done
run_case "P2 cutover audit insert (anon) denied" deny "$(as_anon "$(audit_cutover "$A" s1)")"

echo "--- PHASE 2: post-fix rental_billing_settings INSERT/UPDATE ---"
run_case "P2 settings insert (owner) succeeds" ok "$(as_uid "$A" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings insert (manager, same workspace) denied" deny "$(as_uid "$M" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings insert (bookkeeper, same workspace) denied" deny "$(as_uid "$K" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings insert (read-only member, same workspace) denied" deny "$(as_uid "$R" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings insert (invited co-owner) denied" deny "$(as_uid "$I" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings insert (unrelated owner forging A row) denied" deny "$(as_uid "$B" "insert into rental_billing_settings (owner_id, billing_enabled) values ('$A', true);")"
run_case "P2 settings upsert conflict leg (co-owner, 2nd call) succeeds" ok "$(as_uid "$C" "$(settings_upsert "$A")")"
run_update_changed "P2 settings UPDATE (co-owner) succeeds" "$(as_uid "$C" "update rental_billing_settings set billing_enabled = false where owner_id = '$A';")" "select billing_enabled from rental_billing_settings where owner_id = '$A';" "f"
run_update_unchanged "P2 settings UPDATE (manager) leaves row unchanged" "$(as_uid "$M" "update rental_billing_settings set billing_enabled = true where owner_id = '$A';")" "select billing_enabled from rental_billing_settings where owner_id = '$A';" "f"
run_update_unchanged "P2 settings UPDATE (unrelated owner) leaves row unchanged" "$(as_uid "$B" "update rental_billing_settings set billing_enabled = true where owner_id = '$A';")" "select billing_enabled from rental_billing_settings where owner_id = '$A';" "f"
run_update_unchanged "P2 settings UPDATE (B-owned row, cross-workspace read-back) unchanged" "$(as_uid "$A" "update rental_billing_settings set billing_enabled = false where owner_id = '$B';")" "select billing_enabled from rental_billing_settings where owner_id = '$B';" "t"

echo "--- PHASE 2: post-fix RPC paths (intended calls) ---"
run_case "P2 activate RPC (owner, s1) succeeds" ok "$(as_uid "$A" "select activate_forge_billing_collection('$A', 's1', '2026-11-06');")"
run_case "P2 activate RPC (owner, s1 again — idempotent no-op) succeeds" ok "$(as_uid "$A" "select activate_forge_billing_collection('$A', 's1', '2026-11-06');")"
run_case "P2 activate RPC (co-owner, s2) succeeds" ok "$(as_uid "$C" "select activate_forge_billing_collection('$A', 's2', '2026-11-06');")"
run_case "P2 activate RPC (manager) denied" deny "$(as_uid "$M" "select activate_forge_billing_collection('$A', 's3', '2026-11-06');")"
run_case "P2 activate RPC (bookkeeper) denied" deny "$(as_uid "$K" "select activate_forge_billing_collection('$A', 's3', '2026-11-06');")"
run_case "P2 activate RPC (invited co-owner) denied" deny "$(as_uid "$I" "select activate_forge_billing_collection('$A', 's4', '2026-11-06');")"
run_case "P2 activate RPC (suspended co-owner) denied" deny "$(as_uid "$S" "select activate_forge_billing_collection('$A', 's4', '2026-11-06');")"
run_case "P2 activate RPC (unrelated owner) denied" deny "$(as_uid "$B" "select activate_forge_billing_collection('$A', 's5', '2026-11-06');")"
run_case "P2 set_rental_billing_enabled (owner) succeeds" ok "$(as_uid "$A" "select set_rental_billing_enabled('$A', true);")"
run_case "P2 set_rental_billing_enabled (co-owner, conflict leg) succeeds" ok "$(as_uid "$C" "select set_rental_billing_enabled('$A', false);")"
run_case "P2 set_rental_billing_enabled (manager) denied" deny "$(as_uid "$M" "select set_rental_billing_enabled('$A', true);")"
run_case "P2 set_rental_billing_enabled (unrelated owner) denied" deny "$(as_uid "$B" "select set_rental_billing_enabled('$A', true);")"
run_case "P2 set_rental_late_fee_auto_settings (owner) succeeds" ok "$(as_uid "$A" "select set_rental_late_fee_auto_settings('$A', '{\"enabled\": true, \"graceDays\": 5, \"calculationType\": \"fixed\", \"fixedAmountCents\": 5000}'::jsonb);")"
run_case "P2 set_rental_late_fee_auto_settings (co-owner) succeeds" ok "$(as_uid "$C" "select set_rental_late_fee_auto_settings('$A', '{\"enabled\": false}'::jsonb);")"
run_case "P2 set_rental_late_fee_auto_settings (manager) denied" deny "$(as_uid "$M" "select set_rental_late_fee_auto_settings('$A', '{\"enabled\": true, \"graceDays\": 5, \"calculationType\": \"fixed\", \"fixedAmountCents\": 5000}'::jsonb);")"
run_case "P2 set_rental_payment_policy (owner) succeeds" ok "$(as_uid "$A" "select set_rental_payment_policy('$A', 'require_rent');")"
run_case "P2 set_rental_payment_policy (co-owner) succeeds" ok "$(as_uid "$C" "select set_rental_payment_policy('$A', 'allow_any_amount');")"
run_case "P2 set_rental_payment_policy (suspended co-owner) denied" deny "$(as_uid "$S" "select set_rental_payment_policy('$A', 'require_rent');")"
run_case "P2 set_rental_card_convenience_fee (owner) succeeds" ok "$(as_uid "$A" "select set_rental_card_convenience_fee('$A', 250);")"
run_case "P2 set_rental_card_convenience_fee (co-owner) succeeds" ok "$(as_uid "$C" "select set_rental_card_convenience_fee('$A', 300);")"
run_case "P2 set_rental_card_convenience_fee (bookkeeper) denied" deny "$(as_uid "$K" "select set_rental_card_convenience_fee('$A', 250);")"

echo "--- PHASE 2: SELECT visibility (existing SELECT policies untouched) ---"
run_bool "P2 co-owner sees own-workspace audit rows" t "$(as_uid "$C" "select count(*) > 0 from rent_schedule_collection_cutover_audit;")"
run_bool "P2 manager sees zero audit rows" t "$(as_uid "$M" "select count(*) = 0 from rent_schedule_collection_cutover_audit;")"
run_bool "P2 unrelated owner sees zero A audit rows" t "$(as_uid "$B" "select count(*) = 0 from rent_schedule_collection_cutover_audit where owner_id = '$A';")"

echo "--- RESULT: $PASS passed, $FAIL failed ---"
[ "$FAIL" -eq 0 ]
