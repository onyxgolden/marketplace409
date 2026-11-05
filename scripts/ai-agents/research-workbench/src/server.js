#!/usr/bin/env node
/**
 * server.js — the P1-C Research Workbench operator host (local only).
 *
 * Starts the real running app for the P1-C slice: an HTTP server on
 * 127.0.0.1 that serves the Workbench UI over the P1-B transport
 * against the REAL private Workbench store (drop
 * tools/agent-workbench/private-store.mjs). It is an operator tool,
 * not a public service:
 *
 * - Binds 127.0.0.1 only. A non-loopback --host refuses to start.
 * - The store directory must live outside any Git working tree and
 *   outside the drop clone (the store itself enforces this).
 * - The operator principal and decision actor come from server
 *   flags/env, never from a request. The jobs directory must hold
 *   definitions scoped to that same principal, or the server refuses
 *   to start.
 * - No scheduler, no cron, no background run, no activation
 *   endpoint, no public route. Jobs stay DISABLED; previews are
 *   manual and synthetic-only.
 *
 * Usage:
 *   node src/server.js --state-dir <dir> --jobs-dir <dir> [--port N]
 *     [--drop-root <path>] [--operator-ref op-1] [--workspace-ref ws-1]
 *     [--actor operator-1]
 *
 * Env: FORGE_PRIVATE_STATE_DIR, FORGE_RESEARCH_JOBS_DIR,
 * FORGE_AI_DROP_ROOT, FORGE_RESEARCH_OPERATOR_REF,
 * FORGE_RESEARCH_WORKSPACE_REF, FORGE_RESEARCH_ACTOR.
 * The drop root defaults to ~/workspace/forge-ai-drop when it exists;
 * without the drop's private-store module the server refuses to start
 * — there is no fallback store.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createResearchTransport } from "../../research-transport/src/transport.js";
import { loadJobDefinitions } from "./jobs.js";
import { createResearchWorkbenchHost } from "./host.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const P1A_FIXTURES = join(HERE, "..", "..", "research-job-contract", "fixtures");

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function fail(message) {
  console.error(`research-workbench: ${message}`);
  process.exit(2);
}

const stateDir = arg("state-dir", process.env.FORGE_PRIVATE_STATE_DIR ?? "");
const jobsDir = arg("jobs-dir", process.env.FORGE_RESEARCH_JOBS_DIR ?? "");
const dropRoot = arg("drop-root", process.env.FORGE_AI_DROP_ROOT ?? join(homedir(), "workspace", "forge-ai-drop"));
const port = Number(arg("port", "0"));
const host = arg("host", "127.0.0.1");
const operatorRef = arg("operator-ref", process.env.FORGE_RESEARCH_OPERATOR_REF ?? "op-1");
const workspaceRef = arg("workspace-ref", process.env.FORGE_RESEARCH_WORKSPACE_REF ?? "ws-1");
const actor = arg("actor", process.env.FORGE_RESEARCH_ACTOR ?? "operator-1");

if (!stateDir) fail("a private state directory is required (--state-dir or FORGE_PRIVATE_STATE_DIR)");
if (!jobsDir) fail("a jobs directory is required (--jobs-dir or FORGE_RESEARCH_JOBS_DIR)");
if (!Number.isInteger(port) || port < 0 || port > 65535) fail("--port must be an integer 0-65535");
if (host !== "127.0.0.1" && host !== "localhost") {
  fail(`--host '${host}' refused: the workbench binds loopback only`);
}
if (!existsSync(join(dropRoot, "tools", "agent-workbench", "private-store.mjs"))) {
  fail(`no private-store module at ${dropRoot}/tools/agent-workbench/private-store.mjs — refusing to start without the real private store`);
}

const principal = Object.freeze({ operator_ref: operatorRef, workspace_ref: workspaceRef });

const { openPrivateStore } = await import(pathToFileURL(join(dropRoot, "tools", "agent-workbench", "private-store.mjs")).href);
const store = await openPrivateStore({ stateDir: resolve(stateDir), dropRoot: resolve(dropRoot) });
const transport = createResearchTransport({ store, principal });
const jobs = loadJobDefinitions(resolve(jobsDir), principal);

// Synthetic corpora are fixture files, keyed by corpus_id. A corpus
// id the job does not allow, or that no fixture provides, refuses
// at preview time (the P1-A contract enforces the allowlist).
const corpora = {};
for (const file of ["synthetic-replay.json", "small-corpus.json", "empty-corpus.json"]) {
  const corpus = JSON.parse(readFileSync(join(P1A_FIXTURES, file), "utf8"));
  corpora[corpus.corpus_id] = corpus;
}

const workbench = createResearchWorkbenchHost({ transport, jobs, actor, corpora, basePath: "/research" });

const server = createServer(async (req, res) => {
  const chunks = [];
  req.on("data", (chunk) => {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 16 * 1024) req.destroy();
  });
  req.on("end", async () => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const result = await workbench.handleRequest({
      method: req.method ?? "GET",
      path: url.pathname,
      bodyText: Buffer.concat(chunks).toString("utf8"),
      contentType: req.headers["content-type"] ?? "",
    });
    res.writeHead(result.status, { "content-type": result.contentType });
    res.end(result.body);
  });
});

server.listen(port, host, () => {
  const address = server.address();
  console.log(`research workbench listening on http://${host}:${address.port}/research`);
  console.log(`principal ${operatorRef}/${workspaceRef} · actor ${actor} · state ${resolve(stateDir)} · jobs ${resolve(jobsDir)}`);
  console.log("DISABLED jobs, synthetic previews only — no scheduler, no activation endpoint.");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
