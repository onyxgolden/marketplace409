import { classifyDenylist } from "./denylist.mjs";
import { scanForSecrets } from "./secretScanner.mjs";
import { scanForPii } from "./piiScanner.mjs";
import { classifySourceFile, isJsLikeSource } from "./classifySourceFile.mjs";
import { extractExportedSymbols } from "./extractExportedSymbols.mjs";
import { deriveApiRoutePath } from "./deriveApiRoutePath.mjs";
import { extractSqlObjects } from "./extractSqlObjects.mjs";
import { extractSyncDocSections } from "./extractSyncDocSections.mjs";
import { deriveAssociatedSourcePaths } from "./pairTestWithSource.mjs";
import { extractPackageVersions } from "./extractPackageVersions.mjs";
import { extractContentTokens } from "./extractContentTokens.mjs";
import { hashContent } from "./hashContent.mjs";
import { AUTHORITY_LEVELS } from "./authorityLevels.mjs";
import { CLASSIFICATIONS } from "./canonicalDocumentRegistry.mjs";

const HTTP_HANDLER_NAMES = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function makeRecord({ sourcePath, sourceType, symbolOrSection, commitSha, content, authorityLevel, version = null, details = null }) {
  return {
    source_path: sourcePath,
    source_type: sourceType,
    symbol_or_section: symbolOrSection,
    commit_sha: commitSha,
    content_hash: hashContent(content),
    // Bounded retrieval tokens mined from the record's own content (see extractContentTokens.mjs).
    // Stored on the record so content terms participate in pass-1 retrieval with zero I/O --
    // on Vercel there is no git checkout, so this is the ONLY content signal the deployed
    // query path gets (the bounded content re-rank pass never runs there).
    content_tokens: extractContentTokens(content),
    authority_level: authorityLevel.id,
    version,
    details,
  };
}

