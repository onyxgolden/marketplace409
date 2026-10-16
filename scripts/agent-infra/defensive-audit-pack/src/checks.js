/**
 * checks.js — the 18 deterministic configuration checks (3 lanes x 6).
 * Original code. Pure Node 24 ESM. All reads go through ownRead / the
 * charged reader so checks never invoke accessors and never traverse
 * prototypes.
 *
 * Verdicts: PASS | FAIL | UNVERIFIED.
 * Missing or stale evidence is UNVERIFIED, never PASS.
 */

import { ownRead } from "./budget.js";
import { evidenceDigest, canonicalJson } from "./canonical.js";

/** Charged own-property read: every consulted entry is charged BEFORE read. */
function read(ctx, obj, key, label) {
  ctx.budget.charge(label);
  ctx.watchdog.check();
  return ownRead(obj, key);
}

function evidence(pointer, value) {
  const text = typeof value === "string" ? value : canonicalJson(value === undefined ? null : value);
  return { pointer, digest: evidenceDigest(pointer, text) };
}

function finding(checkId, lane, verdict, pointer, value, remediation, extra = {}) {
  return {
    check_id: checkId,
    lane,
    verdict,
    evidence: evidence(pointer, value),
    applicability: extra.applicability ?? "configuration",
    freshness_ms: extra.freshness_ms ?? null,
    coverage: extra.coverage ?? [checkId],
    remediation,
  };
}

const PASS = "PASS";
const FAIL = "FAIL";
const UNVERIFIED = "UNVERIFIED";

/* ------------------------------------------------------------------ */
/* Lane 1: Bridge signer / command / STOP / audit configuration        */
/* ------------------------------------------------------------------ */

