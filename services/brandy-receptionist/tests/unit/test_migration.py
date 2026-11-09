"""§11.13 migration security — file-level checks + live-PostgreSQL checks.

The live leg runs scripts/brandy-receptionist-rls-proof/run.sh against the
local scratch PostgreSQL 16 cluster (socket /tmp, port 5444) when it
answers; it SKIPs with an explicit reason when the cluster is down.
The file leg asserts the migration text proves: additive schema,
owner-scoped composite FKs, RLS + FORCE, no default PUBLIC/anon/
authenticated grants, explicit minimal service grants, append-only
events, unique idempotency keys, nonce RPC, versioned-ciphertext callback.
A live-DB run must re-verify these before any apply word.
"""
import glob
import os
import re
import shutil
import subprocess
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
MIGRATIONS = sorted(glob.glob(os.path.join(REPO_ROOT, "supabase", "migrations", "*brandy_receptionist*.sql")))
V1_MIGRATION = os.path.join(REPO_ROOT, "supabase", "migrations", "20261108020000_brandy_receptionist_track2.sql")
GOLIVE_MIGRATION = os.path.join(REPO_ROOT, "supabase", "migrations", "20261108230000_brandy_receptionist_golive.sql")
PROOF_RUN = os.path.join(REPO_ROOT, "scripts", "brandy-receptionist-rls-proof", "run.sh")


def _live_postgres_available():
    if not shutil.which("psql"):
        return False
    try:
        result = subprocess.run(
            ["psql", "-h", "/tmp", "-p", "5444", "-U", "postgres",
             "-d", "postgres", "-t", "-A", "-c", "select 1;"],
            capture_output=True, text=True, timeout=10)
        return result.returncode == 0 and result.stdout.strip() == "1"
    except (subprocess.SubprocessError, OSError):
        return False


class TestMigrationFile(unittest.TestCase):
    TABLES = ("forge_rental_receptionist_calls", "forge_rental_receptionist_events",
              "forge_rental_receptionist_alerts", "forge_rental_receptionist_alert_attempts",
              "forge_rental_receptionist_drafts", "forge_rental_receptionist_delivery_outbox",
              "forge_rental_receptionist_ingest_nonces")

    @classmethod
    def setUpClass(cls):
        assert os.path.exists(V1_MIGRATION), "v1 brandy receptionist migration file missing"
        cls.sql = open(V1_MIGRATION).read()
        cls.lower = cls.sql.lower()
        # Code without -- comments, for grant assertions (comments mention
        # role names descriptively and must not trip the grant checks).
        cls.code = re.sub(r"--.*", "", cls.lower)

    def test_all_tables_created(self):
        for table in self.TABLES:
            self.assertIn(f"create table if not exists public.{table}", self.lower, table)

    def test_additive_only(self):
        # No destructive statements at all, except the nonce registry's
        # expiry purge (deleting only rows whose expires_at has passed —
        # replay-window hygiene, not app data).
        for stmt in ("drop table", "drop column", "truncate"):
            self.assertNotIn(stmt, self.lower)
        deletes = re.findall(r"delete from\s+(\S+)", self.code)
        self.assertEqual(deletes, ["public.forge_rental_receptionist_ingest_nonces"],
                         "exactly one DELETE allowed: the nonce purge")
        self.assertIn("where expires_at <= now()", self.code)

    def test_rls_enabled_and_forced(self):
        for table in self.TABLES:
            self.assertIn(f"alter table public.{table} enable row level security", self.lower, table)
            self.assertIn(f"alter table public.{table} force row level security", self.lower, table)

    def test_no_default_public_or_anon_grants(self):
        # No GRANT to PUBLIC or anon anywhere; authenticated gets only the
        # minimal RLS-gated grants (SELECT everywhere, UPDATE on drafts).
        # (Plain substring "to public" false-positives on "insert into
        # public.…", so match grant statements specifically.)
        self.assertIsNone(re.search(r"\bgrant\b[^;]*\bto\s+public\b", self.code))
        self.assertIsNone(re.search(r"\bgrant\b[^;]*\bto\s+anon\b", self.code))
        # Explicit revokes close the Supabase default-grant hole.
        self.assertIn("revoke all on", self.code)
        self.assertIn("revoke all on public.forge_rental_receptionist_calls from public, anon, authenticated, service_role", self.code)
        # Minimal service grants exist for ingestion (P1-2: UPDATE on calls).
        self.assertIn("grant select, insert, update on public.forge_rental_receptionist_calls to service_role", self.code)
        self.assertIn("grant select, insert, update on public.forge_rental_receptionist_drafts to service_role", self.code)
        self.assertIn("grant select, insert on public.forge_rental_receptionist_events to service_role", self.code)
        # Authenticated: SELECT everywhere, UPDATE on drafts only.
        self.assertIn("grant select on public.forge_rental_receptionist_calls to authenticated", self.code)
        self.assertIn("grant select, update on public.forge_rental_receptionist_drafts to authenticated", self.code)

    def test_no_guc_based_policies(self):
        # P1-5: the unbound app.current_owner_id setting is gone from code.
        self.assertNotIn("app.current_owner_id", self.code)
        # Policies use the proven predicate, per command (SELECT everywhere,
        # UPDATE on drafts only — no INSERT/UPDATE/DELETE policy on calls).
        self.assertIn("public.has_workspace_access(owner_id)", self.code)
        self.assertIn("for select to authenticated using", self.code)
        self.assertIn("for update to authenticated using", self.code)
        self.assertNotIn("for insert to authenticated", self.code)
        self.assertNotIn("for delete to authenticated", self.code)

    def test_append_only_events(self):
        self.assertIn("receptionist_events_append_only", self.sql)
        self.assertIn("raise exception", self.lower)
        # The trigger must be able to fire for the application roles.
        self.assertIn("grant execute on function public.forge_rental_receptionist_events_append_only() to service_role, authenticated", self.code)

    def test_unique_idempotency_keys(self):
        self.assertIn("ingest_idempotency_key", self.lower)
        self.assertIn("unique", self.lower)
        self.assertIn("dedupe_key", self.lower)
        # P1-1: composite-FK target on calls.
        self.assertIn("unique (owner_id, id)", self.lower)
        # P2-2: one draft per (owner, call, kind).
        self.assertIn("unique (owner_id, call_id, draft_kind)", self.lower)

    def test_owner_scoped_composite_fks(self):
        self.assertIn("owner_id", self.lower)
        self.assertIn("foreign key", self.lower)
        self.assertIn("references public.forge_rental_receptionist_calls (owner_id, id)", self.lower)

    def test_nonce_rpc(self):
        # P2-1 + fix round 2 P1-2 + fix round 3 P1-1: claim/complete/fail
        # lifecycle with exclusive lease tokens, the old commit-before-
        # write consume RPC is dropped, the token-less complete/fail
        # overloads are dropped, service-only EXECUTE on all three
        # lifecycle RPCs.
        self.assertIn("receptionist_claim_ingest_nonce", self.lower)
        self.assertIn("receptionist_complete_ingest_nonce", self.lower)
        self.assertIn("receptionist_fail_ingest_nonce", self.lower)
        self.assertIn("drop function if exists public.receptionist_consume_ingest_nonce(uuid, text, text)", self.lower)
        self.assertIn("drop function if exists public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb)", self.lower)
        self.assertIn("drop function if exists public.receptionist_fail_ingest_nonce(uuid, text, text)", self.lower)
        self.assertIn("grant execute on function public.receptionist_claim_ingest_nonce(uuid, text, text) to service_role", self.code)
        self.assertIn("grant execute on function public.receptionist_complete_ingest_nonce(uuid, text, text, uuid, jsonb, uuid) to service_role", self.code)
        self.assertIn("grant execute on function public.receptionist_fail_ingest_nonce(uuid, text, text, uuid) to service_role", self.code)
        self.assertIn("state in ('in_progress', 'committed', 'failed')", self.lower)
        # Fix round 3, P1-1: the claim is an exclusive lease — a
        # lease_token and lease_expires_at on the nonce row, a 'busy'
        # status for concurrent duplicates with a live lease.
        self.assertIn("lease_token", self.lower)
        self.assertIn("lease_expires_at", self.lower)
        self.assertIn("'busy'", self.lower)

    def test_callback_column_is_versioned_ciphertext(self):
        # P1-6: the column holds AES-256-GCM ciphertext in a versioned
        # text encoding (v1.<keyId>.<base64>), never plaintext.
        self.assertIn("callback_e164_encrypted text", self.lower)
        self.assertIn("aes-256-gcm", self.lower)
        self.assertIn("v1.<keyid>.<base64", self.lower)