// `files` is [{ path, blobSha, content }] for every tracked file worth considering (already read from
// the target commit). Returns { records, excluded, outOfScope } -- `excluded` covers denylist/secret/
// PII hits (requirement 6/7, reported by reason), `outOfScope` covers tracked files that simply aren't
// one of the categories requirement 3 asks this Phase 1 indexer to cover (most of the repo).
// `registry` (canonicalDocumentRegistry.mjs) decides documents the built-in classifier does not cover:
// registered canonical documents become canonical_document_file records, registered historical
// documents become historical_document_file records, and excluded entries are never indexed. Existing
// classifications take precedence, so FORGE_SYNC and the other current categories are unchanged.
export function buildIndexRecords({ commitSha, files, registry = [] }) {
  const records = [];
  const excluded = [];
  const outOfScope = [];
  const trackedPaths = new Set(files.map((file) => file.path));
  const registryByPath = new Map(registry.map((entry) => [entry.path, entry]));

  const migrationFiles = [];

  for (const file of files) {
    const denylistReason = classifyDenylist(file.path);
    if (denylistReason) {
      excluded.push({ source_path: file.path, reason: denylistReason });
      continue;
    }

    if (file.content === null) {
      excluded.push({ source_path: file.path, reason: "binary_or_unreadable" });
      continue;
    }

    const secretMatches = scanForSecrets(file.content);
    if (secretMatches.length > 0) {
      excluded.push({ source_path: file.path, reason: `likely_secret:${secretMatches[0]}` });
      continue;
    }

    const piiMatches = scanForPii(file.content);
    if (piiMatches.length > 0) {
      excluded.push({ source_path: file.path, reason: `likely_pii:${piiMatches[0]}` });
      continue;
    }

    const registryEntry = registryByPath.get(file.path);
    if (registryEntry?.classification === CLASSIFICATIONS.EXCLUDED) {
      excluded.push({ source_path: file.path, reason: `registry_excluded:${registryEntry.reason}` });
      continue;
    }

    let sourceType = classifySourceFile(file.path);
    if (!sourceType && registryEntry) {
      sourceType = registryEntry.classification === CLASSIFICATIONS.HISTORICAL ? "historical_document" : "canonical_document";
    }
    if (!sourceType) {
      outOfScope.push({ source_path: file.path });
      continue;
    }

    if (sourceType === "sql_migration") {
      migrationFiles.push(file);
      continue;
    }

    if (sourceType === "application_source") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "application_source_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CURRENT,
      }));
      if (isJsLikeSource(file.path)) {
        for (const symbol of extractExportedSymbols(file.content, file.path)) {
          records.push(makeRecord({
            sourcePath: file.path, sourceType: "application_source_symbol", symbolOrSection: symbol.name,
            commitSha, content: symbol.text, authorityLevel: AUTHORITY_LEVELS.CURRENT,
            details: { kind: symbol.kind },
          }));
        }
      }
    } else if (sourceType === "api_route") {
      const routePath = deriveApiRoutePath(file.path);
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "api_route_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CURRENT,
        details: { routePath },
      }));
      for (const symbol of extractExportedSymbols(file.content, file.path)) {
        records.push(makeRecord({
          sourcePath: file.path, sourceType: "api_route_symbol", symbolOrSection: symbol.name,
          commitSha, content: symbol.text, authorityLevel: AUTHORITY_LEVELS.CURRENT,
          details: { routePath, isHttpHandler: HTTP_HANDLER_NAMES.has(symbol.name) },
        }));
      }
    } else if (sourceType === "test") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "test_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CURRENT,
        details: { associatedSourcePaths: deriveAssociatedSourcePaths(file.path, trackedPaths) },
      }));
    } else if (sourceType === "synchronized_document") {
      for (const section of extractSyncDocSections(file.content)) {
        records.push(makeRecord({
          sourcePath: file.path, sourceType: "synchronized_document_section", symbolOrSection: section.sectionId,
          commitSha, content: section.body, authorityLevel: AUTHORITY_LEVELS.SYNCHRONIZED_DOCUMENT,
          details: { owner: section.owner },
        }));
      }
    } else if (sourceType === "governance_state") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "governance_state", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.GOVERNANCE_STATE,
      }));
    } else if (sourceType === "validation_evidence") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "validation_evidence", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.VALIDATION_EVIDENCE,
      }));
    } else if (sourceType === "historical_snapshot") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "historical_snapshot", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.HISTORICAL_SNAPSHOT,
      }));
    } else if (sourceType === "reviewed_decision") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "reviewed_decision", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.REVIEWED_DECISION,
      }));
    } else if (sourceType === "canonical_document") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "canonical_document_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CANONICAL_DOCUMENT,
        details: { families: [...registryEntry.families], registry_status: registryEntry.status },
      }));
    } else if (sourceType === "historical_document") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "historical_document_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.HISTORICAL_SNAPSHOT,
        details: { families: [...registryEntry.families], registry_status: registryEntry.status },
      }));
    } else if (sourceType === "package_manifest") {
      records.push(makeRecord({
        sourcePath: file.path, sourceType: "package_manifest_file", symbolOrSection: null,
        commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CURRENT,
      }));
      for (const dependency of extractPackageVersions(file.content)) {
        records.push(makeRecord({
          sourcePath: file.path, sourceType: "dependency_version", symbolOrSection: dependency.name,
          commitSha, content: `${dependency.name}@${dependency.version}`, authorityLevel: AUTHORITY_LEVELS.CURRENT,
          version: dependency.version, details: { group: dependency.group },
        }));
      }
    }
  }

  // SQL objects need cross-file resolution -- sorted by filename (this repo's forward-only,
  // timestamp-prefixed migration convention), the same order Postgres itself would apply them in.
  migrationFiles.sort((a, b) => a.path.localeCompare(b.path));
  for (const file of migrationFiles) {
    records.push(makeRecord({
      sourcePath: file.path, sourceType: "sql_migration_file", symbolOrSection: null,
      commitSha, content: file.content, authorityLevel: AUTHORITY_LEVELS.CURRENT,
    }));
  }
  const sqlObjects = extractSqlObjects(migrationFiles.map((file) => ({ path: file.path, content: file.content })));
  for (const object of sqlObjects) {
    records.push(makeRecord({
      sourcePath: object.sourcePath, sourceType: `sql_${object.objectType}`, symbolOrSection: object.key,
      commitSha, content: object.definition, authorityLevel: AUTHORITY_LEVELS.CURRENT,
      details: { table: object.table || null, name: object.name },
    }));
  }

  records.sort((a, b) => {
    const pathCompare = a.source_path.localeCompare(b.source_path);
    if (pathCompare !== 0) return pathCompare;
    return String(a.symbol_or_section).localeCompare(String(b.symbol_or_section));
  });

  return { records, excluded, outOfScope };
}
