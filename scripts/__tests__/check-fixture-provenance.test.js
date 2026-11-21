// Fixture provenance guard (FORGE-P-20261120-CHATGPT-PUBLIC-FIXTURE-PROVENANCE).
//
// Every fixture below is wholly synthetic: invented names, invented
// balances, and identifier-shaped values that contain SYNTHETIC so they
// can never be mistaken for real production data. The point of the
// refusal tests is that the checker catches the SHAPE (a Stripe-shaped
// ID, a live-secret shape, a real-looking email) regardless of the
// field name it hides under — renamed fields must not evade the scan.
//
// Tests run the pure checker core over temp-dir files, plus one CLI
// spawn per exit-code class. Each refusal test asserts the specific
// finding code, not just "verdict is refuse", so a test that passed
// vacuously (checker refusing everything, or nothing) would fail.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFixtureFiles,
  computeDigest,
  isFixturePath,
  manifestPathFor,
} from "../check-fixture-provenance.mjs";

const FIXTURE = "accounts.fixture.json";

// GitHub push protection blocks literal secret-shaped strings in
// committed files, so the tests below build those values from fragments
// at runtime. The runtime strings are identical to the literals they
// replace — only the committed text is split, so the checker is still
// tested against the full secret shape.
const LIVE_KEY = "sk_live_" + "SYNTHETICFAKE" + "0".repeat(16);
const TEST_KEY = "sk_test_" + "SYNTHETICFAKEKEY" + "0".repeat(16);
const CHECKOUT_SESSION = "cs_live_" + "1SYNTHETICFAKE" + "0".repeat(10);
const PRIVATE_KEY_BLOCK =
  "-----BEGIN " + "RSA PRIVATE KEY-----\nSYNTHETICFAKE\n-----END " + "RSA PRIVATE KEY-----";

function writeCase(files) {
  const dir = mkdtempSync(join(tmpdir(), "fixture-provenance-"));
  const entries = [];
  const manifests = new Map();
  for (const [name, text] of Object.entries(files)) {
    const abs = join(dir, name);
    writeFileSync(abs, text);
    if (name.endsWith(".provenance.json")) {
      manifests.set(name, text);
    } else {
      entries.push({ path: name, text });
    }
  }
  return { dir, entries, manifests };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function manifestFor(fixtureText, overrides = {}) {
  return JSON.stringify({
    provenance: "synthetic",
    source: "hand-built synthetic values for this test",
    reviewed: "2026-11-21",
    digest: computeDigest(fixtureText),
    ...overrides,
  });
}

function syntheticAccountsFixture() {
  return JSON.stringify(
    {
      accounts: [
        {
          id: "SYN-01",
          name: "Synthetic Test Bank — Checking",
          balance_cents: 1234500,
          contact: "owner@example.com",
        },
        {
          id: "SYN-02",
          name: "Synthetic Test Bank — Savings",
          balance_cents: 9876500,
          contact: "owner@example.com",
        },
      ],
    },
    null,
    2,
  );
}

function checkOne(files) {
  const { dir, entries, manifests } = writeCase(files);
  try {
    const result = checkFixtureFiles(entries, manifests);
    expect(result.files).toHaveLength(1);
    return result.files[0];
  } finally {
    cleanup(dir);
  }
}

function codes(file) {
  return file.findings.map((f) => f.code);
}

describe("synthetic pass", () => {
  it("passes a synthetic fixture with a matching synthetic manifest", () => {
    const fixture = syntheticAccountsFixture();
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("pass");
    expect(file.findings).toHaveLength(0);
  });

  it("passes a test-mode Stripe key (sk_test_ is not live data)", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      stripe_test_key: TEST_KEY,
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("pass");
  });

  it("passes snake_case words that merely look like Stripe prefixes", () => {
    // sub_contractor / prod_environment / txn_reference must not trip
    // the live-ID scan — the 16+ random-char threshold exists for this.
    const fixture = JSON.stringify({
      id: "SYN-01",
      sub_contractor: "Synthetic Builders",
      prod_environment: "test",
      txn_reference: "SYN-REF-01",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("pass");
  });
});

describe("authorized-public-source pass", () => {
  it("passes public-source data (Risk Radar R0 pattern) with a live manifest", () => {
    // Public NWS/USGS-style readings: public place names, public
    // measurements, no identifiers, no emails, no private paths.
    const fixture = JSON.stringify(
      {
        source: "National Weather Service public feed",
        readings: [
          { station: "SYNTHETIC STATION", county: "Orange County", temp_f: 72 },
          { station: "SYNTHETIC STATION 2", county: "Jefferson County", temp_f: 68 },
        ],
      },
      null,
      2,
    );
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture, {
        provenance: "authorized-public-source-live",
        source: "National Weather Service public feed, accessed 2026-11-20",
      }),
    });
    expect(file.verdict).toBe("pass");
    expect(file.findings).toHaveLength(0);
  });
});