class TestGoLiveMigrationFile(unittest.TestCase):
    """Go-live migration (20261108230000): additive columns only, no
    grants, no RLS changes, idempotent. The one exception to
    "additive only" is the resolution_state CHECK widening: dropping +
    re-adding the CHECK with 'REFUSED' added is a pure widening (every
    value allowed before is still allowed)."""

    @classmethod
    def setUpClass(cls):
        assert os.path.exists(GOLIVE_MIGRATION), "go-live migration file missing"
        cls.sql = open(GOLIVE_MIGRATION).read()
        cls.lower = cls.sql.lower()
        cls.code = re.sub(r"--.*", "", cls.lower)

    def test_additive_columns(self):
        self.assertIn("add column if not exists source text", self.lower)
        self.assertIn("check (source in ('test', 'live', 'synthetic'))", self.lower)
        self.assertIn("add column if not exists cost_estimate_usd numeric(10, 4)", self.lower)
        self.assertIn("add column if not exists cost_rate_version text", self.lower)
        self.assertIn("add column if not exists refused_reason text", self.lower)

    def test_no_destructive_statements(self):
        for stmt in ("drop table", "drop column", "truncate", "delete from"):
            self.assertNotIn(stmt, self.lower)
        # Exactly one constraint drop: the resolution_state CHECK widening.
        drops = re.findall(r"drop constraint if exists\s+([a-z0-9_]+)", self.code)
        self.assertEqual(drops, ["forge_rental_receptionist_alerts_resolution_state_check"])

    def test_refused_admitted_by_check(self):
        self.assertIn("'refused'", self.lower)
        self.assertIn("check (resolution_state in ('unresolved', 'acknowledged', 'dead_letter', 'refused'))", self.lower)

    def test_no_grants_or_rls_changes(self):
        self.assertNotIn("grant ", self.code)
        self.assertNotIn("revoke ", self.code)
        self.assertNotIn("row level security", self.code)
        self.assertNotIn("create table", self.code)
        self.assertNotIn("create function", self.code)

    def test_source_backfills_synthetic(self):
        self.assertIn("default 'synthetic'", self.lower)


@unittest.skipUnless(_live_postgres_available(),
                     "scratch PostgreSQL cluster (socket /tmp, port 5444) is not answering; live leg runs at apply-gate time")
class TestMigrationLivePostgres(unittest.TestCase):
    def test_live_proof_harness_passes(self):
        self.assertTrue(os.path.exists(PROOF_RUN), "RLS proof harness missing")
        result = subprocess.run(
            ["bash", PROOF_RUN], capture_output=True, text=True, timeout=300)
        tail = "\n".join((result.stdout + result.stderr).splitlines()[-25:])
        self.assertEqual(result.returncode, 0,
                         f"live-Postgres proof failed:\n{tail}")


if __name__ == "__main__":
    unittest.main()
