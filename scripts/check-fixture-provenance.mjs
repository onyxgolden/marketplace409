// Fixture provenance and sanitization guard
// (FORGE-P-20261120-CHATGPT-PUBLIC-FIXTURE-PROVENANCE).
//
// A small repo-local, READ-ONLY checker for the changed tree only. It
// never deletes, rewrites, uploads, approves, or certifies a fixture;
// human review remains authoritative. It reports REFUSE, UNKNOWN, or
// PASS per fixture file and exits non-zero on any REFUSE or UNKNOWN.
//
// Motivating incident: exact-head review of marketplace409 PR #838 found
// a 1,829-line live-derived financial/property fixture committed to a
// public repository (real account/property names, exact balances and
// valuations, financial-account IDs, Stripe Financial Connections
// identifiers). Repair required a synthetic replacement, deletion of the
// private-dump generator, a full rescan, and a branch-history rewrite.
// This checker would have caught it before review.
//
// How it works
// ------------
// 1. Scope: only changed fixture/report artifacts — files under a
//    fixture directory, `*.fixture.*`, `*.baseline.json`,
//    `*.snapshot.json`, `*.golden.json`, `*.test-data.*`, or any file
//    that has a sidecar manifest. Source code, docs, and everything
//    else are out of scope, so a legacy fixture elsewhere in the repo
//    can never block an unrelated PR.
// 2. Provenance: every in-scope fixture needs a sidecar manifest,
//    `<fixture path with its last extension replaced by
//    .provenance.json>`, e.g. `accounts.fixture.json` ->
//    `accounts.fixture.provenance.json`. The manifest carries class,
//    source, review date, and a sha256 digest of the fixture — class,
//    source, date, and digest ONLY, never secrets or live identifiers.
//    The schema is closed: any extra or repeated field is a refusal.
//    Classes: `synthetic`, `authorized-public-source-live`, `private`
//    (private is always a refusal — private data must not be committed
//    to the public repo at all). A changed manifest resolves and loads
//    its exact paired fixture even when the fixture itself is
//    unchanged; a missing or ambiguous pair is REFUSE / UNKNOWN,
//    never a silent PASS.
// 3. Content scan: value-based patterns, never field-name based, so
//    renaming a field does not evade the scan. Secrets, operational /
//    session IDs, non-allowlisted emails, and private filesystem paths
//    are REFUSE. Anything the checker cannot classify (bare UUIDs,
//    production-shaped forge IDs, JWT shapes, long token-like strings,
//    real-looking name+money pairs in a synthetic fixture) is UNKNOWN,
//    never silently passed.
// 4. Legitimate reviewed public-source fixtures (e.g. the Risk Radar R0
//    pattern: public NWS/USGS/Census data) pass with an
//    `authorized-public-source-live` manifest naming the public source.
//
// Synthetic-fixture conventions (so a synthetic fixture passes cleanly):
// use SYN- / synth- prefixed IDs (e.g. `SYN-01`,
// `forge_project_synth_demo`), example.com / .test / .invalid emails,
// and placeholder names ("Test Tenant", "Synthetic Bank"). Real-looking
// UUIDs, Stripe-shaped IDs, and real names paired with money are not
// synthetic by shape and will be flagged.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export const VERDICTS = ["pass", "refuse", "unknown"];

const VERDICT_RANK = { pass: 0, unknown: 1, refuse: 2 };

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const FIXTURE_DIR_SEGMENTS = new Set([
  "fixtures",
  "__fixtures__",
  "test-data",
  "test_fixtures",
  "test-fixtures",
]);

export function manifestPathFor(fixturePath) {
  const base = basename(fixturePath);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return join(dirname(fixturePath), `${stem}.provenance.json`);
}

export function isManifestPath(filePath) {
  return basename(filePath).endsWith(".provenance.json");
}

