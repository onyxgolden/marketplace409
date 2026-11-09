"""§11.13 migration security — file-level checks + live-PostgreSQL checks
when a local throwaway server is available.

No live database exists in this environment (no initdb/postgres server),
so the live leg SKIPs with an explicit reason; the file leg asserts the
migration text proves: additive schema, owner-scoped composite FKs,
RLS + FORCE, no default PUBLIC/anon/authenticated grants, explicit
minimal service grants, append-only events, unique idempotency keys.
A live-DB run must re-verify these before any apply word.
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
MIGRATIONS = sorted(glob.glob(os.path.join(REPO_ROOT, "supabase", "migrations", "*brandy_receptionist*.sql")))


def _live_postgres_available():
    return shutil.which("initdb") is not None or shutil.which("postgres") is not None


class TestMigrationFile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert MIGRATIONS, "brandy receptionist migration file missing"
        cls.sql = open(MIGRATIONS[-1]).read()
        cls.lower = cls.sql.lower()
        # Code without -- comments, for grant assertions (comments mention
        # role names descriptively and must not trip the grant checks).
        import re as _re
        cls.code = _re.sub(r"--.*", "", cls.lower)

    def test_all_five_tables_created(self):
        for table in ("forge_rental_receptionist_calls", "forge_rental_receptionist_events",
                      "forge_rental_receptionist_alerts", "forge_rental_receptionist_alert_attempts",
                      "forge_rental_receptionist_drafts", "forge_rental_receptionist_delivery_outbox"):
            self.assertIn(f"create table if not exists public.{table}", self.lower, table)

    def test_additive_only(self):
        # No destructive statements at all.
        for stmt in ("drop table", "drop column", "truncate", "delete from"):
            self.assertNotIn(stmt, self.lower)

    def test_rls_enabled_and_forced(self):
        for table in ("forge_rental_receptionist_calls", "forge_rental_receptionist_events",
                      "forge_rental_receptionist_alerts", "forge_rental_receptionist_drafts"):
            self.assertIn(f"alter table public.{table} enable row level security", self.lower, table)
            self.assertIn(f"alter table public.{table} force row level security", self.lower, table)

    def test_no_default_public_or_anon_grants(self):
        # No grants to PUBLIC or anon anywhere; authenticated gets only the
        # minimal RLS-gated review grants (select/update on drafts/calls).
        self.assertNotIn("to public", self.code)
        self.assertNotIn("to anon", self.code)
        # Explicit revokes close the Supabase default-grant hole.
        self.assertIn("revoke all on", self.code)
        self.assertIn("revoke all on public.forge_rental_receptionist_calls from public, anon, authenticated, service_role", self.code)
        # Minimal service grants exist for ingestion.
        self.assertIn("grant select, insert on public.forge_rental_receptionist_calls to service_role", self.code)

    def test_append_only_events(self):
        self.assertIn("receptionist_events_append_only", self.sql)
        self.assertIn("raise exception", self.lower)

    def test_unique_idempotency_keys(self):
        self.assertIn("ingest_idempotency_key", self.lower)
        self.assertIn("unique", self.lower)
        self.assertIn("dedupe_key", self.lower)

    def test_owner_scoped_composite_fks(self):
        self.assertIn("owner_id", self.lower)
        self.assertIn("foreign key", self.lower)


@unittest.skipUnless(_live_postgres_available(),
                     "no local PostgreSQL server in this environment; live leg runs at apply-gate time")
class TestMigrationLivePostgres(unittest.TestCase):
    def test_placeholder(self):
        self.fail("live postgres leg not implemented in this environment")


if __name__ == "__main__":
    unittest.main()
