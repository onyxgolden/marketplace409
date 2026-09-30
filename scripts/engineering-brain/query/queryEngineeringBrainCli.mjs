import path from "node:path";
import { readFileSync } from "node:fs";

import { loadManifest } from "./loadManifest.mjs";
import { runQuery } from "./runQuery.mjs";
import { assembleDiagnosticContext } from "./assembleDiagnosticContext.mjs";
import { searchBugCatalog } from "./searchBugCatalog.mjs";
import { renderQueryOutputJson, renderQueryOutputText } from "./renderQueryOutput.mjs";
import { renderDiagnosticOutputJson, renderDiagnosticOutputText } from "./renderDiagnosticOutput.mjs";
import { loadCollectedEvidenceFile, selectEvidenceSignal } from "./loadCollectedEvidence.mjs";
import { createCachedGitReader } from "./createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../gitRepository.mjs";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");
const BUG_CATALOG_FILENAME = "bug-catalog.json";

function parseArgs(argv) {
  const args = { queryText: "", filters: {}, json: false, metadataOnly: false, manifestPath: DEFAULT_MANIFEST_PATH, maxResults: undefined, bugCatalogPath: null, noBugs: false, diagnose: false, evidencePath: null, evidenceSignalId: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--metadata-only") args.metadataOnly = true;
    else if (arg === "--manifest") args.manifestPath = argv[++i];
    else if (arg === "--bug-catalog") args.bugCatalogPath = argv[++i];
    else if (arg === "--no-bugs") args.noBugs = true;
    else if (arg === "--source-type") args.filters.sourceType = argv[++i];
    else if (arg === "--authority-level") args.filters.authorityLevel = argv[++i];
    else if (arg === "--commit-sha") args.filters.commitSha = argv[++i];
    else if (arg === "--table") args.filters.table = argv[++i];
    else if (arg === "--path") args.filters.sourcePath = argv[++i];
    else if (arg === "--max-results") args.maxResults = Number(argv[++i]);
    else if (arg === "--diagnose") args.diagnose = true;
    else if (arg === "--evidence") args.evidencePath = argv[++i];
    else if (arg === "--signal") args.evidenceSignalId = argv[++i];
    else rest.push(arg);
  }
  args.queryText = rest.join(" ");
  return args;
}

/** Load the bug catalog next to the manifest (or at an explicit path). Returns [] when absent/invalid. */
export function loadBugCatalogRecords({ manifestPath, bugCatalogPath }) {
  const catalogPath = bugCatalogPath || path.join(path.dirname(manifestPath), BUG_CATALOG_FILENAME);
  try {
    const parsed = JSON.parse(readFileSync(catalogPath, "utf8"));
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export function runCli(argv, { cwd = process.cwd() } = {}) {
  const args = parseArgs(argv);
  const manifestPath = path.isAbsolute(args.manifestPath) ? args.manifestPath : path.join(cwd, args.manifestPath);
  const manifest = loadManifest(manifestPath);
  const cachedReader = createCachedGitReader({
    readFileAtCommit: (commitSha, sourcePath) => readFileAtCommit(commitSha, sourcePath, cwd),
    readMigrationsAtCommit: (commitSha) => readMigrationsAtCommit(commitSha, cwd),
  });

  const response = runQuery({
    manifest,
    queryText: args.queryText,
    filters: args.filters,
    metadataOnly: args.metadataOnly,
    maxResults: args.maxResults,
    contentProvider: (commitSha, sourcePath) => cachedReader.readFileAtCommit(commitSha, sourcePath),
    excerptReader: cachedReader,
  });

  // Related past fixes: the bug catalog is optional — when present next to
  // the manifest it is searched with the same query and attached for review.
  // In --diagnose mode the assembler owns the whole bundle (facets, contradictions,
  // past fixes); the flat related_fixes attachment below is the non-diagnostic path only.
  if ((args.evidencePath || args.evidenceSignalId) && !args.diagnose) {
    throw new Error("--evidence/--signal require --diagnose");
  }
  if (args.diagnose) {
    // Collected-evidence re-rank: the nightly evidence.json names the failure
    // whose log paths/tokens should promote implicated code. Never guesses —
    // an ambiguous or empty evidence file is a hard error, not a silent skip.
    let evidenceSignal = null;
    if (args.evidencePath) {
      const evidenceFile = path.isAbsolute(args.evidencePath)
        ? args.evidencePath
        : path.join(cwd, args.evidencePath);
      const { signals, warnings } = loadCollectedEvidenceFile(evidenceFile);
      for (const warning of warnings) console.error(`warning: ${warning}`);
      evidenceSignal = selectEvidenceSignal(signals, args.evidenceSignalId);
    } else if (args.evidenceSignalId) {
      throw new Error("--signal requires --evidence <evidence.json>");
    }
    const bugRecords = args.noBugs || !args.queryText.trim()
      ? []
      : loadBugCatalogRecords({ manifestPath, bugCatalogPath: args.bugCatalogPath });
    const bundle = assembleDiagnosticContext({
      manifest,
      queryText: args.queryText,
      filters: args.filters,
      metadataOnly: args.metadataOnly,
      maxResults: args.maxResults,
      contentProvider: (commitSha, sourcePath) => cachedReader.readFileAtCommit(commitSha, sourcePath),
      excerptReader: cachedReader,
      bugRecords,
      evidenceSignal,
    });
    return { response: bundle, output: args.json ? renderDiagnosticOutputJson(bundle) : renderDiagnosticOutputText(bundle) };
  }

  response.related_fixes = [];
  if (!args.noBugs && args.queryText.trim()) {
    const bugRecords = loadBugCatalogRecords({ manifestPath, bugCatalogPath: args.bugCatalogPath });
    if (bugRecords.length > 0) {
      response.related_fixes = searchBugCatalog({ records: bugRecords, queryText: args.queryText, maxResults: 5 });
    }
  }

  return { response, output: args.json ? renderQueryOutputJson(response) : renderQueryOutputText(response) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { output } = runCli(process.argv.slice(2));
  console.log(output);
}
