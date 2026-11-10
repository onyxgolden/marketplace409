import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Repo-wide invariant for the tenant-invite rebuild (2026-11-09): the
// automated sweep that emailed tenants with no human approval is deleted,
// not disabled. This test is the acceptance gate's own check, not a
// restatement of it -- it fails if any future change reintroduces an
// automated caller of either sensitive operation. It scans source files
// directly (never samples): a regex miss here would defeat the point.
const SRC_ROOT = join(__dirname, "..", "..");

function listSourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      listSourceFiles(full, out);
    } else if (/\.(js|jsx|mjs)$/.test(entry) && !/\.test\.(js|jsx|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("tenant-invite sole-source invariant", () => {
  const files = listSourceFiles(SRC_ROOT);

  it("only the manual send-tenant-invite action writes rental_tenants.invited_at", () => {
    const writers = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      // A write, not a read: an UPDATE statement whose patch object sets
      // invited_at. Matches the exact shape both the deleted cron route
      // and the manual action used: `.update({ invited_at: ... })`.
      return /\.update\(\{[^}]*invited_at\s*:/.test(text);
    });
    const relative = writers.map((file) => file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"));
    expect(relative).toEqual(["app/api/rental/_actions/tenants.js"]);
  });

  it("only the manual send-tenant-invite action builds and sends a tenant-invite email", () => {
    const callers = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return text.includes("buildTenantInviteEmail(");
    });
    const relative = callers.map((file) => file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"));
    // tenantInviteEmail.js itself defines buildTenantInviteEmail; it does
    // not call it. _actions/tenants.js is the sole caller.
    expect(relative.sort()).toEqual([
      "app/api/rental/_actions/tenants.js",
      "domains/rental-tenant/tenantInviteEmail.js",
    ]);
  });

  it("no cron/scheduled route under src/app/api exists for tenant-invite", () => {
    const cronDir = join(SRC_ROOT, "app", "api", "rental", "cron");
    const entries = readdirSync(cronDir);
    expect(entries).not.toContain("tenant-invite");
  });
});