function bridgeChecks() {
  return [
    {
      id: "BRG-001",
      title: "Bridge command-signer identity is pinned",
      run(ctx) {
        const ptr = "$.config.signer";
        const s = read(ctx, ctx.config, "signer", "BRG-001:signer");
        if (!s.present || s.value === null || typeof s.value !== "object") {
          return finding("BRG-001", "bridge", FAIL, ptr, s.value, "Register the expected signer fingerprint in the export; an unregistered signer cannot be trusted.");
        }
        const fp = read(ctx, s.value, "fingerprint", "BRG-001:signer.fingerprint");
        const al = read(ctx, s.value, "allowlist_digest", "BRG-001:signer.allowlist_digest");
        if (!fp.present || typeof fp.value !== "string" || fp.value !== ctx.pins.signer_fingerprint) {
          return finding("BRG-001", "bridge", FAIL, `${ptr}.fingerprint`, fp.value, "Wrong signer identity: rotate to the pinned signer and re-export.", { coverage: ["signer"] });
        }
        if (!al.present || typeof al.value !== "string" || al.value.length === 0) {
          return finding("BRG-001", "bridge", FAIL, `${ptr}.allowlist_digest`, al.value, "Attach the command-allowlist digest the signer is authorized for.");
        }
        return finding("BRG-001", "bridge", PASS, `${ptr}.fingerprint`, fp.value, "None — signer matches the pinned identity.", { coverage: ["signer", "allowlist"] });
      },
    },
    {
      id: "BRG-002",
      title: "Bridge command allowlist is explicit and bounded",
      run(ctx) {
        const ptr = "$.config.commands";
        const c = read(ctx, ctx.config, "commands", "BRG-002:commands");
        if (!c.present || !Array.isArray(c.value) || c.value.length === 0) {
          return finding("BRG-002", "bridge", FAIL, ptr, c.value, "Provide a non-empty explicit command allowlist; an empty or missing allowlist is a fail-closed violation.");
        }
        for (let i = 0; i < c.value.length; i++) {
          const entry = c.value[i];
          ctx.budget.charge(`BRG-002:commands[${i}]`);
          if (typeof entry !== "string" || entry.length === 0 || entry === "*" || entry.includes("**") || /(^|[\s;|&])\*($|[\s;|&])/.test(entry)) {
            return finding("BRG-002", "bridge", FAIL, `${ptr}[${i}]`, entry, "Remove wildcard/empty command entries; every allowed command must be an exact allowlist string.");
          }
        }
        return finding("BRG-002", "bridge", PASS, ptr, `${c.value.length} explicit commands`, "None — allowlist is explicit with no wildcards.");
      },
    },
    {
      id: "BRG-003",
      title: "Bridge STOP sentinel evidence is present",
      run(ctx) {
        const ptr = "$.config.stop";
        const s = read(ctx, ctx.config, "stop", "BRG-003:stop");
        if (!s.present || s.value === null || typeof s.value !== "object") {
          return finding("BRG-003", "bridge", FAIL, ptr, s.value, "Provide STOP sentinel evidence; a missing STOP sentinel is a fail-closed violation.");
        }
        const present = read(ctx, s.value, "present", "BRG-003:stop.present");
        const ref = read(ctx, s.value, "evidence_ref", "BRG-003:stop.evidence_ref");
        const refMachine = read(ctx, s.value, "machine_id", "BRG-003:stop.machine_id");
        if (present.present && present.value === true) {
          if (refMachine.present && typeof refMachine.value === "string" && refMachine.value !== ctx.machineId) {
            return finding("BRG-003", "bridge", UNVERIFIED, `${ptr}.machine_id`, refMachine.value, "Cross-machine evidence never satisfies a check: re-collect STOP evidence on the audited machine.", { coverage: ["stop"] });
          }
          if (ref.present && typeof ref.value === "string" && ref.value.length > 0) {
            return finding("BRG-003", "bridge", PASS, `${ptr}.evidence_ref`, ref.value, "None — STOP sentinel evidence is present for this machine.", { coverage: ["stop"] });
          }
        }
        return finding("BRG-003", "bridge", FAIL, ptr, s.value, "Provide STOP sentinel evidence with a same-machine evidence reference.");
      },
    },
    {
      id: "BRG-004",
      title: "Bridge audit log coverage is declared",
      run(ctx) {
        const ptr = "$.config.audit";
        const a = read(ctx, ctx.config, "audit", "BRG-004:audit");
        if (!a.present || a.value === null || typeof a.value !== "object") {
          return finding("BRG-004", "bridge", FAIL, ptr, a.value, "Declare audit log coverage; missing audit coverage is a fail-closed violation.");
        }
        const cov = read(ctx, a.value, "coverage", "BRG-004:audit.coverage");
        if (!cov.present || !Array.isArray(cov.value) || cov.value.length === 0) {
          return finding("BRG-004", "bridge", FAIL, `${ptr}.coverage`, cov.value, "List the audited action classes (commands, stops, denials at minimum).");
        }
        return finding("BRG-004", "bridge", PASS, `${ptr}.coverage`, cov.value, "None — audit coverage is declared.", { coverage: cov.value });
      },
    },
    {
      id: "BRG-005",
      title: "Bridge export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding("BRG-005", "bridge", UNVERIFIED, ptr, ctx.collectedAtMs, "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding("BRG-005", "bridge", UNVERIFIED, ptr, ctx.collectedAtMs, "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding("BRG-005", "bridge", PASS, ptr, ctx.collectedAtMs, "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "BRG-006",
      title: "Bridge export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding("BRG-006", "bridge", ok ? PASS : FAIL, ptr, ctx.sourceDigest, ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Lane 2: Cloudflare Access / origin-binding configuration            */
/* ------------------------------------------------------------------ */

function cloudflareChecks() {
  return [
    {
      id: "CF-001",
      title: "Cloudflare Access policy is explicit and restrictive",
      run(ctx) {
        const ptr = "$.config.access";
        const a = read(ctx, ctx.config, "access", "CF-001:access");
        if (!a.present || a.value === null || typeof a.value !== "object") {
          return finding("CF-001", "cloudflare", FAIL, ptr, a.value, "Provide the Access policy; a missing policy is a fail-closed violation.");
        }
        const policy = read(ctx, a.value, "policy", "CF-001:access.policy");
        const rules = read(ctx, a.value, "rules", "CF-001:access.rules");
        if (!policy.present || typeof policy.value !== "string") {
          return finding("CF-001", "cloudflare", FAIL, `${ptr}.policy`, policy.value, "Name the Access policy explicitly (deny-by-default with an enumerated allow list).");
        }
        const p = policy.value.toLowerCase();
        const isDenyDefault = p.includes("deny") && p.includes("default");
        const hasRules = rules.present && Array.isArray(rules.value) && rules.value.length > 0;
        if (p.includes("allow all") || p.includes("bypass")) {
          return finding("CF-001", "cloudflare", FAIL, `${ptr}.policy`, policy.value, "Policy is permissive: replace with deny-by-default and an enumerated allow list.");
        }
        if (!isDenyDefault || !hasRules) {
          return finding("CF-001", "cloudflare", FAIL, `${ptr}.policy`, policy.value, "Ambiguous Access policy: state deny-by-default explicitly and enumerate the allow rules.");
        }
        return finding("CF-001", "cloudflare", PASS, `${ptr}.policy`, policy.value, "None — policy is explicit deny-by-default with enumerated rules.", { coverage: ["access"] });
      },
    },
    {
      id: "CF-002",
      title: "Origin binding is pinned (host validation)",
      run(ctx) {
        const ptr = "$.config.origin";
        const o = read(ctx, ctx.config, "origin", "CF-002:origin");
        if (!o.present || o.value === null || typeof o.value !== "object") {
          return finding("CF-002", "cloudflare", FAIL, ptr, o.value, "Pin the origin binding (host validation); a missing origin binding is a fail-closed violation.");
        }
        const hv = read(ctx, o.value, "host_validation", "CF-002:origin.host_validation");
        const eh = read(ctx, o.value, "expected_host", "CF-002:origin.expected_host");
        const refMachine = read(ctx, o.value, "machine_id", "CF-002:origin.machine_id");
        if (refMachine.present && typeof refMachine.value === "string" && refMachine.value !== ctx.machineId) {
          return finding("CF-002", "cloudflare", UNVERIFIED, `${ptr}.machine_id`, refMachine.value, "Cross-machine evidence never satisfies a check: re-collect origin evidence on the audited machine.", { coverage: ["origin"] });
        }
        if (hv.present && hv.value === true && eh.present && typeof eh.value === "string" && eh.value.length > 0) {
          return finding("CF-002", "cloudflare", PASS, `${ptr}.expected_host`, eh.value, "None — origin host validation is pinned.", { coverage: ["origin"] });
        }
        return finding("CF-002", "cloudflare", FAIL, ptr, o.value, "Enable host validation with an exact expected host (e.g. the tunnel's HTTP Host Header).");
      },
    },
    {
      id: "CF-003",
      title: "No origin bypass is configured",
      run(ctx) {
        const ptr = "$.config.bypass";
        const b = read(ctx, ctx.config, "bypass", "CF-003:bypass");
        if (!b.present || b.value === null || typeof b.value !== "object") {
          return finding("CF-003", "cloudflare", UNVERIFIED, ptr, b.value, "Bypass configuration is undeclared: export the bypass block explicitly (enabled:false) to earn PASS.");
        }
        const en = read(ctx, b.value, "enabled", "CF-003:bypass.enabled");
        if (en.present && en.value === false) {
          return finding("CF-003", "cloudflare", PASS, `${ptr}.enabled`, false, "None — origin bypass is explicitly disabled.", { coverage: ["bypass"] });
        }
        return finding("CF-003", "cloudflare", FAIL, `${ptr}.enabled`, en.value, "Origin bypass configuration: disable bypass so all traffic enforces the Access policy.");
      },
    },
    {
      id: "CF-004",
      title: "Cloudflare export coverage is declared",
      run(ctx) {
        const ok = ctx.coverage.includes("access") && ctx.coverage.includes("origin");
        return finding("CF-004", "cloudflare", ok ? PASS : UNVERIFIED, "$.coverage", ctx.coverage, ok ? "None — access and origin coverage declared." : "Re-export declaring coverage of at least [access, origin]; uncovered areas cannot earn PASS.", { coverage: ctx.coverage });
      },
    },
    {
      id: "CF-005",
      title: "Cloudflare export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding("CF-005", "cloudflare", UNVERIFIED, ptr, ctx.collectedAtMs, "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding("CF-005", "cloudflare", UNVERIFIED, ptr, ctx.collectedAtMs, "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding("CF-005", "cloudflare", PASS, ptr, ctx.collectedAtMs, "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "CF-006",
      title: "Cloudflare export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding("CF-006", "cloudflare", ok ? PASS : FAIL, ptr, ctx.sourceDigest, ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Lane 3: fleet SSH public configuration                              */
/* ------------------------------------------------------------------ */

function sshChecks() {
  return [
    {
      id: "SSH-001",
      title: "SSH uses key-based auth only",
      run(ctx) {
        const ptr = "$.config.auth";
        const a = read(ctx, ctx.config, "auth", "SSH-001:auth");
        if (!a.present || a.value === null || typeof a.value !== "object") {
          return finding("SSH-001", "fleet-ssh", FAIL, ptr, a.value, "Declare auth methods; missing auth configuration is a fail-closed violation.");
        }
        const pw = read(ctx, a.value, "password_auth", "SSH-001:auth.password_auth");
        const pk = read(ctx, a.value, "pubkey_auth", "SSH-001:auth.pubkey_auth");
        if (pw.present && pw.value === true) {
          return finding("SSH-001", "fleet-ssh", FAIL, `${ptr}.password_auth`, true, "Unsafe SSH configuration: disable password authentication; key-based auth only.");
        }
        if (pk.present && pk.value === true && (!pw.present || pw.value === false)) {
          return finding("SSH-001", "fleet-ssh", PASS, `${ptr}.pubkey_auth`, true, "None — key-based auth only.", { coverage: ["auth"] });
        }
        return finding("SSH-001", "fleet-ssh", UNVERIFIED, ptr, a.value, "Auth methods are ambiguous: export password_auth:false and pubkey_auth:true explicitly.");
      },
    },
    {
      id: "SSH-002",
      title: "SSH authorized keys are pinned",
      run(ctx) {
        const ptr = "$.config.authorized_keys";
        const k = read(ctx, ctx.config, "authorized_keys", "SSH-002:authorized_keys");
        if (!k.present || !Array.isArray(k.value) || k.value.length === 0) {
          return finding("SSH-002", "fleet-ssh", FAIL, ptr, k.value, "Export the authorized-keys fingerprint list; an empty or missing list is a fail-closed violation.");
        }
        const pinned = new Set(ctx.pins.authorized_key_fingerprints || []);
        for (let i = 0; i < k.value.length; i++) {
          ctx.budget.charge(`SSH-002:authorized_keys[${i}]`);
          const entry = k.value[i];
          const fp = entry !== null && typeof entry === "object" ? ownRead(entry, "fingerprint").value : undefined;
          if (typeof fp !== "string" || !pinned.has(fp)) {
            return finding("SSH-002", "fleet-ssh", FAIL, `${ptr}[${i}].fingerprint`, fp, "Unknown authorized key: remove it or pin it explicitly after out-of-band verification.");
          }
        }
        return finding("SSH-002", "fleet-ssh", PASS, ptr, `${k.value.length} pinned keys`, "None — every authorized key matches the pinned set.", { coverage: ["authorized_keys"] });
      },
    },
    {
      id: "SSH-003",
      title: "SSH firewall scope is restricted",
      run(ctx) {
        const ptr = "$.config.firewall";
        const f = read(ctx, ctx.config, "firewall", "SSH-003:firewall");
        if (!f.present || f.value === null || typeof f.value !== "object") {
          return finding("SSH-003", "fleet-ssh", FAIL, ptr, f.value, "Declare the firewall scope; a missing scope is a fail-closed violation.");
        }
        const ra = read(ctx, f.value, "remote_address", "SSH-003:firewall.remote_address");
        if (!ra.present || typeof ra.value !== "string" || ra.value.trim() === "" || ra.value === "0.0.0.0/0" || ra.value === "*") {
          return finding("SSH-003", "fleet-ssh", FAIL, `${ptr}.remote_address`, ra.value, "Unsafe SSH configuration: restrict the firewall rule to the LAN CIDR (a blank scope never matches safely).");
        }
        return finding("SSH-003", "fleet-ssh", PASS, `${ptr}.remote_address`, ra.value, "None — firewall scope is restricted.", { coverage: ["firewall"] });
      },
    },
    {
      id: "SSH-004",
      title: "SSH service configuration is sane",
      run(ctx) {
        const ptr = "$.config.service";
        const s = read(ctx, ctx.config, "service", "SSH-004:service");
        if (!s.present || s.value === null || typeof s.value !== "object") {
          return finding("SSH-004", "fleet-ssh", FAIL, ptr, s.value, "Export the SSH service configuration; a missing service block is a fail-closed violation.");
        }
        const hk = read(ctx, s.value, "host_keys_present", "SSH-004:service.host_keys_present");
        const bin = read(ctx, s.value, "binary", "SSH-004:service.binary");
        if (!hk.present || hk.value !== true) {
          return finding("SSH-004", "fleet-ssh", FAIL, `${ptr}.host_keys_present`, hk.value, "Host keys are missing: regenerate and verify before trusting the endpoint identity.");
        }
        if (ctx.pins.expected_sshd_binary && bin.present && typeof bin.value === "string" && bin.value !== ctx.pins.expected_sshd_binary) {
          return finding("SSH-004", "fleet-ssh", FAIL, `${ptr}.binary`, bin.value, "Unexpected sshd binary: verify the service binary matches the expected pinned path.");
        }
        return finding("SSH-004", "fleet-ssh", PASS, `${ptr}.host_keys_present`, true, "None — host keys present and service binary as expected.", { coverage: ["service"] });
      },
    },
    {
      id: "SSH-005",
      title: "SSH export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding("SSH-005", "fleet-ssh", UNVERIFIED, ptr, ctx.collectedAtMs, "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding("SSH-005", "fleet-ssh", UNVERIFIED, ptr, ctx.collectedAtMs, "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding("SSH-005", "fleet-ssh", PASS, ptr, ctx.collectedAtMs, "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "SSH-006",
      title: "SSH export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding("SSH-006", "fleet-ssh", ok ? PASS : FAIL, ptr, ctx.sourceDigest, ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
      },
    },
  ];
}

/** Freshness window: 72 hours. */
export const FRESHNESS_LIMIT_MS = 72 * 3600 * 1000;

export const LANE_CHECKS = {
  bridge: bridgeChecks(),
  cloudflare: cloudflareChecks(),
  "fleet-ssh": sshChecks(),
};

/** Required check IDs per lane — the runner asserts full execution. */
export const REQUIRED_CHECK_IDS = {
  lane: ["bridge", "cloudflare", "fleet-ssh"],
  bridge: ["BRG-001", "BRG-002", "BRG-003", "BRG-004", "BRG-005", "BRG-006"],
  cloudflare: ["CF-001", "CF-002", "CF-003", "CF-004", "CF-005", "CF-006"],
  "fleet-ssh": ["SSH-001", "SSH-002", "SSH-003", "SSH-004", "SSH-005", "SSH-006"],
};
