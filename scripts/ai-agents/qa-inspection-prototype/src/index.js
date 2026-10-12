/**
 * qa-inspection-prototype — public entry.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 */
export { run, AGENT_ID, SCHEMA_VERSION, canonicalJson, canonicalize, BudgetedResolver, BudgetExceeded, BUDGET_LIMITS } from "./classify.js";
export { validateTask, validateEvidenceRecord, isValidDateString, KINDS, OPERATIONS, MODALITIES } from "./schemas.js";
export { FixtureResolver, resolverFromJson, sha256Hex } from "./resolver.js";
export { reportToMarkdown } from "./markdown.js";
export { ledgerToMarkdown, LEDGER_COLUMNS } from "./ledger.js";
export { scanInjection, scanRecord, scanTaskLabels } from "./injection.js";
