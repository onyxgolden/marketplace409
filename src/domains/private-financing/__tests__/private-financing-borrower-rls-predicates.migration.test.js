import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../../../supabase/migrations/20260830000600_fix_private_financing_borrower_rls_predicates.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("private-financing borrower RLS predicate repair", () => {
  it("creates two boolean-only SECURITY DEFINER predicates", () => {
    expect(sql).toContain("create function has_private_financing_borrower_account_access(");
    expect(sql).toContain("create function is_private_financing_borrower_identity(");
    expect(sql.match(/returns boolean/g)).toHaveLength(2);
    expect(sql.match(/security definer/g)).toHaveLength(2);
  });

  it("pins search_path and disables RLS inside both predicates", () => {
    expect(sql.match(/set search_path = public/g)).toHaveLength(2);
    expect(sql.match(/set row_security = off/g)).toHaveLength(2);
  });

  it("revokes public execution before granting authenticated execution", () => {
    for (const signature of [
      "has_private_financing_borrower_account_access(text, text)",
      "is_private_financing_borrower_identity(text, text)",
    ]) {
      expect(sql).toContain(`revoke all on function ${signature} from public;`);
      expect(sql).toContain(`grant execute on function ${signature} to authenticated;`);
      expect(sql).not.toContain(`grant execute on function ${signature} to anon;`);
    }
  });

  it("requires an active membership tied to the current auth identity", () => {
    expect(sql).toContain("m.status = 'active'");
    expect(sql).toContain("b.auth_user_id = auth.uid()");
  });

  it("replaces all cross-table borrower policies with predicate calls", () => {
    expect(sql).toContain(
      "using (has_private_financing_borrower_account_access(owner_id, id));",
    );
    expect(sql.match(/using \(has_private_financing_borrower_account_access\(owner_id, account_id\)\);/g)).toHaveLength(2);
    expect(sql).toContain(
      "using (is_private_financing_borrower_identity(owner_id, borrower_id));",
    );
  });

  it("does not grant base-table SELECT as a shortcut", () => {
    expect(sql).not.toMatch(/grant\s+select\s+on\s+private_financing_/i);
    expect(sql).not.toMatch(/grant\s+all\s+on\s+private_financing_/i);
  });

  it("does not add or loosen any write policy", () => {
    expect(sql).not.toMatch(/for\s+(insert|update|delete|all)\s+to\s+authenticated/i);
    expect(sql).not.toContain("with check");
  });
});
