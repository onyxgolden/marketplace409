import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EFILE_APPROVAL_CHECKLIST,
  EFILE_GATE_MESSAGE,
  getEfilePartnerStatus,
  requestEfileSubmission,
} from "./efilePartner1099";

// R23 — the partner layer is a design-only stub under Jason's build-spend
// doctrine: no paid signups, no real filings, no network calls. These tests
// pin the gate closed.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("e-file partner stub gating", () => {
  it("always reports not connected", () => {
    const status = getEfilePartnerStatus();
    expect(status.connected).toBe(false);
    expect(status.provider).toBeNull();
    expect(status.message).toContain("not connected");
    expect(status.message).toContain("export and file manually");
  });

  it("refuses every submission with the gate message and makes no network call", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = requestEfileSubmission({ taxYear: 2026 });

    expect(result.ok).toBe(false);
    expect(result.submitted).toBe(false);
    expect(result.error).toBe(EFILE_GATE_MESSAGE);
    expect(result.error).toContain("per-filing cost");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("documents exactly what Jason must approve before e-filing goes live", () => {
    const checklistText = EFILE_APPROVAL_CHECKLIST.join(" ");
    expect(EFILE_APPROVAL_CHECKLIST.some((item) => item.includes("Per-filing cost"))).toBe(true);
    expect(checklistText).toContain("Secure Vault");
    expect(checklistText).toContain("CPA");
  });
});
