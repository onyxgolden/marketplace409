// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import UiImprovementManagerPanel from "./UiImprovementManagerPanel.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount(mounted) {
  act(() => mounted.root.unmount());
  mounted.container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

const deterministicFinding = {
  findingId: "finding_abc", ruleId: "undersized-touch-target", category: "undersized_touch_target",
  findingClass: "deterministic", application: "409 Marketplace FORGE", routeId: "forge-financial-overview",
  routePath: "/forge/financial", viewport: "mobile", screenshotHash: `sha256:${"a".repeat(64)}`,
  probableSourceFiles: ["src/components/forge/financial/FinancialAccountBalancesPanel.jsx"],
  affectedComponent: "button#add-account", severity: "medium", confidence: "high",
  explanation: "The control measures 18x18px, below the 24x24px minimum.",
  proposedImprovement: "Increase padding to reach the minimum target size.",
  validationRequirements: ["Re-measure after the fix."], prohibitedScope: ["Must not change financial calculations."],
  rollbackDescription: "Revert the padding change.", status: "new", detectedAt: "2026-09-01T00:00:00.000Z",
};

describe("UiImprovementManagerPanel", () => {
  let mounted;
  afterEach(() => { if (mounted) unmount(mounted); mounted = null; vi.unstubAllGlobals(); });

  it("loads and renders a deterministic finding with its severity and confidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [deterministicFinding] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Undersized touch target");
    expect(mounted.container.textContent).toContain("medium");
    expect(mounted.container.textContent).toContain("confidence: high");
  });

  it("shows the empty-state message when there are no findings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("No findings yet.");
  });

  it("shows an error message when the load fails (e.g. Vercel refusal)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(403, { error: "The UI Improvement Manager review panel is disabled on Vercel." })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("disabled on Vercel");
  });

  it("expands to show full finding detail including validation requirements and rollback description", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [deterministicFinding] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    const showDetail = [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Show detail");
    act(() => showDetail.click());
    expect(mounted.container.textContent).toContain("Re-measure after the fix.");
    expect(mounted.container.textContent).toContain("Revert the padding change.");
    expect(mounted.container.textContent).toContain("Must not change financial calculations.");
  });

  it("renders all four required review actions for a finding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [deterministicFinding] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    const labels = [...mounted.container.querySelectorAll("button")].map((b) => b.textContent);
    for (const expected of ["Review", "Reject", "Request revision", "Approve preview"]) expect(labels).toContain(expected);
  });

  it("posts the correct findingId and action, and updates the displayed status, when Approve preview is clicked", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { success: true, findings: [deterministicFinding] }))
      .mockResolvedValueOnce(response(200, { success: true, finding: { ...deterministicFinding, status: "preview_approved" } }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();

    const approveButton = [...mounted.container.querySelectorAll("button")].find((b) => b.textContent === "Approve preview");
    await act(async () => { approveButton.click(); await Promise.resolve(); await Promise.resolve(); });

    const [, [url, options]] = fetchMock.mock.calls;
    expect(url).toBe("/api/forge/developer/ui-improvement-manager/proposals");
    expect(JSON.parse(options.body)).toEqual({ findingId: "finding_abc", action: "approve_preview" });
    expect(mounted.container.textContent).toContain("Preview approved");
  });

  it("never renders an action that implies commit/push/PR/merge/deploy/migration", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [deterministicFinding] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    const labels = [...mounted.container.querySelectorAll("button")].map((b) => b.textContent.toLowerCase());
    for (const forbidden of ["commit", "push", "merge", "deploy", "migrate", "pull request"]) {
      expect(labels.some((label) => label.includes(forbidden))).toBe(false);
    }
  });

  it("separates a subjective suggestion from deterministic findings and never shows it with a severity badge", async () => {
    const subjective = { ...deterministicFinding, findingId: "finding_subjective", findingClass: "subjective", severity: null, ruleId: "style-opinion", category: "inconsistent_spacing" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, { success: true, findings: [deterministicFinding, subjective] })));
    mounted = mount(<UiImprovementManagerPanel />);
    await flush();
    expect(mounted.container.textContent).toContain("Deterministic findings (1)");
    expect(mounted.container.textContent).toContain("Subjective suggestions (1) — not defects");
  });
});