describe("private financial snapshot refusal", () => {
  // The PR #838 shape: invented bank names + exact balances + Stripe
  // Financial Connections account IDs. All values are invented; the
  // acct_/fca_ shapes are what the checker must catch.
  const privateSnapshot = JSON.stringify(
    {
      accounts: [
        {
          account_name: "Synthetic First Bank Checking",
          balance: 4821039,
          stripe_connection_id: "acct_1SYNTHETICFAKE0000000000",
          financial_connections_id: "fca_1SYNTHETICFAKE0000000000",
        },
      ],
    },
    null,
    2,
  );

  it("refuses a private-class manifest outright", () => {
    const file = checkOne({
      [FIXTURE]: privateSnapshot,
      [manifestPathFor(FIXTURE)]: manifestFor(privateSnapshot, {
        provenance: "private",
        source: "live export",
      }),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("private-provenance");
    expect(codes(file)).toContain("live-id-stripe");
  });

  it("refuses the same snapshot even when mislabeled synthetic", () => {
    // The class label must not save live-shaped IDs — the content scan
    // is the backstop.
    const file = checkOne({
      [FIXTURE]: privateSnapshot,
      [manifestPathFor(FIXTURE)]: manifestFor(privateSnapshot),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("live-id-stripe");
    expect(codes(file)).not.toContain("private-provenance");
  });
});

describe("renamed-ID evasion", () => {
  it("catches Stripe-shaped IDs under renamed and nested keys", () => {
    // Field names are never trusted: a_id, ref, x, and a nested value
    // must all be caught by value shape alone.
    const fixture = JSON.stringify({
      a_id: "acct_1SYNTHETICFAKE0000000000",
      ref: "fca_1SYNTHETICFAKE0000000000",
      x: CHECKOUT_SESSION,
      meta: { v: "acct_1SYNTHETICFAKE0000000001" },
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("live-id-stripe");
  });

  it("catches a live secret shape under an innocent key", () => {
    const fixture = JSON.stringify({ note: LIVE_KEY });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("secret-stripe-live");
  });
});

describe("secret and path hits", () => {
  it("refuses a private-key block", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      key: PRIVATE_KEY_BLOCK,
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("secret-private-key");
  });

  it("refuses private filesystem paths", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      local_path: "/Users/jason/marketplace409/data.csv",
      other_path: "C:\\Users\\jason\\Documents\\export.csv",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("private-path");
  });

  it("refuses a non-allowlisted email address", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      contact: "owner@invented-domain-4f8a2c.com",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("live-email");
  });
});

describe("malformed and missing provenance refusal", () => {
  it("refuses a fixture with no manifest at all", () => {
    const file = checkOne({ [FIXTURE]: syntheticAccountsFixture() });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("missing-provenance");
  });

  it("refuses a manifest that is not valid JSON", () => {
    const file = checkOne({
      [FIXTURE]: syntheticAccountsFixture(),
      [manifestPathFor(FIXTURE)]: "{not json",
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("malformed-provenance");
  });

  it("refuses a manifest missing the digest", () => {
    const fixture = syntheticAccountsFixture();
    const manifest = JSON.parse(manifestFor(fixture));
    delete manifest.digest;
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: JSON.stringify(manifest),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("malformed-provenance");
  });

  it("refuses a manifest whose digest does not match the fixture", () => {
    // One byte changes after the manifest was written: the manifest no
    // longer describes this file.
    const fixture = syntheticAccountsFixture();
    const changed = fixture.replace("1234500", "1234501");
    const file = checkOne({
      [FIXTURE]: changed,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("digest-mismatch");
  });

  it("refuses a manifest with an unknown provenance class", () => {
    const fixture = syntheticAccountsFixture();
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture, { provenance: "public" }),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("malformed-provenance");
  });

  it("refuses a manifest carrying a live identifier itself", () => {
    // The manifest carries class/source/date/digest ONLY.
    const fixture = syntheticAccountsFixture();
    const manifest = JSON.parse(manifestFor(fixture));
    manifest.source = "exported for acct_1SYNTHETICFAKE0000000000";
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: JSON.stringify(manifest),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("live-id-stripe");
  });
});

describe("closed sidecar schema", () => {
  it("refuses a manifest with extra benign-looking personal/financial fields", () => {
    // The sidecar carries class/source/date/digest ONLY. A real-looking
    // name plus a numeric balance in extra fields is live-shaped data
    // hiding in the manifest — the person-money heuristic runs on the
    // fixture text, not the manifest, so only the closed key set
    // catches it.
    const fixture = syntheticAccountsFixture();
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture, {
        owner_name: "Jordan Meyer",
        balance_cents: 4821039,
      }),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("unexpected-manifest-field");
  });

  it("refuses a manifest with extra identifier fields, even innocuous ones", () => {
    // SYN- values and allowlisted-domain emails pass every content
    // scan — the closed schema is the only thing that refuses them.
    const fixture = syntheticAccountsFixture();
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture, {
        internal_ref: "SYN-42",
        operator_email: "operator@example.com",
      }),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("unexpected-manifest-field");
  });

  it("refuses a manifest with an extra field carrying a secret-shaped value", () => {
    // The secret scan would catch the value on its own, but the
    // closed-schema finding must also fire: the field itself is not
    // part of the sidecar contract.
    const fixture = syntheticAccountsFixture();
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture, {
        backup_key: LIVE_KEY,
      }),
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("unexpected-manifest-field");
    expect(codes(file)).toContain("secret-stripe-live");
  });

  it("refuses a manifest that repeats a field", () => {
    // JSON.parse silently keeps the last duplicate, so the raw text
    // must be checked at the parse boundary.
    const fixture = syntheticAccountsFixture();
    const manifestText = `{"provenance":"synthetic","source":"first","source":"second","reviewed":"2026-11-21","digest":"${computeDigest(fixture)}"}`;
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestText,
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("duplicate-manifest-field");
  });

  it("refuses a manifest that repeats a field through an escaped key", () => {
    // JSON permits escaped characters inside object keys: "source" and
    // "sour\u0063e" are the same property after parsing, and JSON.parse
    // keeps only the last value — so the raw scanner must decode keys
    // before comparing, or the repeat is invisible. The overwritten
    // first value differs from the second, so the repeat also hides a
    // different value.
    const fixture = syntheticAccountsFixture();
    const manifestText = `{"provenance":"synthetic","source":"first-value","sour\\u0063e":"second-value","reviewed":"2026-11-21","digest":"${computeDigest(fixture)}"}`;
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestText,
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("duplicate-manifest-field");
  });

  it("refuses an escaped duplicate key regardless of order", () => {
    // Same repeat with the escaped spelling first: decoding must catch
    // it either way.
    const fixture = syntheticAccountsFixture();
    const manifestText = `{"provenance":"synthetic","sour\\u0063e":"first-value","source":"second-value","reviewed":"2026-11-21","digest":"${computeDigest(fixture)}"}`;
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestText,
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("duplicate-manifest-field");
  });

  it("does not treat a literal-backslash key as a duplicate of its plain spelling", () => {
    // "sour\\u0063e" in the raw JSON decodes to the literal key
    // sour\u0063e (backslash + u0063), which is NOT "source" — so no
    // duplicate finding. The key is still refused as an unexpected
    // field by the closed schema; this test pins the decoder against
    // over-collapsing.
    const fixture = syntheticAccountsFixture();
    const manifestText = `{"provenance":"synthetic","source":"only-value","sour\\\\u0063e":"other-value","reviewed":"2026-11-21","digest":"${computeDigest(fixture)}"}`;
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestText,
    });
    expect(file.verdict).toBe("refuse");
    expect(codes(file)).toContain("unexpected-manifest-field");
    expect(codes(file)).not.toContain("duplicate-manifest-field");
  });
});

describe("UNKNOWN rather than inferring safety", () => {
  it("reports UNKNOWN for a bare UUID", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      owner_id: "11111111-2222-3333-4444-555555555555",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("unknown");
    expect(codes(file)).toContain("unknown-uuid");
  });

  it("reports UNKNOWN for a production-shaped hex-suffixed forge ID", () => {
    const fixture = JSON.stringify({
      // Invented hex suffix — same shape as a production row ID, but
      // no real production value appears anywhere in this file.
      id: "forge_project_0123456789abcdef0123456789abcdef",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("unknown");
    expect(codes(file)).toContain("unknown-forge-id");
  });

  it("reports UNKNOWN for a real-looking name paired with money in a synthetic fixture", () => {
    const fixture = JSON.stringify({
      accounts: [{ owner_name: "Jordan Meyer", balance: 4821039 }],
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("unknown");
    expect(codes(file)).toContain("unknown-person-money-mapping");
  });

  it("reports UNKNOWN for a JWT-shaped value", () => {
    const fixture = JSON.stringify({
      id: "SYN-01",
      token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SYNTHETICFAKESIGNATURE",
    });
    const file = checkOne({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(file.verdict).toBe("unknown");
    expect(codes(file)).toContain("unknown-jwt");
  });
});

describe("changed-tree-only scope", () => {
  it("passes when no fixture artifacts are in the changed set", () => {
    const result = checkFixtureFiles([], new Map());
    expect(result.verdict).toBe("pass");
    expect(result.files).toHaveLength(0);
  });

  it("does not scan source code — a secret-shaped string in a .js file is out of scope", () => {
    // The checker core only receives in-scope entries; the CLI's scope
    // predicate is what keeps code out. This test pins that predicate.
    expect(isFixturePath("src/app/forge/work/page.jsx")).toBe(false);
    expect(isFixturePath("src/app/forge/work/page.test.jsx")).toBe(false);
    expect(isFixturePath("scripts/check-fixture-provenance.mjs")).toBe(false);
    expect(isFixturePath("scripts/__tests__/fixtures/a.fixture.json")).toBe(true);
    expect(isFixturePath("data/phone-layout-geometry-baseline.json")).toBe(true);
    expect(isFixturePath("reports/risk-radar.snapshot.json")).toBe(true);
    expect(isFixturePath("notes.md")).toBe(false);
  });
});

describe("CLI exit codes", () => {
  // `only` restricts which written files are passed to --files, so a
  // test can pass a manifest alone while its paired fixture sits
  // unchanged on disk — the manifest-only path the P1 targets.
  function runCli(files, only = null) {
    const { dir } = writeCase(files);
    try {
      const out = execFileSync(
        "node",
        [
          new URL("../check-fixture-provenance.mjs", import.meta.url).pathname,
          "--files",
          ...(only ?? Object.keys(files)).map((f) => join(dir, f)),
          "--root",
          dir,
        ],
        { encoding: "utf8" },
      );
      return { code: 0, out };
    } catch (error) {
      return { code: error.status, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    } finally {
      cleanup(dir);
    }
  }

  it("exits 0 on a passing fixture", () => {
    const fixture = syntheticAccountsFixture();
    const { code, out } = runCli({
      [FIXTURE]: fixture,
      [manifestPathFor(FIXTURE)]: manifestFor(fixture),
    });
    expect(code).toBe(0);
    expect(out).toContain("PASS");
  });

  it("exits 1 on a refused fixture", () => {
    const { code, out } = runCli({ [FIXTURE]: syntheticAccountsFixture() });
    expect(code).toBe(1);
    expect(out).toContain("REFUSE");
    expect(out).toContain("missing-provenance");
  });

  it("exits 0 with no in-scope files", () => {
    const { code, out } = runCli({ "notes.md": "# hello\n" });
    expect(code).toBe(0);
    expect(out).toContain("no fixture/report artifacts");
  });

  it("checks the paired fixture on a manifest-only valid update", () => {
    // Only the manifest is passed; the fixture is unchanged on disk.
    // The run must actually validate the pair (fixture path in the
    // output), not print the empty-tree PASS.
    const fixture = syntheticAccountsFixture();
    const manifest = manifestPathFor(FIXTURE);
    const { code, out } = runCli(
      { [FIXTURE]: fixture, [manifest]: manifestFor(fixture) },
      [manifest],
    );
    expect(code).toBe(0);
    expect(out).toContain(FIXTURE);
    expect(out).not.toContain("no fixture/report artifacts");
  });

  it("refuses a manifest-only update whose digest no longer matches", () => {
    const fixture = syntheticAccountsFixture();
    const changed = fixture.replace("1234500", "1234501");
    const manifest = manifestPathFor(FIXTURE);
    const { code, out } = runCli(
      { [FIXTURE]: changed, [manifest]: manifestFor(fixture) },
      [manifest],
    );
    expect(code).toBe(1);
    expect(out).toContain("digest-mismatch");
  });

  it("refuses a manifest-only update with unsafe manifest content", () => {
    // A live-shaped Financial Connections ID smuggled into the
    // manifest's source field must be refused even though the fixture
    // itself never changed.
    const fixture = syntheticAccountsFixture();
    const manifest = manifestPathFor(FIXTURE);
    const fcaId = "fca_" + "1SYNTHETICFAKE" + "0".repeat(10);
    const { code, out } = runCli(
      {
        [FIXTURE]: fixture,
        [manifest]: manifestFor(fixture, { source: `exported for ${fcaId}` }),
      },
      [manifest],
    );
    expect(code).toBe(1);
    expect(out).toContain("live-id-stripe");
  });

  it("refuses a manifest with no paired fixture", () => {
    // The manifest names a fixture that does not exist on disk: a
    // sidecar must accompany exactly one fixture, never nothing.
    const fixture = syntheticAccountsFixture();
    const manifest = manifestPathFor(FIXTURE);
    const { code, out } = runCli({ [manifest]: manifestFor(fixture) }, [manifest]);
    expect(code).toBe(1);
    expect(out).toContain("missing-fixture-for-manifest");
  });

  it("reports UNKNOWN for a manifest with an ambiguous pair", () => {
    // Two files pair with the same manifest stem, so the checker
    // cannot tell which fixture the manifest covers.
    const manifest = "data.fixture.provenance.json";
    const fixture = syntheticAccountsFixture();
    const { code, out } = runCli(
      {
        "data.fixture.json": fixture,
        "data.fixture.csv": "id,name\nSYN-01,Synthetic Test Bank\n",
        [manifest]: manifestFor(fixture),
      },
      [manifest],
    );
    expect(code).toBe(1);
    expect(out).toContain("ambiguous-manifest-pair");
  });
});
