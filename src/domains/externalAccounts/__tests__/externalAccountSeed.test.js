import { describe, expect, it } from "vitest";
import {
  EXTERNAL_ACCOUNT_SEED_VERSION,
  SEED_EXCLUSIONS,
  SEED_THREADS,
  buildSeedCandidates,
  buildSeedThreads,
} from "../externalAccountSeed";
import { validateExternalAccountPayload } from "../externalAccountValidation";

describe("external account seed", () => {
  it("is deterministic and sorted by seed_key", () => {
    const first = buildSeedCandidates();
    const second = buildSeedCandidates();
    expect(second).toEqual(first);
    const keys = first.map((row) => row.seed_key);
    expect([...keys].sort()).toEqual(keys);
  });

  it("has unique slugs and seed_keys, all versioned v1", () => {
    const rows = buildSeedCandidates();
    expect(rows.length).toBeGreaterThan(100);
    expect(new Set(rows.map((row) => row.seed_key)).size).toBe(rows.length);
    expect(new Set(rows.map((row) => row.provider_name)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.seed_key).toBe(`${EXTERNAL_ACCOUNT_SEED_VERSION}:${row.provider_slug}`);
      expect(row.source_kind).toBeDefined();
      expect(row.source_reference).toBeTruthy();
    }
  });

  it("asserts an email only for Gmail, and only where Gmail proves it", () => {
    const rows = buildSeedCandidates();
    for (const row of rows) {
      if (row.account_email) {
        expect(row.account_email).toBe("jasonmorgan99@gmail.com");
      }
    }
    // The cross-check's named identifications are present.
    const bySlug = new Map(rows.map((row) => [row.provider_slug, row]));
    expect(bySlug.get("namecheap").account_email).toBe("jasonmorgan99@gmail.com");
    expect(bySlug.get("resend").account_email).toBe("jasonmorgan99@gmail.com");
    expect(bySlug.get("google-cloud").setup_status).toBe("blocked");
    expect(bySlug.get("google-cloud").plan_status).toBe("trial");
    expect(bySlug.get("namecheap").setup_status).toBe("in_progress");
    expect(bySlug.get("resend").setup_status).toBe("in_progress");
    expect(bySlug.get("xai-grok").record_status).toBe("closed");
    expect(bySlug.get("xai-grok").still_needed).toBe(false);
  });

  it("never seeds a credential location or a secret-like value", () => {
    for (const row of buildSeedCandidates()) {
      expect(row.credential_location).toBeNull();
      const { ok, errors } = validateExternalAccountPayload(row);
      expect(ok).toBe(true);
      expect(errors).toEqual([]);
    }
  });

  it("seeds the Property Risk Radar fixture (10 prospects + pending thread)", () => {
    const rows = buildSeedCandidates();
    const radar = rows.filter((row) => row.work_thread_label === "Property Risk Radar");
    expect(radar).toHaveLength(10);
    for (const row of radar) {
      expect(row.record_status).toBe("evaluating_service");
      expect(row.api_integration_status).toBe("not_integrated");
      expect(row.setup_status).toBe("not_started");
    }
    const threads = buildSeedThreads();
    const radarThread = threads.find(
      (thread) => thread.account_seed_key === "external_accounts_seed_v1:windy",
    );
    expect(radarThread).toMatchObject({
      title: "Property Risk Radar — scope GO Oct 16, build not started",
      state: "open",
    });
    expect(threads.length).toBeGreaterThanOrEqual(9);
    // Every thread keys to a real candidate.
    const keys = new Set(rows.map((row) => row.seed_key));
    for (const thread of threads) {
      expect(keys.has(thread.account_seed_key)).toBe(true);
    }
  });

  it("records the MIT gap and the exclusions instead of inventing them", () => {
    expect(SEED_EXCLUSIONS.join("\n")).toContain("MIT-created apps");
    expect(SEED_EXCLUSIONS.join("\n")).toContain("ZERO hits");
    const rows = buildSeedCandidates();
    const mitLike = rows.filter((row) => /mit|app inventor|scratch|media lab/i.test(row.provider_name));
    expect(mitLike).toEqual([]);
  });

  it("keeps the unfinished-account threads the cross-check named", () => {
    const slugs = SEED_THREADS.map((thread) => thread.account_seed_key);
    for (const slug of [
      "namecheap",
      "google-cloud",
      "etrade",
      "venmo",
      "finelo",
      "vestwell",
    ]) {
      expect(slugs).toContain(`external_accounts_seed_v1:${slug}`);
    }
    expect(SEED_THREADS.find((t) => t.account_seed_key.endsWith(":google-cloud")).state).toBe(
      "blocked",
    );
  });
});
