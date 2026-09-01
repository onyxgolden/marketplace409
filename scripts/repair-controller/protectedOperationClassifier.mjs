// Protected-path and protected-operation classification (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 4).
// This is a deny-leaning classifier: when in doubt, a path is flagged protected rather than not, since the
// cost of a false positive (an unnecessary escalation) is far lower than a false negative (an autonomous
// repair silently touching a protected domain). Every rule operates on a NORMALIZED path -- resolving `..`
// segments and lower-casing -- specifically because Section 14 requires "protected path detection cannot be
// bypassed with rename/case/path traversal."

import path from "node:path";

// Order matters only for the returned `reasons` array's readability -- classification itself checks every
// rule regardless of an earlier match, since a single path can legitimately trip more than one protected
// category (e.g. a migration that also touches RLS).
const PROTECTED_PATH_RULES = Object.freeze([
  { reason: "database_migration", test: (p) => p.startsWith("supabase/migrations/") },
  { reason: "authorization_or_rls", test: (p) => /rls|has[_]?workspace[_]?access|resolve[_]?effective[_]?owner[_]?id|workspace[_]?members|authoriz/.test(p) },
  { reason: "financial_logic", test: (p) => /stripe|payment|rent[-_]collect|reconcil|refund|financial|ledger|billing/.test(p) },
  { reason: "secrets_or_credentials", test: (p) => /\.env(\.|$)|secret|credential|webhook.*secret|\.pem$|service[-_]role[-_]key/.test(p) },
  { reason: "tenant_or_sensitive_record", test: (p) => /tenant|lease|deposit|insurance|ssn|personally[-_]?identifiable/.test(p) },
  { reason: "cron_schedule", test: (p) => /\.github\/workflows\/.*cron|scripts\/.*cron|cron[-_]schedule/.test(p) },
  { reason: "dependency_or_framework_manifest", test: (p) => /^package(-lock)?\.json$|^pnpm-lock\.yaml$|^yarn\.lock$/.test(p) },
  { reason: "repair_controller_self_modification", test: (p) => p.startsWith("scripts/repair-controller/") },
  { reason: "governance_updater_self_modification", test: (p) => p.startsWith("scripts/governance/") },
]);

// Resolves `..` segments and normalizes separators/case the same way regardless of platform, so
// "SUPABASE/MIGRATIONS/../migrations/x.sql" and "supabase/migrations/x.sql" classify identically. Uses
// POSIX-style resolution against a fixed fake root so a traversal attempt that tries to escape the
// repository entirely (`../../etc/passwd`) still normalizes to a comparable, deterministic string rather
// than throwing or resolving against the real filesystem.
export function normalizeRepositoryPath(rawPath) {
  if (typeof rawPath !== "string" || rawPath.trim().length === 0) return "";
  const posixPath = rawPath.replace(/\\/g, "/").toLowerCase();
  const resolved = path.posix.resolve("/repo", posixPath);
  return resolved.startsWith("/repo/") ? resolved.slice("/repo/".length) : resolved.replace(/^\/+/, "");
}

export function classifyProtectedPath(rawPath) {
  const normalized = normalizeRepositoryPath(rawPath);
  const reasons = PROTECTED_PATH_RULES.filter((rule) => rule.test(normalized)).map((rule) => rule.reason);
  return Object.freeze({ path: rawPath, normalizedPath: normalized, protected: reasons.length > 0, reasons: Object.freeze(reasons) });
}

export function classifyProtectedPaths(rawPaths) {
  return Object.freeze(rawPaths.map((rawPath) => classifyProtectedPath(rawPath)));
}

// Test-integrity signals (Section 4: "Test deletion, test weakening, skipped tests, coverage-threshold
// reduction, or validation bypasses"). AR-1 has no diff-scanning executor yet (out of scope per Section 16),
// so this operates on already-computed stats a future executor would supply -- kept as a pure, independently
// testable rule now rather than deferred wholesale to a later phase.
export function classifyTestIntegritySignals({ testsRemoved = 0, testsNewlySkipped = 0, coverageThresholdLowered = false, validationStepRemoved = false } = {}) {
  const reasons = [];
  if (testsRemoved > 0) reasons.push("tests_removed");
  if (testsNewlySkipped > 0) reasons.push("tests_newly_skipped");
  if (coverageThresholdLowered) reasons.push("coverage_threshold_lowered");
  if (validationStepRemoved) reasons.push("validation_step_removed");
  return Object.freeze({ protected: reasons.length > 0, reasons: Object.freeze(reasons) });
}