export function isFixturePath(filePath) {
  const normalized = filePath.split("\\").join("/");
  const segments = normalized.split("/");
  if (segments.some((s) => FIXTURE_DIR_SEGMENTS.has(s))) return true;
  const base = segments[segments.length - 1];
  if (base.includes(".fixture.")) return true;
  // Baseline / snapshot / golden / test-data artifacts: the separator
  // before the marker may be a dot or a hyphen (the repo's own
  // phone-layout-geometry-baseline.json uses a hyphen).
  if (
    /(^|[.-])baseline\.json$/.test(base) ||
    /(^|[.-])snapshot\.json$/.test(base) ||
    /(^|[.-])golden\.json$/.test(base) ||
    /(^|[.-])test-data\.(json|csv|jsonl)$/.test(base)
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export const PROVENANCE_CLASSES = [
  "synthetic",
  "authorized-public-source-live",
  "private",
];

// The sidecar schema is closed: a manifest carries exactly these four
// fields and nothing else, so no live data can hide in an extra field.
const ALLOWED_MANIFEST_KEYS = new Set([
  "provenance",
  "source",
  "reviewed",
  "digest",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

export function computeDigest(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

// JSON.parse silently keeps the last value when an object repeats a
// key, so duplicates are invisible after parsing. This scans the raw
// text for repeated top-level keys (string-aware, depth-aware), so a
// repeated field is detectable at the parse boundary. Each key is
// DECODED before comparing: JSON permits escaped characters inside
// object keys, so "source" and "sour\u0063e" are the same property
// after parsing, and comparing raw spellings would miss the repeat.

// Decode one JSON string literal (quotes included). Returns null when
// the literal is malformed — the caller falls back to the raw spelling
// and the manifest itself is refused as malformed JSON elsewhere.
function decodeJsonStringLiteral(literal) {
  try {
    const value = JSON.parse(literal);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function findDuplicateTopLevelKeys(text) {
  const seen = new Set();
  const dupes = new Set();
  let i = 0;
  let depth = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (text[j] === '"') break;
        j++;
      }
      let k = j + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (depth === 1 && text[k] === ":") {
        const key =
          decodeJsonStringLiteral(text.slice(i, j + 1)) ?? text.slice(i + 1, j);
        if (seen.has(key)) dupes.add(key);
        else seen.add(key);
      }
      i = j + 1;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return [...dupes];
}

// Validate a parsed manifest object against the fixture text it covers.
// Returns { ok, findings } — findings are { severity, code, message }.
export function validateManifest(manifest, fixtureText, fixturePath) {
  const findings = [];
  const refuse = (code, message) => findings.push({ severity: "refuse", code, message });

  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    refuse("malformed-provenance", `${fixturePath}: manifest is not a JSON object`);
    return { ok: false, findings };
  }
  // Closed schema: any key outside the four-field contract is a
  // refusal, whatever its value — benign-looking live data (a real
  // name plus a numeric balance, an identifier) must not hide here.
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) {
      refuse(
        "unexpected-manifest-field",
        `${fixturePath}: manifest has unexpected field "${key}" — a sidecar carries class, source, review date, and digest only`,
      );
    }
  }
  if (!PROVENANCE_CLASSES.includes(manifest.provenance)) {
    refuse(
      "malformed-provenance",
      `${fixturePath}: manifest provenance must be one of ${PROVENANCE_CLASSES.join(", ")}`,
    );
  }
  if (typeof manifest.source !== "string" || manifest.source.trim() === "") {
    refuse("malformed-provenance", `${fixturePath}: manifest source must be a non-empty string`);
  }
  if (typeof manifest.reviewed !== "string" || !isRealDate(manifest.reviewed)) {
    refuse(
      "malformed-provenance",
      `${fixturePath}: manifest reviewed must be a real YYYY-MM-DD date`,
    );
  }
  if (typeof manifest.digest !== "string" || !DIGEST_RE.test(manifest.digest)) {
    refuse(
      "malformed-provenance",
      `${fixturePath}: manifest digest must be "sha256:<64 hex chars>"`,
    );
  } else if (manifest.digest !== computeDigest(fixtureText)) {
    refuse(
      "digest-mismatch",
      `${fixturePath}: manifest digest does not match the fixture file — the fixture changed after the manifest was written`,
    );
  }
  if (manifest.provenance === "private") {
    refuse(
      "private-provenance",
      `${fixturePath}: manifest declares class "private" — private data must not be committed to the public repo`,
    );
  }
  return { ok: findings.length === 0, findings };
}

// ---------------------------------------------------------------------------
// Content scan (value-based; field names are never trusted)
// ---------------------------------------------------------------------------

// Live-secret shapes. Test-mode keys (sk_test_) are deliberately NOT in
// this list: a Stripe test secret key is not live data.
const REFUSE_PATTERNS = [
  { code: "secret-stripe-live", re: /\bsk_live_[A-Za-z0-9]{16,}\b/ },
  { code: "secret-stripe-live", re: /\brk_live_[A-Za-z0-9]{16,}\b/ },
  { code: "secret-stripe-webhook", re: /\bwhsec_[A-Za-z0-9]{16,}\b/ },
  { code: "secret-github-token", re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { code: "secret-github-token", re: /\bgho_[A-Za-z0-9]{20,}\b/ },
  { code: "secret-github-token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { code: "secret-aws-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: "secret-slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { code: "secret-sendgrid-key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  { code: "secret-supabase-key", re: /\bsbp_[0-9a-f]{40}\b/ },
  { code: "secret-twilio-key", re: /\bAC[0-9a-f]{32}\b/ },
  { code: "secret-twilio-key", re: /\bSK[0-9a-f]{32}\b/ },
  { code: "secret-google-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  {
    code: "secret-private-key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  // Operational / session IDs. Includes Stripe Financial Connections
  // account IDs (fca_) — the identifier class in the PR #838 incident.
  // 16+ random chars after the prefix: real Stripe IDs carry a 24-char
  // random part, and the higher threshold keeps ordinary snake_case
  // words (sub_contractor, prod_environment, txn_reference) from
  // tripping the scan.
  { code: "live-id-stripe", re: /\bacct_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bcs_live_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bfca_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bpi_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bch_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bcus_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bsub_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bin_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bevt_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bpm_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bprice_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bprod_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\bseti_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-stripe", re: /\btxn_[A-Za-z0-9]{16,}\b/ },
  { code: "live-id-session", re: /\bsess_[A-Za-z0-9]{16,}\b/ },
  // Private filesystem paths (local machine paths must never ship).
  { code: "private-path", re: /\/Users\/[A-Za-z0-9_.-]+/ },
  { code: "private-path", re: /\/home\/[A-Za-z0-9_.-]+/ },
  { code: "private-path", re: /[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+/ },
  { code: "private-path", re: /[A-Za-z]:\\[A-Za-z0-9_.-]+\\/ },
  { code: "private-path", re: /\/private\/[A-Za-z0-9_.-]+/ },
];

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.edu",
]);
const ALLOWED_EMAIL_TLDS = new Set(["test", "invalid", "localhost"]);

const UNKNOWN_PATTERNS = [
  {
    code: "unknown-uuid",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    except: (m) => m === "00000000-0000-0000-0000-000000000000",
    message:
      "bare UUID — the checker cannot tell a real production ID from a synthetic one; use SYN- / synth- prefixed IDs, or have a human confirm it is synthetic",
  },
  {
    code: "unknown-forge-id",
    re: /\bforge_[a-z_]+_[0-9a-f]{8,}\b/g,
    message:
      "production-shaped forge ID (hex suffix) — could be a real production row ID; use the synthetic convention forge_<entity>_synth_<slug>",
  },
  {
    code: "unknown-jwt",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    message: "JWT-shaped value — the checker cannot tell a real token from a dummy one",
  },
  {
    code: "unknown-long-token",
    // 32+ char token-like runs, excluding the 64-hex digests that show
    // up as manifest digests (handled by the digest exclusion below)
    // and test-mode keys, which are explicitly not live secrets.
    re: /\b[A-Za-z0-9_-]{32,}\b/g,
    except: (m) =>
      /^[0-9a-f]{64}$/.test(m) || /^(sk|rk|pk|cs|pi)_test_/.test(m),
    message:
      "unclassifiable long token-like value — confirm it is synthetic; short readable SYN- IDs pass cleanly",
  },
  {
    code: "unknown-phone",
    re: /\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g,
    except: (m) => m.includes("555-01") || m.replace(/\D/g, "").startsWith("55501"),
    message: "real-looking phone number — use the fictional 555-01xx range in synthetic fixtures",
  },
];

// Placeholder words that mark a credential-ish value as an obvious dummy.
const PLACEHOLDER_WORDS = [
  "test",
  "example",
  "synthetic",
  "placeholder",
  "dummy",
  "fake",
  "redacted",
  "changeme",
  "xxx",
];
const CREDENTIAL_ASSIGN_RE =
  /["']?(password|passwd|secret|api[-_]?key|access[-_]?token)["']?\s*[:=]\s*["']([^"'\n]{8,})["']/gi;

const PERSON_NAME_RE = /^[A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)?$/;
const MONEY_KEY_RE = /balance|amount|valuation|price|rent|payment|deposit|debt|worth/i;

function containsPlaceholder(value) {
  const lower = value.toLowerCase();
  return PLACEHOLDER_WORDS.some((w) => lower.includes(w));
}

// Heuristic: a JSON record pairing a real-looking personal name with a
// financial amount is the shape of a real-person/property/account
// mapping. Only applied to synthetic-class fixtures — for
// authorized-public-source-live data the public source is already
// reviewed, and the mapping is the data itself. Reports UNKNOWN, never
// REFUSE: the checker cannot prove a name is real.
function scanMappings(text) {
  const findings = [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return findings;
  }
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      let nameValue = null;
      let hasMoney = false;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string" && PERSON_NAME_RE.test(value) && !containsPlaceholder(value)) {
          nameValue = value;
        }
        if (MONEY_KEY_RE.test(key) && typeof value === "number") hasMoney = true;
      }
      if (nameValue && hasMoney) {
        findings.push({
          severity: "unknown",
          code: "unknown-person-money-mapping",
          message: `possible real-person/property/account mapping (name "${nameValue}" paired with a financial amount) — have a human confirm both values are synthetic`,
        });
      }
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(parsed);
  return findings;
}

function scanText(text, { digestToExclude = null } = {}) {
  const findings = [];
  const seen = new Set();
  const add = (severity, code, message) => {
    const key = `${severity}:${code}:${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, message });
  };

  for (const { code, re } of REFUSE_PATTERNS) {
    const match = text.match(re);
    if (match) {
      add("refuse", code, `matched ${code} pattern: "${truncate(match[0])}"`);
    }
  }

  for (const email of text.match(EMAIL_RE) ?? []) {
    const domain = email.split("@")[1].toLowerCase();
    const tld = domain.split(".").pop();
    if (!ALLOWED_EMAIL_DOMAINS.has(domain) && !ALLOWED_EMAIL_TLDS.has(tld)) {
      add("refuse", "live-email", `non-allowlisted email address: "${email}"`);
    }
  }

  for (const { code, re, except, message } of UNKNOWN_PATTERNS) {
    for (const match of text.matchAll(re)) {
      const value = match[0];
      if (digestToExclude && value === digestToExclude) continue;
      if (except && except(value)) continue;
      add("unknown", code, `${message} (saw "${truncate(value)}")`);
    }
  }

  for (const match of text.matchAll(CREDENTIAL_ASSIGN_RE)) {
    const value = match[2];
    if (!containsPlaceholder(value)) {
      add(
        "unknown",
        "unknown-credential-value",
        `credential-ish assignment (${match[1]}) with a non-placeholder value — confirm it is not a real secret`,
      );
    }
  }

  return findings;
}

function truncate(value, max = 40) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

// ---------------------------------------------------------------------------
// Per-file check
// ---------------------------------------------------------------------------

// entries: [{ path, text }] — text is null when the file cannot be read.
// manifestTextByPath: Map from manifest path to its text (null if missing).
// Returns { verdict, files: [{ path, verdict, findings }] }.
export function checkFixtureFiles(entries, manifestTextByPath) {
  const results = [];

  for (const { path, text } of entries) {
    const findings = [];
    const manifestPath = manifestPathFor(path);
    const manifestText = manifestTextByPath.get(manifestPath) ?? null;

    if (text === null) {
      findings.push({
        severity: "unknown",
        code: "unreadable-fixture",
        message: `${path}: fixture could not be read (binary, deleted, or unreadable) — human review required`,
      });
      results.push({ path, verdict: "unknown", findings });
      continue;
    }

    if (manifestText === null) {
      findings.push({
        severity: "refuse",
        code: "missing-provenance",
        message: `${path}: no sidecar manifest found at ${manifestPath} — every fixture needs an explicit provenance class, source, review date, and digest`,
      });
    } else {
      let manifest = null;
      let parseFailed = false;
      try {
        manifest = JSON.parse(manifestText);
      } catch {
        parseFailed = true;
      }
      if (parseFailed) {
        findings.push({
          severity: "refuse",
          code: "malformed-provenance",
          message: `${manifestPath}: manifest is not valid JSON`,
        });
      } else {
        for (const key of findDuplicateTopLevelKeys(manifestText)) {
          findings.push({
            severity: "refuse",
            code: "duplicate-manifest-field",
            message: `${manifestPath}: manifest repeats field "${key}" — a sidecar lists each field once`,
          });
        }
        findings.push(...validateManifest(manifest, text, path).findings);
        // The manifest itself must carry no secrets or live identifiers.
        const manifestDigest = typeof manifest.digest === "string" ? manifest.digest : null;
        const manifestScan = scanText(manifestText, {
          digestToExclude: manifestDigest ? manifestDigest.replace(/^sha256:/, "") : null,
        });
        for (const f of manifestScan) {
          findings.push({ ...f, message: `${manifestPath}: ${f.message}` });
        }
        // Mapping heuristic only for synthetic-class fixtures.
        if (manifest.provenance === "synthetic") {
          findings.push(...scanMappings(text));
        }
      }
    }

    findings.push(...scanText(text));

    const verdict = worstVerdict(findings);
    results.push({ path, verdict, findings });
  }

  return { verdict: worstVerdict(results.flatMap((r) => r.findings)), files: results };
}

function worstVerdict(findings) {
  let worst = "pass";
  for (const f of findings) {
    if (VERDICT_RANK[f.severity] > VERDICT_RANK[worst]) worst = f.severity;
  }
  return worst;
}

// ---------------------------------------------------------------------------
// CLI: resolve the changed tree, read files, report
// ---------------------------------------------------------------------------

function runGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function resolveChangedPaths({ files, diff, staged, cwd }) {
  if (files && files.length > 0) return files;
  if (staged) {
    const out = runGit(["diff", "--cached", "--name-only"], cwd);
    return out ? out.split("\n") : [];
  }
  if (diff) {
    const out = runGit(["diff", "--name-only", diff], cwd);
    return out ? out.split("\n") : [];
  }
  const out = runGit(["diff", "--name-only", "HEAD"], cwd);
  return out ? out.split("\n") : [];
}

// Resolve the exact paired fixture for a changed manifest: the file in
// the same directory whose own manifest path is this manifest. Sources
// are the union of tracked files (git ls-files) and the on-disk
// listing, so a pair is found whether the fixture is tracked or
// newly written; the manifest path itself is never a candidate.
// Returns the candidate paths in the manifest's own (relative or
// absolute) form.
function pairedFixturesFor(manifestPath, cwd) {
  const dir = dirname(manifestPath);
  const isAbsolute = resolve(manifestPath) === manifestPath;
  const candidates = new Set();
  try {
    const dirArg = isAbsolute ? relative(cwd, dir) || "." : dir;
    const out = runGit(["ls-files", "--", dirArg], cwd);
    if (out) {
      for (const p of out.split("\n")) {
        if (p) candidates.add(isAbsolute ? resolve(cwd, p) : p);
      }
    }
  } catch {
    // Not a git repo (or ls-files failed) — the on-disk listing below
    // is the fallback.
  }
  try {
    for (const name of readdirSync(resolve(cwd, dir))) {
      candidates.add(join(dir, name));
    }
  } catch {
    // Directory unreadable — no on-disk candidates.
  }
  const absManifest = resolve(cwd, manifestPath);
  return [...candidates].filter(
    (p) => !isManifestPath(p) && resolve(cwd, manifestPathFor(p)) === absManifest,
  );
}

export function collectEntries(changedPaths, cwd) {
  const fixturePaths = [];
  const manifestPaths = new Set();
  for (const p of changedPaths) {
    if (!p) continue;
    if (isManifestPath(p)) {
      manifestPaths.add(p);
      continue;
    }
    if (isFixturePath(p)) fixturePaths.push(p);
  }
  // A file with a sidecar manifest in the changed set is in scope even
  // if its name does not match a fixture pattern.
  for (const m of manifestPaths) {
    const stem = basename(m).replace(/\.provenance\.json$/, "");
    const dir = dirname(m);
    for (const p of changedPaths) {
      if (!p || isManifestPath(p) || fixturePaths.includes(p)) continue;
      if (dirname(p) === dir && basename(p).startsWith(stem)) fixturePaths.push(p);
    }
  }
  // A changed manifest must resolve and load its exact paired fixture
  // even when the fixture itself is unchanged — otherwise a
  // manifest-only edit would sail through as an empty-tree PASS and
  // bypass the sidecar guarantees. A pair that cannot be resolved is
  // reported (REFUSE for a missing pair, UNKNOWN for an ambiguous
  // one), never silently passed.
  const extraResults = [];
  for (const m of manifestPaths) {
    const alreadyCovered = fixturePaths.some(
      (p) => resolve(cwd, manifestPathFor(p)) === resolve(cwd, m),
    );
    if (alreadyCovered) continue;
    const paired = pairedFixturesFor(m, cwd);
    if (paired.length === 1) {
      fixturePaths.push(paired[0]);
    } else if (paired.length === 0) {
      extraResults.push({
        path: m,
        verdict: "refuse",
        findings: [
          {
            severity: "refuse",
            code: "missing-fixture-for-manifest",
            message: `${m}: no paired fixture found — a sidecar must accompany exactly one fixture file`,
          },
        ],
      });
    } else {
      extraResults.push({
        path: m,
        verdict: "unknown",
        findings: [
          {
            severity: "unknown",
            code: "ambiguous-manifest-pair",
            message: `${m}: ${paired.length} files pair with this manifest (${paired.join(", ")}) — the checker cannot tell which fixture it covers; human review required`,
          },
        ],
      });
    }
  }
  const entries = fixturePaths.map((p) => {
    const abs = resolve(cwd, p);
    let text = null;
    try {
      if (existsSync(abs)) text = readFileSync(abs, "utf8");
    } catch {
      text = null;
    }
    return { path: p, text };
  });
  const manifestTextByPath = new Map();
  for (const entry of entries) {
    const mp = manifestPathFor(entry.path);
    const abs = resolve(cwd, mp);
    let text = null;
    try {
      if (existsSync(abs)) text = readFileSync(abs, "utf8");
    } catch {
      text = null;
    }
    manifestTextByPath.set(mp, text);
  }
  return { entries, manifestTextByPath, extraResults };
}

function printReport(result, { json }) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.files.length === 0) {
    console.log("fixture-provenance: no fixture/report artifacts in the changed tree — PASS");
    return;
  }
  for (const file of result.files) {
    console.log(`${file.verdict.toUpperCase()}  ${file.path}`);
    for (const f of file.findings) {
      console.log(`  [${f.severity}] ${f.code}: ${f.message}`);
    }
    if (file.findings.length === 0) console.log("  no findings");
  }
  console.log(`fixture-provenance: overall ${result.verdict.toUpperCase()}`);
  if (result.verdict !== "pass") {
    console.log(
      "Human review remains authoritative — this checker never approves or certifies a fixture.",
    );
  }
}

function parseArgs(argv) {
  const opts = { files: null, diff: null, staged: false, json: false, root: process.cwd() };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--files") {
      opts.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.files.push(argv[++i]);
    } else if (a === "--diff") {
      opts.diff = argv[++i];
    } else if (a === "--staged") {
      opts.staged = true;
    } else if (a === "--json") {
      opts.json = true;
    } else if (a === "--root") {
      opts.root = argv[++i];
    } else if (a === "--help" || a === "-h") {
      return { help: true };
    } else {
      rest.push(a);
    }
  }
  if (rest.length > 0) return { error: `unexpected arguments: ${rest.join(" ")}` };
  if (opts.files !== null && opts.files.length === 0) {
    return { error: "--files needs at least one file" };
  }
  if (!opts.diff && !opts.staged && opts.files === null) {
    // Default: working-tree changes vs HEAD.
  }
  return { opts };
}

export function main(argv = process.argv.slice(2)) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(
      [
        "Usage: node scripts/check-fixture-provenance.mjs [--files <f...>] [--diff <range>] [--staged] [--json] [--root <dir>]",
        "",
        "Checks changed fixture/report artifacts for provenance + sanitization.",
        "Default (no flags): working-tree changes vs HEAD. --diff takes a git",
        "range (e.g. main...HEAD). --files checks an explicit list.",
        "Exit 0 = PASS, 1 = REFUSE or UNKNOWN findings, 2 = usage/git error.",
        "Read-only: never deletes, rewrites, uploads, approves, or certifies.",
      ].join("\n"),
    );
    return 0;
  }
  if (parsed.error) {
    console.error(`fixture-provenance: ${parsed.error}`);
    return 2;
  }
  const { opts } = parsed;
  let changed;
  try {
    changed = resolveChangedPaths(opts, opts.root);
  } catch (error) {
    console.error(`fixture-provenance: git failed: ${error.message}`);
    return 2;
  }
  const { entries, manifestTextByPath, extraResults } = collectEntries(changed, opts.root);
  const result = checkFixtureFiles(entries, manifestTextByPath);
  if (extraResults.length > 0) {
    result.files.push(...extraResults);
    result.verdict = worstVerdict(result.files.flatMap((r) => r.findings));
  }
  printReport(result, { json: opts.json });
  return result.verdict === "pass" ? 0 : 1;
}

// Run as a script (not when imported by the test suite).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
