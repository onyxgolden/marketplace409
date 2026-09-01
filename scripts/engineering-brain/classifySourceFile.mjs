const JS_LIKE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx", ".mjs"];

export function isJsLikeSource(path) {
  return JS_LIKE_EXTENSIONS.some((ext) => path.endsWith(ext));
}

export function isTestFile(path) {
  return /\.test\.(js|jsx|ts|tsx|mjs)$/.test(path) || /\.integration\.test\.(js|jsx|ts|tsx|mjs)$/.test(path);
}

export function isApiRouteFile(path) {
  return /^src\/app\/.*\/route\.(js|jsx|ts|tsx)$/.test(path);
}

export function isMigrationFile(path) {
  return /^supabase\/migrations\/.*\.sql$/.test(path);
}

export function isSyncDocFile(path) {
  return /^docs\/architecture\/synchronized\/FORGE_SYNC_[A-Z_]+\.md$/.test(path);
}

export function isGovernanceStateFile(path) {
  return path === "governance/state/current-governance-state.json";
}

export function isValidationEvidenceFile(path) {
  return /^governance\/validation\/.*\.json$/.test(path);
}

export function isSnapshotFile(path) {
  return /^governance\/snapshots\/.*\.json$/.test(path);
}

export function isReviewedDecisionDoc(path) {
  return /^docs\/architecture\/lessons-learned\/.*\.md$/.test(path)
    || /^docs\/product\/.*_RUNBOOK\.md$/.test(path);
}

export function isPackageManifest(path) {
  return path === "package.json";
}

// Classifies a tracked path into exactly one source_type, or null if it falls outside every
// category this Phase 1 indexer covers (most of the repo -- images, CSS, config files unrelated to
// governance, the marketplace-side application code outside FORGE -- is intentionally out of scope;
// requirement 3 names specific categories to index, not "everything").
export function classifySourceFile(path) {
  if (isMigrationFile(path)) return "sql_migration";
  if (isSyncDocFile(path)) return "synchronized_document";
  if (isGovernanceStateFile(path)) return "governance_state";
  if (isValidationEvidenceFile(path)) return "validation_evidence";
  if (isSnapshotFile(path)) return "historical_snapshot";
  if (isReviewedDecisionDoc(path)) return "reviewed_decision";
  if (isPackageManifest(path)) return "package_manifest";
  if (isApiRouteFile(path)) return "api_route";
  if (isTestFile(path)) return "test";
  if (isJsLikeSource(path) && path.startsWith("src/")) return "application_source";
  return null;
}
