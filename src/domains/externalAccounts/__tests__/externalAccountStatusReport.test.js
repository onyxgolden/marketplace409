import { describe, expect, it } from "vitest";
import { buildSeedCandidates, buildSeedThreads } from "../externalAccountSeed";
import {
  buildExternalAccountStatusSection,
  diffExternalAccountsSincePriorReport,
  isStaleExternalAccount,
  renderExternalAccountStatusSectionText,
} from "../externalAccountStatusReport";

// Seed candidates use provider_name; DB rows use provider. The report
// endpoint maps the column name; the fixture does the same here.
function asDbRow(candidate, overrides = {}) {
  const { provider_name, provider_slug, ...rest } = candidate;
  return {
    id: `test-${provider_slug}`,
    provider: provider_name,
    ...rest,
    ...overrides,
  };
}

describe("external account status report", () => {
  it("counts, prioritizes follow-ups, and never leaks emails or locators", () => {
    const accounts = [
      asDbRow(
        { provider_name: "Blocked Co", provider_slug: "blocked-co", setup_status: "blocked", record_status: "confirmed_account", api_integration_status: "unknown", still_needed: true },
        { account_email: "someone@example.com", credential_location: "1Password → FORGE" },
      ),
      asDbRow(
        { provider_name: "Unfinished Co", provider_slug: "unfinished-co", setup_status: "in_progress", record_status: "unverified_lead", api_integration_status: "unknown", still_needed: null },
        { account_email: "other@example.com", credential_location: "Bitwarden vault" },
      ),
      asDbRow(
        { provider_name: "Needed Co", provider_slug: "needed-co", setup_status: "ready", record_status: "confirmed_account", api_integration_status: "not_integrated", still_needed: true },
        {},
      ),
    ];
    const section = buildExternalAccountStatusSection({
      accounts,
      threads: [],
      generatedAt: new Date("2026-11-18T10:00:00Z"),
    });
    expect(section.counts.total).toBe(3);
    expect(section.counts.setup_blocked).toBe(1);
    expect(section.counts.setup_in_progress).toBe(1);
    expect(section.counts.needed_but_not_integrated).toBe(1);
    expect(section.counts.unverified_lead).toBe(1);
    // Blocked first, then in-progress, then needed-not-integrated.
    expect(section.follow_ups.map((f) => f.priority)).toEqual([1, 2, 3]);
    expect(section.follow_ups[0].provider).toBe("Blocked Co");
    // No email or locator anywhere in the serialized section.
    const serialized = JSON.stringify(section);
    expect(serialized).not.toContain("someone@example.com");
    expect(serialized).not.toContain("other@example.com");
    expect(serialized).not.toContain("1Password");
    expect(serialized).not.toContain("Bitwarden");
    expect(serialized).not.toContain("credential_location");
    expect(serialized).not.toContain("account_email");
  });

  it("flags stale entries: in-progress/blocked never verified, or verified > 90 days ago", () => {
    const now = new Date("2026-11-18T10:00:00Z");
    expect(
      isStaleExternalAccount({ setup_status: "in_progress", last_verified_at: null }, now),
    ).toBe(true);
    expect(
      isStaleExternalAccount({ setup_status: "blocked", last_verified_at: null }, now),
    ).toBe(true);
    expect(
      isStaleExternalAccount(
        { setup_status: "ready", last_verified_at: "2026-08-01T00:00:00Z" },
        now,
      ),
    ).toBe(true);
    expect(
      isStaleExternalAccount(
        { setup_status: "ready", last_verified_at: "2026-11-01T00:00:00Z" },
        now,
      ),
    ).toBe(false);
    expect(
      isStaleExternalAccount({ setup_status: "ready", last_verified_at: null }, now),
    ).toBe(false);
  });

  it("diffs provider changes against a prior report", () => {
    const accounts = [
      asDbRow({ provider_name: "Alpha", provider_slug: "alpha", setup_status: "ready", record_status: "confirmed_account", api_integration_status: "integrated", still_needed: true }),
      asDbRow({ provider_name: "Beta", provider_slug: "beta", setup_status: "in_progress", record_status: "unverified_lead", api_integration_status: "unknown", still_needed: null }),
    ];
    const first = buildExternalAccountStatusSection({ accounts });
    const moved = accounts.map((a) =>
      a.provider === "Beta" ? { ...a, setup_status: "ready" } : a,
    );
    const changes = diffExternalAccountsSincePriorReport(moved, first);
    expect(changes).toContainEqual({
      provider: "Beta",
      change: "setup_status: in_progress → ready",
    });
    expect(diffExternalAccountsSincePriorReport(moved, null)).toEqual([]);
  });

  it("end-to-end: the seeded Radar fixture surfaces as open/not built", () => {
    const accounts = buildSeedCandidates().map((row) => asDbRow(row));
    const threads = buildSeedThreads().map((thread) => ({
      id: `thread-${thread.account_seed_key.split(":")[1]}`,
      account_provider: thread.account_seed_key,
      ...thread,
    }));
    const section = buildExternalAccountStatusSection({
      accounts,
      threads,
      generatedAt: new Date("2026-11-18T10:00:00Z"),
    });
    // Radar: 10 prospective sources, open pending thread.
    expect(section.radar.status).toBe("open_not_built");
    expect(section.radar.prospective_source_count).toBe(10);
    expect(section.radar.open_thread_count).toBeGreaterThanOrEqual(1);
    expect(section.radar.open_threads[0].title).toContain("Property Risk Radar");
    expect(section.radar.open_threads[0].next_action).toContain("R0");
    // The blocked Google Cloud trial is a top-priority follow-up.
    expect(
      section.follow_ups.find((f) => f.provider === "Google Cloud / Cloud Vision"),
    ).toMatchObject({ priority: 1, kind: "setup_blocked" });
    // The whole seeded register serializes with no invented email or locator.
    const serialized = JSON.stringify(section);
    expect(serialized).not.toContain("credential_location");
    expect(serialized).not.toContain("account_email");
    // Counts reconcile with the seed.
    expect(section.counts.total).toBe(139);
    expect(section.counts.setup_blocked).toBeGreaterThanOrEqual(1);
    expect(section.counts.stale).toBeGreaterThan(0);
  });

  it("reports not_seeded when Radar has no rows at all", () => {
    const section = buildExternalAccountStatusSection({ accounts: [], threads: [] });
    expect(section.radar.status).toBe("not_seeded");
    expect(section.counts.total).toBe(0);
    expect(section.follow_ups).toEqual([]);
  });

  it("renders plain text for the briefing: Radar, follow-ups, provenance, no leaks", () => {
    const accounts = [
      asDbRow(
        { provider_name: "Blocked Co", provider_slug: "blocked-co", setup_status: "blocked", record_status: "confirmed_account", api_integration_status: "unknown", still_needed: true },
        { account_email: "someone@example.com", credential_location: "1Password → FORGE" },
      ),
    ];
    const threads = [
      { id: "t-1", account_provider: "Windy", title: "Property Risk Radar — scope GO Oct 16, build not started", state: "open", next_action: "Jason's word needed to start R0 (source/rights records)" },
    ];
    const radarAccounts = buildSeedCandidates()
      .filter((c) => c.work_thread_label === "Property Risk Radar")
      .map((row) => asDbRow(row));
    const section = buildExternalAccountStatusSection({
      accounts: [...accounts, ...radarAccounts],
      threads,
      generatedAt: new Date("2026-11-18T10:00:00Z"),
    });
    const text = renderExternalAccountStatusSectionText(section, {
      queried_at: "2026-11-18T10:00:00.000Z",
      tracker_revision: "15fcb9cb3abc",
    });
    expect(text).toContain("External accounts and dependent work");
    expect(text).toContain("Provenance: register queried 2026-11-18T10:00:00.000Z · tracker revision 15fcb9cb3abc");
    expect(text).toContain("Property Risk Radar: open / not built");
    expect(text).toContain("[setup_blocked] Blocked Co");
    expect(text).not.toContain("someone@example.com");
    expect(text).not.toContain("1Password");
    expect(text).not.toContain("credential_location");
    expect(text).not.toContain("account_email");
  });

  it("renders the empty-register note instead of silently reporting zero", () => {
    const section = buildExternalAccountStatusSection({ accounts: [], threads: [] });
    const text = renderExternalAccountStatusSectionText(section, {
      queried_at: "2026-11-18T10:00:00.000Z",
      tracker_revision: "unknown",
    });
    expect(text).toContain("The register is empty");
    expect(text).toContain("not a statement that there are no external dependencies");
    expect(text).toContain("Property Risk Radar: not seeded");
  });
});
