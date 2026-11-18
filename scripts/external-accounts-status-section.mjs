#!/usr/bin/env node
/**
 * scripts/external-accounts-status-section.mjs
 *
 * Builds the "External accounts and dependent work" section for every
 * FORGE status report (brief §5, verdict P1 on PR #831).
 *
 * This is the actual status-report generation path for the register:
 * the morning briefing runs this script and carries its output verbatim
 * (same pattern as scripts/brain-digest.mjs), and any ad-hoc FORGE
 * status report ("what remains unfinished?") runs it the same way.
 * The section is generated here — never hand-written per report — so
 * a dependency such as Property Risk Radar cannot disappear from
 * routine reporting.
 *
 * Read-only: two SELECTs against production Supabase through sb-sql
 * (read-only by default — it refuses non-SELECT statements), scoped
 * to the household platform_owner_id, then the deterministic domain
 * builder (buildExternalAccountStatusSection) and its plain-text
 * renderer. The printed section NEVER carries an account email or a
 * credential locator: the queries select only the columns the builder
 * needs, and the builder emits provider names, counts and follow-ups
 * only.
 *
 * String literals use PostgreSQL dollar-quoting ($$...$$): sb-sql's
 * own documentation notes the Management API query endpoint strips
 * single-quoted string literals.
 *
 * Never throws for the report: any failure (tables not yet created —
 * migration 20261117140000 is on HOLD until Jason's separate word —
 * sb-sql error, JSON parse failure) prints a prominent WARNING and
 * exits 0, so a register outage can never block a status report AND
 * can never be mistaken for "zero accounts". A live but empty
 * register prints the section with an explicit empty-register note.
 *
 * Usage:
 *   node scripts/external-accounts-status-section.mjs [--json]
 *
 * Env seams (production defaults; overridden by the integration test):
 *   EXTERNAL_ACCOUNTS_SQL_CMD   path to the sb-sql-compatible runner
 *                               (default: ~/workspace/skills/supabase/bin/sb-sql)
 *   EXTERNAL_ACCOUNTS_PROJECT_REF (default: bzqvenxjlstinmgbuvvg)
 *   EXTERNAL_ACCOUNTS_OWNER_ID  (default: Jason's platform owner id)
 *   FORGE_AI_DROP_DIR           forge-ai-drop clone, for the tracker
 *                               revision in the provenance line
 *                               (default: ~/workspace/forge-ai-drop)
 */

import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SB_SQL = process.env.EXTERNAL_ACCOUNTS_SQL_CMD ??
  path.join(process.env.HOME ?? "~", "workspace/skills/supabase/bin/sb-sql");
const PROJECT_REF = process.env.EXTERNAL_ACCOUNTS_PROJECT_REF ?? "bzqvenxjlstinmgbuvvg";
const OWNER_ID =
  process.env.EXTERNAL_ACCOUNTS_OWNER_ID ?? "e1b22131-9100-4a79-bbe2-b82d43af922e";
const DROP_DIR =
  process.env.FORGE_AI_DROP_DIR ??
  path.join(process.env.HOME ?? "~", "workspace/forge-ai-drop");

const {
  buildExternalAccountStatusSection,
  renderExternalAccountStatusSectionText,
} = await import(
  path.join(REPO_ROOT, "src/domains/externalAccounts/externalAccountStatusReport.js")
);

// Same column sets as the owner-only /report route: never an email or
// a credential locator.
const REPORT_ACCOUNT_COLUMNS =
  "id,seed_key,provider_name,purpose,associated_app,work_thread_label,plan_status," +
  "api_integration_status,still_needed,record_status,setup_status,last_verified_at";
const REPORT_THREAD_COLUMNS =
  "id,account_id,title,reference,state,next_action,owner,next_review_on";

function sql(query) {
  const raw = execFileSync(SB_SQL, ["--project-ref", PROJECT_REF, "--query", query], {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  throw new Error("SQL runner returned an unexpected (non-array) result");
}

function trackerRevision() {
  try {
    return execSync("git rev-parse HEAD", { cwd: DROP_DIR, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function warningText(reason) {
  const short = String(reason ?? "unknown error").split("\n")[0].slice(0, 200);
  return (
    "WARNING: External accounts register is unavailable — the " +
    `"External accounts and dependent work" section could not be generated (${short}). ` +
    "Do not treat this report as showing zero accounts; the register may hold " +
    "unreported dependencies (including Property Risk Radar)."
  );
}

function buildSection() {
  const queriedAt = new Date();
  const accounts = sql(
    `SELECT ${REPORT_ACCOUNT_COLUMNS} FROM forge_external_accounts ` +
      `WHERE platform_owner_id = $$${OWNER_ID}$$ AND deleted_at IS NULL ` +
      `ORDER BY provider_name ASC`,
  );
  const threads = sql(
    `SELECT ${REPORT_THREAD_COLUMNS} FROM forge_external_account_threads ` +
      `WHERE platform_owner_id = $$${OWNER_ID}$$ ORDER BY created_at ASC`,
  );
  const providerByAccountId = new Map(
    (accounts ?? []).map((a) => [a.id, a.provider_name]),
  );
  const section = buildExternalAccountStatusSection({
    accounts: (accounts ?? []).map((a) => ({ ...a, provider: a.provider_name })),
    threads: (threads ?? []).map((t) => ({
      ...t,
      account_provider: providerByAccountId.get(t.account_id) ?? null,
    })),
    generatedAt: queriedAt,
  });
  return {
    section,
    provenance: {
      queried_at: queriedAt.toISOString(),
      tracker_revision: trackerRevision(),
    },
  };
}

try {
  const { section, provenance } = buildSection();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ section, provenance }, null, 2));
  } else {
    console.log(renderExternalAccountStatusSectionText(section, provenance));
  }
} catch (error) {
  console.log(warningText(error?.message ?? error));
}
