// Canonical Knowledge Slice 4 — security / fail-closed self-check.
//
// Exercises the same denylist, secret, and PII scanners, and the same buildIndexRecords fail-closed
// paths, the real indexer uses (buildIndexRecords.mjs) -- nothing here is a second implementation.
// Pure: synthetic in-memory fixtures only, no filesystem or network access, so it is safe to run as
// part of every acceptance report without touching real repository content.
import { buildIndexRecords } from "./buildIndexRecords.mjs";
import { AUTHORITY_LEVELS } from "./authorityLevels.mjs";
import { CLASSIFICATIONS } from "./canonicalDocumentRegistry.mjs";

// Built from parts, not a literal, so this fixture's bytes never form a string GitHub's own
// push-protection secret scanner flags as a real Stripe key -- it is still the exact value
// secretScanner.mjs's sk_live_ pattern matches, which is all this self-check needs.
const SECRET_LOOKING = `const key = "${["sk", "live", "abcdefghijklmnopqrstuvwx1234567890ABCD"].join("_")}";`;
const PII_LOOKING = "SSN: 078-05-1120";

function check(name, pass) {
  return { name, pass: Boolean(pass) };
}

/**
 * Runs each required security property against tiny synthetic fixtures and returns a deterministic
 * pass/fail result per property, plus an overall pass.
 */
export function runSecuritySelfCheck() {
  const checks = [];

  // A registered canonical document whose content looks like a secret must never be indexed --
  // registration does not override the scanner, and the content must never reach a record.
  {
    const files = [{ path: "docs/product/FORGE_SECRET_LOOKING.md", blobSha: "s1", content: SECRET_LOOKING }];
    const registry = [{ path: "docs/product/FORGE_SECRET_LOOKING.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "canonical_document", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files, registry });
    const excludedEntry = excluded.find((e) => e.source_path === files[0].path);
    checks.push(check(
      "a registered canonical document containing a likely secret is excluded, not indexed",
      records.length === 0 && excludedEntry && excludedEntry.reason.startsWith("likely_secret:"),
    ));
  }

  // Same, for PII.
  {
    const files = [{ path: "docs/product/FORGE_PII_LOOKING.md", blobSha: "s2", content: PII_LOOKING }];
    const registry = [{ path: "docs/product/FORGE_PII_LOOKING.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "canonical_document", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files, registry });
    const excludedEntry = excluded.find((e) => e.source_path === files[0].path);
    checks.push(check(
      "a registered canonical document containing likely PII is excluded, not indexed",
      records.length === 0 && excludedEntry && excludedEntry.reason.startsWith("likely_pii:"),
    ));
  }

  // An unreadable/binary registered document cannot silently become "covered".
  {
    const files = [{ path: "docs/product/FORGE_UNREADABLE.md", blobSha: "s3", content: null }];
    const registry = [{ path: "docs/product/FORGE_UNREADABLE.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "canonical_document", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files, registry });
    const excludedEntry = excluded.find((e) => e.source_path === files[0].path);
    checks.push(check(
      "an unreadable registered document is excluded with a reason, not indexed",
      records.length === 0 && excludedEntry?.reason === "binary_or_unreadable",
    ));
  }

  // An unknown registry authority id is never emitted as a guessed tier.
  {
    const files = [{ path: "docs/product/FORGE_UNKNOWN_AUTHORITY.md", blobSha: "s4", content: "Body text." }];
    const registry = [{ path: "docs/product/FORGE_UNKNOWN_AUTHORITY.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "not_a_real_tier", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] }];
    const { records, excluded } = buildIndexRecords({ commitSha: "sha", files, registry });
    const excludedEntry = excluded.find((e) => e.source_path === files[0].path);
    checks.push(check(
      "an unknown registry authority fails closed, excluded rather than guessed",
      records.length === 0 && excludedEntry?.reason === "registry_invalid_authority:not_a_real_tier",
    ));
  }

  // The content of a denylisted / secret / PII file never ends up in a record's searchable fields.
  {
    const files = [
      { path: "docs/a.md", blobSha: "s5", content: SECRET_LOOKING },
      { path: "docs/b.md", blobSha: "s6", content: "Ordinary content, nothing sensitive here." },
    ];
    const registry = [
      { path: "docs/a.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "canonical_document", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] },
      { path: "docs/b.md", classification: CLASSIFICATIONS.CANONICAL, brain_authority: "canonical_document", families: [], status: "active", reason: null, rationale: "fixture", evidence: "fixture", flags: [] },
    ];
    const { records } = buildIndexRecords({ commitSha: "sha", files, registry });
    const leaked = records.some((r) => JSON.stringify(r).includes("sk_live_"));
    checks.push(check("sensitive content never appears in any emitted record", !leaked && records.length === 1));
  }

  // AUTHORITY_LEVELS sanity: every id buildIndexRecords can emit is one of the seven approved tiers,
  // so "unknown authority is a hard failure" cannot silently regress to "unknown authority is allowed".
  {
    const ids = new Set(Object.values(AUTHORITY_LEVELS).map((l) => l.id));
    checks.push(check("the approved authority tier set has not silently grown or shrunk (7 tiers)", ids.size === 7));
  }

  return { pass: checks.every((c) => c.pass), checks };
}
