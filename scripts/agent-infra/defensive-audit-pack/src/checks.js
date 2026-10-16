/**
 * checks.js — the 18 deterministic configuration checks (3 lanes x 6).
 * Original code. Pure Node 24 ESM. All reads go through ownRead / the
 * charged reader so checks never invoke accessors and never traverse
 * prototypes. Array indices are read only via their own data descriptor,
 * charged before the read.
 *
 * Verdicts: PASS | FAIL | UNVERIFIED.
 * Missing evidence is UNVERIFIED, never PASS. Explicitly observed unsafe
 * configuration may FAIL. Every finding's evidence binds the ACTUAL
 * admitted input value (pointer + SHA-256 of its canonical bytes), never
 * derived prose, plus the digest of the trusted pin set consulted.
 */

import { ownRead } from "./budget.js";
import { sha256HexUtf8 } from "./canonical.js";

/** Charged own-property read: every consulted entry is charged BEFORE read. */
function read(ctx, obj, key, label) {
  ctx.budget.charge(label);
  ctx.watchdog.check();
  return ownRead(obj, key);
}

/**
 * Charged array-index read through the own data descriptor only.
 * The budget is charged BEFORE the descriptor is inspected; the element
 * value is never read by indexed access or iteration first.
 */
function readIndex(ctx, arr, i, label) {
  ctx.budget.charge(label);
  ctx.watchdog.check();
  const d = Object.getOwnPropertyDescriptor(arr, String(i));
  if (!d || !("value" in d)) return { present: false, value: undefined };
  return { present: true, value: d.value };
}

/**
 * Evidence binds a finding to the exact admitted input bytes behind a
 * pointer: SHA-256 of the canonical JSON of the ACTUAL value consulted,
 * plus the digest of the trusted pin registration consulted by the check.
 */
function evidenceFor(ctx, pointer, value) {
  const v = value === undefined ? null : value;
  return {
    pointer,
    value_digest: sha256HexUtf8(v),
    pins_digest: ctx.pinsDigest,
  };
}

function finding(ctx, checkId, lane, verdict, pointer, value, remediation, extra = {}) {
  return {
    check_id: checkId,
    lane,
    verdict,
    evidence: evidenceFor(ctx, pointer, value),
    applicability: "configuration",
    historical: extra.historical ?? false,
    freshness_ms: extra.freshness_ms ?? null,
    coverage: extra.coverage ?? [checkId],
    freshness_sensitive: extra.freshness_sensitive ?? false,
    remediation,
  };
}

const PASS = "PASS";
const FAIL = "FAIL";
const UNVERIFIED = "UNVERIFIED";

/* ------------------------------------------------------------------ */
/* CIDR parsing: IPv4/IPv6 with deny-all detection and LAN containment */
/* ------------------------------------------------------------------ */

function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/.exec(s.trim());
  if (!m) return null;
  const octets = [m[1], m[2], m[3], m[4]].map(Number);
  if (octets.some((o) => o > 255)) return null;
  const prefix = m[5] === undefined ? 32 : Number(m[5]);
  if (prefix > 32) return null;
  const ip = ((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3];
  return { family: 4, ip, prefix };
}

function parseIPv6(s) {
  let addr = s.trim();
  let prefix = 128;
  const slash = addr.indexOf("/");
  if (slash !== -1) {
    const p = Number(addr.slice(slash + 1));
    if (!Number.isInteger(p) || p < 0 || p > 128) return null;
    prefix = p;
    addr = addr.slice(0, slash);
  }
  if (addr === "" || !/^[0-9a-fA-F:]+$/.test(addr)) return null;
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (seg) => {
    if (seg === "") return [];
    const gs = seg.split(":").map((g) => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : null));
    return gs.includes(null) ? null : gs;
  };
  const head = parseHalf(halves[0]);
  if (head === null) return null;
  let groups;
  if (halves.length === 2) {
    const tail = parseHalf(halves[1]);
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }
  let ip = 0n;
  for (const g of groups) ip = (ip << 16n) + BigInt(g);
  return { family: 6, ip, prefix };
}

