import { extractExportedSymbols } from "../extractExportedSymbols.mjs";
import { extractSqlObjects } from "../extractSqlObjects.mjs";
import { extractSyncDocSections } from "../extractSyncDocSections.mjs";
import { hashContent } from "../hashContent.mjs";
import { scanForSecrets } from "../secretScanner.mjs";
import { scanForPii } from "../piiScanner.mjs";

const EXCERPT_MAX_CHARS = 2000;

function truncate(text) {
  if (text.length <= EXCERPT_MAX_CHARS) return { text, truncated: false };
  return { text: `${text.slice(0, EXCERPT_MAX_CHARS)}\n… [truncated]`, truncated: true };
}

// The manifest stores only a content_hash, never raw content (requirement 12 wants excerpts *from
// sanitized indexed content*, not a second copy of the whole corpus sitting in the manifest). This
// re-derives the excerpt on demand by re-fetching the file at the record's own commit_sha and
// re-running the SAME Phase 1 extraction function the indexer used -- reused as a library, not
// reimplemented -- then verifies the re-derived content hashes to exactly what the record claims.
// A mismatch (file changed, deleted, or the manifest is stale/tampered) fails closed: no excerpt is
// returned, and the caller marks the result unverifiable rather than showing possibly-wrong content.
//
// `readFileAtCommit(commitSha, path)` and `readMigrationsAtCommit(commitSha, migrationPaths)` are
// injected so tests can supply fixture content without touching a real git repository.
export function resolveExcerpt(record, { readFileAtCommit, readMigrationsAtCommit }) {
  let rawExcerpt = null;

  if (record.source_type === "dependency_version") {
    rawExcerpt = `${record.symbol_or_section}@${record.version}`;
  } else if (record.source_type === "sql_table" || record.source_type === "sql_rls_policy" || record.source_type === "sql_trigger" || record.source_type === "sql_rpc_function") {
    const migrations = readMigrationsAtCommit(record.commit_sha);
    const objects = extractSqlObjects(migrations);
    const match = objects.find((object) => object.key === record.symbol_or_section && object.sourcePath === record.source_path);
    rawExcerpt = match ? match.definition : null;
  } else if (record.source_type === "synchronized_document_section") {
    const content = readFileAtCommit(record.commit_sha, record.source_path);
    if (content !== null) {
      const section = extractSyncDocSections(content).find((s) => s.sectionId === record.symbol_or_section);
      rawExcerpt = section ? section.body : null;
    }
  } else if (record.source_type === "application_source_symbol" || record.source_type === "api_route_symbol") {
    const content = readFileAtCommit(record.commit_sha, record.source_path);
    if (content !== null) {
      const symbol = extractExportedSymbols(content, record.source_path).find((s) => s.name === record.symbol_or_section);
      rawExcerpt = symbol ? symbol.text : null;
    }
  } else {
    rawExcerpt = readFileAtCommit(record.commit_sha, record.source_path);
  }

  if (rawExcerpt === null) {
    return { verified: false, excerpt: null, reason: "source_unavailable_at_commit" };
  }

  const recomputedHash = hashContent(rawExcerpt);
  if (recomputedHash !== record.content_hash) {
    return { verified: false, excerpt: null, reason: "content_hash_mismatch" };
  }

  const secretMatches = scanForSecrets(rawExcerpt);
  const piiMatches = scanForPii(rawExcerpt);
  if (secretMatches.length > 0 || piiMatches.length > 0) {
    // Defense in depth: Phase 1 already excludes any file with this content from the manifest
    // entirely, so this should be unreachable in practice -- but a query layer must never depend on
    // an upstream guarantee holding forever, especially not for what it shows the user.
    return { verified: false, excerpt: null, reason: "excerpt_would_expose_sensitive_content" };
  }

  const { text, truncated } = truncate(rawExcerpt);
  return { verified: true, excerpt: text, truncated };
}
