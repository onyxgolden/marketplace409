import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, "..", "..", "..", "..", "supabase", "migrations", "20261102000000_brain_conversation_harness.sql"),
  "utf8",
);

const TABLES = [
  "brain_semantic_entries",
  "brain_episodes",
  "brain_episode_corrections",
  "brain_procedures",
  "brain_conversation_preferences",
  "brain_consolidation_flags",
];

describe("brain conversation harness migration (authored, not applied)", () => {
  it("states it is authored, not applied", () => {
    expect(MIGRATION).toContain("AUTHORED, NOT APPLIED");
  });

  it("creates all six tables", () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`create table if not exists ${table}`);
    }
  });

  it("enables and forces RLS on every table", () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`alter table ${table} enable row level security;`);
      expect(MIGRATION).toContain(`alter table ${table} force row level security;`);
    }
  });

  it("gives every table four owner policies gated on has_workspace_access", () => {
    for (const table of TABLES) {
      for (const action of ["select", "insert", "update", "delete"]) {
        expect(MIGRATION).toContain(`"${table}_owner_${action}" on ${table}`);
      }
      expect(MIGRATION).toContain(`has_workspace_access(owner_id)`);
    }
  });

  it("revokes from anon/authenticated and grants to authenticated only", () => {
    for (const table of TABLES) {
      expect(MIGRATION).toContain(`revoke all on ${table} from anon, authenticated;`);
      expect(MIGRATION).toContain(`grant select, insert, update, delete on ${table} to authenticated;`);
    }
  });

  it("carries reference-only tenant pointers, never tenant details", () => {
    expect(MIGRATION).toContain("record_type text");
    expect(MIGRATION).toContain("record_id text");
    expect(MIGRATION).not.toMatch(/tenant_name|tenant_email/);
    expect(MIGRATION).not.toMatch(/^\s*amount\s/m);
  });

  it("keys semantic entries by fact for consolidation matching", () => {
    expect(MIGRATION).toContain("fact_key text");
  });

  it("stores structured candidate facts on episodes", () => {
    expect(MIGRATION).toContain("candidate_facts jsonb");
  });
});
