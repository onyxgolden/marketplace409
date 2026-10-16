# Defensive infrastructure audit pack — slice 1 (read-only)

Deterministic, dependency-free (Node 24 ESM, `node:crypto` only) checkers over
**synthetic sanitized configuration exports** in three lanes:

1. **Bridge** — command-signer identity, command allowlist boundedness, STOP
   sentinel evidence, audit log coverage, export freshness, digest integrity
   (`BRG-001`…`BRG-006`).
2. **Cloudflare** — Access policy restrictiveness, origin binding (host
   validation), no origin bypass, coverage declaration, freshness, digest
   (`CF-001`…`CF-006`).
3. **Fleet SSH** — key-based auth only, pinned authorized keys, restricted
   firewall scope, sane service configuration, freshness, digest
   (`SSH-001`…`SSH-006`).

## Authority and boundaries

- **Read-only.** The pack inspects supplied data. No network scanning, exploit
  execution, brute force, login probing, malware handling, credential
  extraction, key rotation, firewall/tunnel/policy mutation, GPO import,
  package installation, or live fleet collection.
- **Synthetic inputs only.** Inputs are versioned export envelopes carrying
  machine/service identity, collection time, schema, declared coverage and a
  SHA-256 source digest. No private keys, tokens, cookies, password hashes,
  vault contents, tenant data or operational records.
- **Defensive subset only.** Offensive capabilities remain parked. No code was
  copied from the community `Anthropic-Cybersecurity-Skills` repository; the
  checks are original and concise. A static export cannot prove live
  enforcement — configuration findings are labeled accordingly.
- **No deployment claim.** This pack does not claim the fleet is secure.

## Reuse matrix

| Existing coverage | What it covers | Reused here | Added here (not duplicated) |
|---|---|---|---|
| Bridge smoke probe (`forge-bridge/bridge/tests/test_smoke.py`, 27 fixture tests) | Live transport/Access evidence semantics: Access-redirect detection, empty-403 as *suspected-not-proven* origin rejection, local-bind checks, credential redaction | Evidence semantics: ambiguous evidence yields UNVERIFIED, never PASS | Configuration-side checks over static exports: signer pinning, allowlist boundedness, STOP sentinel evidence, audit coverage. The pack does not re-implement probing or redaction. |
| Skill Spectre (implementation brief `skill-spectre-implementation-brief-2026-10-12.md`; threat classes PROMPT_INJECTION, SUPPLY_CHAIN, MALWARE) | Static source scanning taxonomy | The three threat classes are preserved as-is; injected-instruction fixtures are treated as data and refused, never executed | Config-export auditing. The pack does not scan code and does not expand the security taxonomy. |
| `scripts/forge-security/collectMachineStatus.mjs` | Read-only OS diagnostic collection with injectable exec for tests | The injectable-dependency pattern for test doubles | The pack works on synthetic exports; live collection under that collector's established permissions is a later proposal, not this slice. |

## Verdict model

Findings carry `check_id`, `verdict` (`PASS`/`FAIL`/`UNVERIFIED`), an evidence
pointer plus SHA-256 digest binding the finding to verified input bytes,
applicability, freshness, coverage and a remediation proposal.

- Missing or stale evidence is **UNVERIFIED**, never PASS.
- A changed `source_digest` **refuses** the whole export (`DIGEST_MISMATCH`).
- Cross-machine evidence never satisfies a check (UNVERIFIED).
- Required missing evidence keeps the report `complete:false`.
- Whole-report `complete` is true only when every required check ran and all
  verdicts are PASS; `PARTIAL` is always `complete:false`.
- Embedded instruction-override text is refused as data (`INJECTED_INPUT`),
  never followed (Skill Spectre PROMPT_INJECTION semantics).

## Bounds (enforced)

- 64 consulted candidates — each inspected config entry is **charged before**
  it is read; the first over-budget candidate refuses without being touched.
- 256 KiB admitted input bytes.
- JSON nesting depth 16, measured by a byte-level structural scanner **before**
  `JSON.parse` (never decodes candidate fields).
- 5 s watchdog (injectable clock for tests).
- Own-property reads only: getters are never invoked (accessor input is
  refused as `ACCESSOR_REJECTED`); prototypes are never consulted.

## Usage

```js
import { auditExport } from "./src/index.js";

const report = auditExport(envelopeJsonText, {
  asOfMs: Date.now(),
  pins: {
    signer_fingerprint: "SHA256:...",
    authorized_key_fingerprints: ["SHA256:..."],
    expected_sshd_binary: "C:\\Program Files\\Git\\usr\\bin\\sshd.exe",
  },
});
// report: { status: READY|PARTIAL|REFUSED, complete, lane, machine_id, findings, ... }
```

## Tests

- `node tests/run-tests.js` — unit tests (checks, budgets, sentinels,
  injection, mutation, determinism, zero-tools).
- `node tests/run-battery.js` — frozen 36-case battery (12 per lane:
  6 passing, 6 failing/unknown), structural match, 5 s per-case cap,
  battery digest for determinism.

## Explicitly unresolved

Live verification of any finding requires the established live collectors
under their own permissions; a static export cannot prove live enforcement.
Production schema application, activation, scheduling and merge remain
separately gated.