/** Parse an IP/CIDR scope string (v4 or v6). Returns null when invalid. */
export function parseCidr(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t === "" || t === "*") return null;
  return t.includes(":") ? parseIPv6(t) : parseIPv4(t);
}

/** True for 0.0.0.0/0 and ::/0 — a deny-all is never a restriction. */
export function isDenyAll(cidr) {
  if (!cidr || cidr.prefix !== 0) return false;
  return cidr.ip === 0 || cidr.ip === 0n;
}

/** True when scope is fully contained in the allowed range (same family). */
export function cidrContains(allowed, scope) {
  if (!allowed || !scope || allowed.family !== scope.family) return false;
  if (scope.prefix < allowed.prefix) return false;
  const bits = allowed.family === 4 ? 32 : 128;
  const shift = BigInt(bits - allowed.prefix);
  return (BigInt(allowed.ip) >> shift) === (BigInt(scope.ip) >> shift);
}

/* ------------------------------------------------------------------ */
/* Lane 1: Bridge signer / command / STOP / audit configuration        */
/* ------------------------------------------------------------------ */

const REQUIRED_BRIDGE_CLASSES = ["commands", "stops", "denials"];
const REQUIRED_BRIDGE_COVERAGE = ["signer", "stop", "audit"];

function bridgeChecks() {
  return [
    {
      id: "BRG-001",
      title: "Bridge command-signer identity is pinned",
      run(ctx) {
        const ptr = "$.config.signer";
        const s = read(ctx, ctx.config, "signer", "BRG-001:signer");
        if (!s.present || s.value === null || typeof s.value !== "object" || Array.isArray(s.value)) {
          return finding(ctx, "BRG-001", "bridge", UNVERIFIED, ptr, s.present ? s.value : null,
            "Signer block is absent: export the signer fingerprint and allowlist digest explicitly; an unregistered signer cannot be trusted.",
            { freshness_sensitive: true, coverage: ["signer"] });
        }
        const fp = read(ctx, s.value, "fingerprint", "BRG-001:signer.fingerprint");
        const al = read(ctx, s.value, "allowlist_digest", "BRG-001:signer.allowlist_digest");
        if (!fp.present || typeof fp.value !== "string" || fp.value !== ctx.pins.signer_fingerprint) {
          return finding(ctx, "BRG-001", "bridge", FAIL, `${ptr}.fingerprint`, fp.present ? fp.value : null,
            "Wrong or missing signer identity: rotate to the pinned signer and re-export.",
            { freshness_sensitive: true, coverage: ["signer"] });
        }
        if (!al.present || typeof al.value !== "string" || al.value !== ctx.pins.command_allowlist_digest) {
          return finding(ctx, "BRG-001", "bridge", FAIL, `${ptr}.allowlist_digest`, al.present ? al.value : null,
            "Allowlist digest does not match the pinned command allowlist: re-export with the authorized allowlist binding.",
            { freshness_sensitive: true, coverage: ["signer", "allowlist"] });
        }
        return finding(ctx, "BRG-001", "bridge", PASS, `${ptr}.fingerprint`, fp.value,
          "None — signer matches the pinned identity and the pinned allowlist binding.",
          { freshness_sensitive: true, coverage: ["signer", "allowlist"] });
      },
    },
    {
      id: "BRG-002",
      title: "Bridge command allowlist is explicit and bounded",
      run(ctx) {
        const ptr = "$.config.commands";
        const c = read(ctx, ctx.config, "commands", "BRG-002:commands");
        if (!c.present || !Array.isArray(c.value)) {
          return finding(ctx, "BRG-002", "bridge", UNVERIFIED, ptr, c.present ? c.value : null,
            "Command allowlist is absent: export an explicit non-empty command allowlist.",
            { freshness_sensitive: true });
        }
        if (c.value.length === 0) {
          return finding(ctx, "BRG-002", "bridge", UNVERIFIED, ptr, [],
            "Command allowlist is empty: an empty list evidences no reviewed allowlist.",
            { freshness_sensitive: true });
        }
        for (let i = 0; i < c.value.length; i++) {
          const e = readIndex(ctx, c.value, i, `BRG-002:commands[${i}]`);
          const v = e.value;
          if (!e.present || typeof v !== "string" || v.length === 0 || v === "*" || v.includes("**") || /(^|[\s;|&])\*($|[\s;|&])/.test(v)) {
            return finding(ctx, "BRG-002", "bridge", FAIL, `${ptr}[${i}]`, v,
              "Remove wildcard/empty/malformed command entries; every allowed command must be an exact allowlist string.",
              { freshness_sensitive: true });
          }
        }
        return finding(ctx, "BRG-002", "bridge", PASS, ptr, c.value,
          "None — allowlist is explicit with no wildcards.",
          { freshness_sensitive: true, coverage: ["commands"] });
      },
    },
    {
      id: "BRG-003",
      title: "Bridge STOP sentinel evidence is present and machine-bound",
      run(ctx) {
        const ptr = "$.config.stop";
        const s = read(ctx, ctx.config, "stop", "BRG-003:stop");
        if (!s.present || s.value === null || typeof s.value !== "object" || Array.isArray(s.value)) {
          return finding(ctx, "BRG-003", "bridge", UNVERIFIED, ptr, s.present ? s.value : null,
            "STOP sentinel block is absent: export STOP evidence explicitly; a missing STOP block is not evidence of safety.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        const present = read(ctx, s.value, "present", "BRG-003:stop.present");
        if (!present.present) {
          return finding(ctx, "BRG-003", "bridge", UNVERIFIED, `${ptr}.present`, null,
            "STOP presence is undeclared: export present:true with same-machine evidence.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        if (present.value !== true) {
          return finding(ctx, "BRG-003", "bridge", FAIL, `${ptr}.present`, present.value,
            "STOP sentinel is explicitly absent: enable and evidence the STOP sentinel.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        const refMachine = read(ctx, s.value, "machine_id", "BRG-003:stop.machine_id");
        if (!refMachine.present || typeof refMachine.value !== "string" || refMachine.value.length === 0) {
          return finding(ctx, "BRG-003", "bridge", UNVERIFIED, `${ptr}.machine_id`, refMachine.present ? refMachine.value : null,
            "STOP evidence is not bound to a machine: export the evidence machine_id explicitly; unbound evidence never satisfies this check.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        if (refMachine.value !== ctx.machineId) {
          return finding(ctx, "BRG-003", "bridge", UNVERIFIED, `${ptr}.machine_id`, refMachine.value,
            "Cross-machine evidence never satisfies a check: re-collect STOP evidence on the audited machine.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        const ref = read(ctx, s.value, "evidence_ref", "BRG-003:stop.evidence_ref");
        if (!ref.present || typeof ref.value !== "string" || ref.value.length === 0) {
          return finding(ctx, "BRG-003", "bridge", UNVERIFIED, `${ptr}.evidence_ref`, ref.present ? ref.value : null,
            "STOP evidence reference is absent: export the evidence reference explicitly.",
            { freshness_sensitive: true, coverage: ["stop"] });
        }
        return finding(ctx, "BRG-003", "bridge", PASS, `${ptr}.evidence_ref`, ref.value,
          "None — STOP sentinel evidence is present and bound to this machine.",
          { freshness_sensitive: true, coverage: ["stop"] });
      },
    },
    {
      id: "BRG-004",
      title: "Bridge audit log coverage declares every required action class",
      run(ctx) {
        const ptr = "$.config.audit";
        const a = read(ctx, ctx.config, "audit", "BRG-004:audit");
        if (!a.present || a.value === null || typeof a.value !== "object" || Array.isArray(a.value)) {
          return finding(ctx, "BRG-004", "bridge", UNVERIFIED, ptr, a.present ? a.value : null,
            "Audit block is absent: declare audit log coverage explicitly.",
            { freshness_sensitive: true });
        }
        const cov = read(ctx, a.value, "coverage", "BRG-004:audit.coverage");
        if (!cov.present || !Array.isArray(cov.value)) {
          return finding(ctx, "BRG-004", "bridge", UNVERIFIED, `${ptr}.coverage`, cov.present ? cov.value : null,
            "Audit coverage is undeclared: list the audited action classes (commands, stops, denials at minimum).",
            { freshness_sensitive: true });
        }
        const missing = REQUIRED_BRIDGE_CLASSES.filter((k) => !cov.value.includes(k));
        if (missing.length > 0) {
          return finding(ctx, "BRG-004", "bridge", FAIL, `${ptr}.coverage`, cov.value,
            `Audit coverage is explicitly insufficient: missing required action classes: ${missing.join(", ")}.`,
            { freshness_sensitive: true });
        }
        const missingEnv = REQUIRED_BRIDGE_COVERAGE.filter((k) => !ctx.coverage.includes(k));
        if (missingEnv.length > 0) {
          return finding(ctx, "BRG-004", "bridge", UNVERIFIED, "$.coverage", ctx.coverage,
            `Export coverage is insufficient for this lane: missing ${missingEnv.join(", ")}; uncovered areas cannot earn PASS.`,
            { freshness_sensitive: true });
        }
        return finding(ctx, "BRG-004", "bridge", PASS, `${ptr}.coverage`, cov.value,
          "None — audit coverage declares every required action class.",
          { freshness_sensitive: true, coverage: cov.value });
      },
    },
    {
      id: "BRG-005",
      title: "Bridge export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding(ctx, "BRG-005", "bridge", UNVERIFIED, ptr, ctx.collectedAt,
            "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding(ctx, "BRG-005", "bridge", UNVERIFIED, ptr, ctx.collectedAt,
            "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding(ctx, "BRG-005", "bridge", PASS, ptr, ctx.collectedAt,
          "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "BRG-006",
      title: "Bridge export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding(ctx, "BRG-006", "bridge", ok ? PASS : FAIL, ptr, ctx.sourceDigest,
          ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Lane 2: Cloudflare Access / origin-binding configuration            */
/* ------------------------------------------------------------------ */

/** Validated allow-rule grammar: allow:<token>. Anything else is refused. */
const ALLOW_RULE_RE = /^allow:[A-Za-z0-9][A-Za-z0-9_.+\-]*$/;

function cloudflareChecks() {
  return [
    {
      id: "CF-001",
      title: "Cloudflare Access policy is explicit deny-by-default with validated rules",
      run(ctx) {
        const ptr = "$.config.access";
        const a = read(ctx, ctx.config, "access", "CF-001:access");
        if (!a.present || a.value === null || typeof a.value !== "object" || Array.isArray(a.value)) {
          return finding(ctx, "CF-001", "cloudflare", UNVERIFIED, ptr, a.present ? a.value : null,
            "Access policy block is absent: export the policy explicitly.",
            { freshness_sensitive: true });
        }
        const policy = read(ctx, a.value, "policy", "CF-001:access.policy");
        const rules = read(ctx, a.value, "rules", "CF-001:access.rules");
        if (!policy.present || typeof policy.value !== "string") {
          return finding(ctx, "CF-001", "cloudflare", UNVERIFIED, `${ptr}.policy`, policy.present ? policy.value : null,
            "Access policy is undeclared: name the policy explicitly (deny-by-default with an enumerated allow list).",
            { freshness_sensitive: true });
        }
        const p = policy.value.toLowerCase();
        if (p.includes("allow all") || p.includes("allow everyone") || p.includes("bypass")) {
          return finding(ctx, "CF-001", "cloudflare", FAIL, `${ptr}.policy`, policy.value,
            "Policy is explicitly permissive: replace with deny-by-default and an enumerated allow list.",
            { freshness_sensitive: true });
        }
        if (!(p.includes("deny") && p.includes("default"))) {
          return finding(ctx, "CF-001", "cloudflare", FAIL, `${ptr}.policy`, policy.value,
            "Policy is not explicit deny-by-default: state deny-by-default explicitly.",
            { freshness_sensitive: true });
        }
        if (!rules.present || !Array.isArray(rules.value) || rules.value.length === 0) {
          return finding(ctx, "CF-001", "cloudflare", UNVERIFIED, `${ptr}.rules`, rules.present ? rules.value : null,
            "Allow rules are undeclared: enumerate the allow rules explicitly; undeclared rules cannot earn PASS.",
            { freshness_sensitive: true });
        }
        for (let i = 0; i < rules.value.length; i++) {
          const e = readIndex(ctx, rules.value, i, `CF-001:access.rules[${i}]`);
          if (!e.present || typeof e.value !== "string" || !ALLOW_RULE_RE.test(e.value)) {
            return finding(ctx, "CF-001", "cloudflare", FAIL, `${ptr}.rules[${i}]`, e.value,
              "Rule is not a validated allow entry (allow:<token>): permissive or malformed rules are refused.",
              { freshness_sensitive: true });
          }
        }
        return finding(ctx, "CF-001", "cloudflare", PASS, `${ptr}.policy`, policy.value,
          "None — policy is explicit deny-by-default with validated allow rules.",
          { freshness_sensitive: true, coverage: ["access"] });
      },
    },
    {
      id: "CF-002",
      title: "Origin binding is pinned to the expected host",
      run(ctx) {
        const ptr = "$.config.origin";
        const o = read(ctx, ctx.config, "origin", "CF-002:origin");
        if (!o.present || o.value === null || typeof o.value !== "object" || Array.isArray(o.value)) {
          return finding(ctx, "CF-002", "cloudflare", UNVERIFIED, ptr, o.present ? o.value : null,
            "Origin block is absent: pin the origin binding explicitly.",
            { freshness_sensitive: true });
        }
        const hv = read(ctx, o.value, "host_validation", "CF-002:origin.host_validation");
        const eh = read(ctx, o.value, "expected_host", "CF-002:origin.expected_host");
        const refMachine = read(ctx, o.value, "machine_id", "CF-002:origin.machine_id");
        if (refMachine.present && typeof refMachine.value === "string" && refMachine.value.length > 0 && refMachine.value !== ctx.machineId) {
          return finding(ctx, "CF-002", "cloudflare", UNVERIFIED, `${ptr}.machine_id`, refMachine.value,
            "Cross-machine evidence never satisfies a check: re-collect origin evidence on the audited machine.",
            { freshness_sensitive: true, coverage: ["origin"] });
        }
        if (!hv.present) {
          return finding(ctx, "CF-002", "cloudflare", UNVERIFIED, `${ptr}.host_validation`, null,
            "Host validation is undeclared: enable it explicitly with an exact expected host.",
            { freshness_sensitive: true });
        }
        if (hv.value !== true) {
          return finding(ctx, "CF-002", "cloudflare", FAIL, `${ptr}.host_validation`, hv.value,
            "Host validation is explicitly disabled: enable it with the pinned expected host.",
            { freshness_sensitive: true });
        }
        if (!eh.present || typeof eh.value !== "string" || eh.value.length === 0) {
          return finding(ctx, "CF-002", "cloudflare", UNVERIFIED, `${ptr}.expected_host`, eh.present ? eh.value : null,
            "Expected host is undeclared: export the exact expected host.",
            { freshness_sensitive: true });
        }
        if (eh.value !== ctx.pins.expected_origin_host) {
          return finding(ctx, "CF-002", "cloudflare", FAIL, `${ptr}.expected_host`, eh.value,
            "Expected host does not match the pinned origin host: an unbound host is never accepted.",
            { freshness_sensitive: true });
        }
        return finding(ctx, "CF-002", "cloudflare", PASS, `${ptr}.expected_host`, eh.value,
          "None — origin host validation is pinned to the expected host.",
          { freshness_sensitive: true, coverage: ["origin"] });
      },
    },
    {
      id: "CF-003",
      title: "No origin bypass is configured",
      run(ctx) {
        const ptr = "$.config.bypass";
        const b = read(ctx, ctx.config, "bypass", "CF-003:bypass");
        if (!b.present || b.value === null || typeof b.value !== "object" || Array.isArray(b.value)) {
          return finding(ctx, "CF-003", "cloudflare", UNVERIFIED, ptr, b.present ? b.value : null,
            "Bypass configuration is undeclared: export the bypass block explicitly (enabled:false) to earn PASS.",
            { freshness_sensitive: true });
        }
        const en = read(ctx, b.value, "enabled", "CF-003:bypass.enabled");
        if (en.present && en.value === false) {
          return finding(ctx, "CF-003", "cloudflare", PASS, `${ptr}.enabled`, false,
            "None — origin bypass is explicitly disabled.",
            { freshness_sensitive: true, coverage: ["bypass"] });
        }
        return finding(ctx, "CF-003", "cloudflare", FAIL, `${ptr}.enabled`, en.present ? en.value : null,
          "Origin bypass is enabled or ambiguous: disable bypass so all traffic enforces the Access policy.",
          { freshness_sensitive: true });
      },
    },
    {
      id: "CF-004",
      title: "Cloudflare export coverage is declared",
      run(ctx) {
        const ok = ctx.coverage.includes("access") && ctx.coverage.includes("origin");
        return finding(ctx, "CF-004", "cloudflare", ok ? PASS : UNVERIFIED, "$.coverage", ctx.coverage,
          ok ? "None — access and origin coverage declared." : "Re-export declaring coverage of at least [access, origin]; uncovered areas cannot earn PASS.",
          { coverage: ctx.coverage });
      },
    },
    {
      id: "CF-005",
      title: "Cloudflare export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding(ctx, "CF-005", "cloudflare", UNVERIFIED, ptr, ctx.collectedAt,
            "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding(ctx, "CF-005", "cloudflare", UNVERIFIED, ptr, ctx.collectedAt,
            "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding(ctx, "CF-005", "cloudflare", PASS, ptr, ctx.collectedAt,
          "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "CF-006",
      title: "Cloudflare export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding(ctx, "CF-006", "cloudflare", ok ? PASS : FAIL, ptr, ctx.sourceDigest,
          ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
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
      title: "SSH uses key-based auth only, explicitly evidenced",
      run(ctx) {
        const ptr = "$.config.auth";
        const a = read(ctx, ctx.config, "auth", "SSH-001:auth");
        if (!a.present || a.value === null || typeof a.value !== "object" || Array.isArray(a.value)) {
          return finding(ctx, "SSH-001", "fleet-ssh", UNVERIFIED, ptr, a.present ? a.value : null,
            "Auth block is absent: declare auth methods explicitly.",
            { freshness_sensitive: true });
        }
        const pw = read(ctx, a.value, "password_auth", "SSH-001:auth.password_auth");
        const pk = read(ctx, a.value, "pubkey_auth", "SSH-001:auth.pubkey_auth");
        if (pw.present && pw.value === true) {
          return finding(ctx, "SSH-001", "fleet-ssh", FAIL, `${ptr}.password_auth`, true,
            "Unsafe SSH configuration: disable password authentication; key-based auth only.",
            { freshness_sensitive: true });
        }
        if (!pw.present) {
          return finding(ctx, "SSH-001", "fleet-ssh", UNVERIFIED, `${ptr}.password_auth`, null,
            "password_auth is undeclared: key-only auth cannot be claimed without explicit evidence that password auth is disabled.",
            { freshness_sensitive: true });
        }
        if (!pk.present || pk.value !== true) {
          return finding(ctx, "SSH-001", "fleet-ssh", UNVERIFIED, `${ptr}.pubkey_auth`, pk.present ? pk.value : null,
            "pubkey_auth is not explicitly enabled: export pubkey_auth:true explicitly.",
            { freshness_sensitive: true });
        }
        return finding(ctx, "SSH-001", "fleet-ssh", PASS, `${ptr}.pubkey_auth`, true,
          "None — key-based auth only, explicitly evidenced.",
          { freshness_sensitive: true, coverage: ["auth"] });
      },
    },
    {
      id: "SSH-002",
      title: "SSH authorized keys are pinned",
      run(ctx) {
        const ptr = "$.config.authorized_keys";
        const k = read(ctx, ctx.config, "authorized_keys", "SSH-002:authorized_keys");
        if (!k.present || !Array.isArray(k.value)) {
          return finding(ctx, "SSH-002", "fleet-ssh", UNVERIFIED, ptr, k.present ? k.value : null,
            "Authorized-keys list is absent: export the fingerprint list explicitly.",
            { freshness_sensitive: true });
        }
        if (k.value.length === 0) {
          return finding(ctx, "SSH-002", "fleet-ssh", UNVERIFIED, ptr, [],
            "Authorized-keys list is empty: no pinned keys are evidenced.",
            { freshness_sensitive: true });
        }
        const pinned = new Set(ctx.pins.authorized_key_fingerprints || []);
        for (let i = 0; i < k.value.length; i++) {
          const e = readIndex(ctx, k.value, i, `SSH-002:authorized_keys[${i}]`);
          const fp = e.present && e.value !== null && typeof e.value === "object" && !Array.isArray(e.value)
            ? ownRead(e.value, "fingerprint").value
            : undefined;
          if (typeof fp !== "string" || !pinned.has(fp)) {
            return finding(ctx, "SSH-002", "fleet-ssh", FAIL, `${ptr}[${i}].fingerprint`, fp,
              "Unknown or malformed authorized key: remove it or pin it explicitly after out-of-band verification.",
              { freshness_sensitive: true });
          }
        }
        return finding(ctx, "SSH-002", "fleet-ssh", PASS, ptr, k.value,
          "None — every authorized key matches the pinned set.",
          { freshness_sensitive: true, coverage: ["authorized_keys"] });
      },
    },
    {
      id: "SSH-003",
      title: "SSH firewall scope is a restricted LAN CIDR",
      run(ctx) {
        const ptr = "$.config.firewall";
        const f = read(ctx, ctx.config, "firewall", "SSH-003:firewall");
        if (!f.present || f.value === null || typeof f.value !== "object" || Array.isArray(f.value)) {
          return finding(ctx, "SSH-003", "fleet-ssh", UNVERIFIED, ptr, f.present ? f.value : null,
            "Firewall block is absent: declare the firewall scope explicitly.",
            { freshness_sensitive: true });
        }
        const ra = read(ctx, f.value, "remote_address", "SSH-003:firewall.remote_address");
        if (!ra.present || typeof ra.value !== "string") {
          return finding(ctx, "SSH-003", "fleet-ssh", UNVERIFIED, `${ptr}.remote_address`, ra.present ? ra.value : null,
            "remote_address is undeclared: export the firewall scope explicitly.",
            { freshness_sensitive: true });
        }
        if (ra.value.trim() === "") {
          return finding(ctx, "SSH-003", "fleet-ssh", FAIL, `${ptr}.remote_address`, ra.value,
            "Unsafe SSH configuration: a blank firewall scope never matches safely; restrict to the LAN CIDR.",
            { freshness_sensitive: true });
        }
        const scope = parseCidr(ra.value);
        if (!scope) {
          return finding(ctx, "SSH-003", "fleet-ssh", FAIL, `${ptr}.remote_address`, ra.value,
            "remote_address is not a valid IP/CIDR scope: an unparsed scope is never treated as restricted.",
            { freshness_sensitive: true });
        }
        if (isDenyAll(scope)) {
          return finding(ctx, "SSH-003", "fleet-ssh", FAIL, `${ptr}.remote_address`, ra.value,
            "remote_address is a deny-all scope (0.0.0.0/0 or ::/0): that is the opposite of restricted.",
            { freshness_sensitive: true });
        }
        const allowed = (ctx.pins.allowed_lan_cidrs || []).map(parseCidr).filter(Boolean);
        if (!allowed.some((a) => cidrContains(a, scope))) {
          return finding(ctx, "SSH-003", "fleet-ssh", FAIL, `${ptr}.remote_address`, ra.value,
            "remote_address is not within a declared allowed LAN range: restrict the firewall rule to the declared LAN CIDRs.",
            { freshness_sensitive: true });
        }
        return finding(ctx, "SSH-003", "fleet-ssh", PASS, `${ptr}.remote_address`, ra.value,
          "None — firewall scope is a restricted LAN CIDR.",
          { freshness_sensitive: true, coverage: ["firewall"] });
      },
    },
    {
      id: "SSH-004",
      title: "SSH service configuration is sane and binary-bound",
      run(ctx) {
        const ptr = "$.config.service";
        const s = read(ctx, ctx.config, "service", "SSH-004:service");
        if (!s.present || s.value === null || typeof s.value !== "object" || Array.isArray(s.value)) {
          return finding(ctx, "SSH-004", "fleet-ssh", UNVERIFIED, ptr, s.present ? s.value : null,
            "Service block is absent: export the SSH service configuration explicitly.",
            { freshness_sensitive: true });
        }
        const hk = read(ctx, s.value, "host_keys_present", "SSH-004:service.host_keys_present");
        if (!hk.present) {
          return finding(ctx, "SSH-004", "fleet-ssh", UNVERIFIED, `${ptr}.host_keys_present`, null,
            "host_keys_present is undeclared: export it explicitly.",
            { freshness_sensitive: true });
        }
        if (hk.value !== true) {
          return finding(ctx, "SSH-004", "fleet-ssh", FAIL, `${ptr}.host_keys_present`, hk.value,
            "Host keys are missing: regenerate and verify before trusting the endpoint identity.",
            { freshness_sensitive: true });
        }
        const bin = read(ctx, s.value, "binary", "SSH-004:service.binary");
        if (!bin.present || typeof bin.value !== "string" || bin.value.length === 0) {
          return finding(ctx, "SSH-004", "fleet-ssh", UNVERIFIED, `${ptr}.binary`, bin.present ? bin.value : null,
            "Service binary is undeclared: the binary cannot be claimed as expected without it.",
            { freshness_sensitive: true });
        }
        if (ctx.pins.expected_sshd_binary && bin.value !== ctx.pins.expected_sshd_binary) {
          return finding(ctx, "SSH-004", "fleet-ssh", FAIL, `${ptr}.binary`, bin.value,
            "Unexpected sshd binary: verify the service binary matches the expected pinned path.",
            { freshness_sensitive: true });
        }
        return finding(ctx, "SSH-004", "fleet-ssh", PASS, `${ptr}.host_keys_present`, true,
          "None — host keys present and service binary matches the pinned path.",
          { freshness_sensitive: true, coverage: ["service"] });
      },
    },
    {
      id: "SSH-005",
      title: "SSH export is fresh",
      run(ctx) {
        const ageMs = ctx.asOfMs - ctx.collectedAtMs;
        const ptr = "$.collected_at";
        if (!Number.isFinite(ageMs) || ageMs < 0) {
          return finding(ctx, "SSH-005", "fleet-ssh", UNVERIFIED, ptr, ctx.collectedAt,
            "Re-collect: collection timestamp is not a valid past instant.", { freshness_ms: null });
        }
        if (ageMs > FRESHNESS_LIMIT_MS) {
          return finding(ctx, "SSH-005", "fleet-ssh", UNVERIFIED, ptr, ctx.collectedAt,
            "Stale export: re-collect within the freshness window before relying on these findings.", { freshness_ms: ageMs });
        }
        return finding(ctx, "SSH-005", "fleet-ssh", PASS, ptr, ctx.collectedAt,
          "None — export is within the freshness window.", { freshness_ms: ageMs });
      },
    },
    {
      id: "SSH-006",
      title: "SSH export digest field is well-formed",
      run(ctx) {
        const ptr = "$.source_digest";
        const ok = typeof ctx.sourceDigest === "string" && /^[0-9a-f]{64}$/.test(ctx.sourceDigest);
        return finding(ctx, "SSH-006", "fleet-ssh", ok ? PASS : FAIL, ptr, ctx.sourceDigest,
          ok ? "None — digest field is well-formed (integrity is enforced at admission)." : "Re-export with a valid SHA-256 source digest.");
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
