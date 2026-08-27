import path from "node:path";

import { loadManifest } from "./loadManifest.mjs";
import { runQuery } from "./runQuery.mjs";
import { renderQueryOutputJson, renderQueryOutputText } from "./renderQueryOutput.mjs";
import { createCachedGitReader } from "./createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../gitRepository.mjs";

const DEFAULT_MANIFEST_PATH = path.join("engineering-brain", "index-manifest.json");

function parseArgs(argv) {
  const args = { queryText: "", filters: {}, json: false, metadataOnly: false, manifestPath: DEFAULT_MANIFEST_PATH, maxResults: undefined };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--metadata-only") args.metadataOnly = true;
    else if (arg === "--manifest") args.manifestPath = argv[++i];
    else if (arg === "--source-type") args.filters.sourceType = argv[++i];
    else if (arg === "--authority-level") args.filters.authorityLevel = argv[++i];
    else if (arg === "--commit-sha") args.filters.commitSha = argv[++i];
    else if (arg === "--table") args.filters.table = argv[++i];
    else if (arg === "--path") args.filters.sourcePath = argv[++i];
    else if (arg === "--max-results") args.maxResults = Number(argv[++i]);
    else rest.push(arg);
  }
  args.queryText = rest.join(" ");
  return args;
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

  return { response, output: args.json ? renderQueryOutputJson(response) : renderQueryOutputText(response) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { output } = runCli(process.argv.slice(2));
  console.log(output);
}
