// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentecFinancialHistoryImportPanel from "./RentecFinancialHistoryImportPanel.jsx";

function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmountPanel({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent.trim() === text);
  if (!button) throw new Error(`No button found with text "${text}". Buttons: ${Array.from(container.querySelectorAll("button")).map((b) => JSON.stringify(b.textContent.trim())).join(", ")}`);
  return button;
}
async function clickButtonAndFlush(button) {
  await act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function previewBody({ eligibleByYear = [], heldBackCommissions = { count: 0, amountCents: 0 } } = {}) {
  return {
    success: true, status: "preview_only",
    preview: { classificationCounts: { alreadyRepresented: 4128, safeMissing: 1290, ambiguous: 0, conflict: 63, unsupported: 199 } },
    batchPlan: { eligibleByYear, heldBackCommissions },
  };
}

function fetchRouter({ preview, approve } = {}) {
  return vi.fn((url) => {
    const href = String(url);
    if (href.includes("rentec-financial-history-import-preview")) return Promise.resolve({ ok: true, json: async () => preview });
    if (href.includes("rentec-financial-history-import-approve")) return Promise.resolve({ ok: true, json: async () => approve });
    throw new Error(`Unexpected fetch: ${href}`);
  });
}

describe("RentecFinancialHistoryImportPanel (static markup)", () => {
  it("never calls Rentec and never shows an approval action before any preview has run", () => {
    const markup = renderToStaticMarkup(<RentecFinancialHistoryImportPanel />);
    expect(markup).toContain("Preview only");
    expect(markup).not.toContain("Approve");
    expect(markup).not.toContain("Confirm");
  });
});

describe("RentecFinancialHistoryImportPanel preview", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("never calls the preview endpoint before the button is clicked", async () => {
    const fetchMock = fetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the yearly batch plan with counts and dollar totals after running the preview", async () => {
    const fetchMock = fetchRouter({
      preview: previewBody({ eligibleByYear: [
        { year: "2019", count: 23, incomeCents: 94832, expenseCents: 51200, otherCents: 0, sourceRecordIds: ["1:none", "2:none"] },
        { year: "2020", count: 5, incomeCents: 12000, expenseCents: 3400, otherCents: 0, sourceRecordIds: ["3:none"] },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(mounted.container.textContent).toContain("2019");
    expect(mounted.container.textContent).toContain("$948.32");
    expect(mounted.container.textContent).toContain("2020");
    expect(mounted.container.textContent).toContain("$120.00");
  });

  it("shows classification counts as aggregate numbers only", async () => {
    const fetchMock = fetchRouter({ preview: previewBody() });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(mounted.container.textContent).toContain("4128");
    expect(mounted.container.textContent).toContain("1290");
  });

  it("shows a note about held-back Commissions rows without exposing any per-row detail", async () => {
    const fetchMock = fetchRouter({ preview: previewBody({ heldBackCommissions: { count: 20, amountCents: 76673019 } }) });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(mounted.container.textContent).toContain("20 rows");
    expect(mounted.container.textContent).toContain("$766,730.19");
    expect(mounted.container.textContent).toContain("held back for manual review");
  });

  it("never renders a raw sourceRecordId, transaction id, or category name anywhere on the page", async () => {
    const fetchMock = fetchRouter({
      preview: previewBody({ eligibleByYear: [{ year: "2021", count: 1, incomeCents: 1000, expenseCents: 0, otherCents: 0, sourceRecordIds: ["123456789:none"] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(mounted.container.textContent).not.toContain("123456789");
    expect(mounted.container.innerHTML).not.toContain("123456789");
  });

  it("only enables the Approve button for the oldest pending year", async () => {
    const fetchMock = fetchRouter({
      preview: previewBody({ eligibleByYear: [
        { year: "2019", count: 1, incomeCents: 100, expenseCents: 0, otherCents: 0, sourceRecordIds: ["1:none"] },
        { year: "2020", count: 1, incomeCents: 100, expenseCents: 0, otherCents: 0, sourceRecordIds: ["2:none"] },
      ] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(findButtonByText(mounted.container, "Approve 2019").disabled).toBe(false);
    expect(findButtonByText(mounted.container, "Approve 2020").disabled).toBe(true);
  });
});

describe("RentecFinancialHistoryImportPanel approval flow", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  const singleYearPreview = previewBody({ eligibleByYear: [{ year: "2019", count: 2, incomeCents: 100000, expenseCents: 20000, otherCents: 0, sourceRecordIds: ["1:none", "2:none"] }] });

  it("requires an explicit confirmation before approving — clicking Approve does not immediately call the API", async () => {
    const fetchMock = fetchRouter({ preview: singleYearPreview });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    const callsBefore = fetchMock.mock.calls.length;
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    expect(mounted.container.textContent).toContain("Confirm: import 2 rows for 2019");
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it("cancelling the confirmation never calls the approve route", async () => {
    const fetchMock = fetchRouter({ preview: singleYearPreview });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Cancel"));
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("approve"))).toBe(true);
  });

  it("sends exactly that year's sourceRecordIds to the approve route on confirmation", async () => {
    const fetchMock = fetchRouter({
      preview: singleYearPreview,
      approve: { success: true, importBatchId: "batch_1", requestedCount: 2, insertedCount: 2, skippedCount: 0, rejected: [], incomeCents: 100000, expenseCents: 20000 },
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm approval"));

    const approveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("rentec-financial-history-import-approve"));
    expect(approveCall).toBeTruthy();
    const sentBody = JSON.parse(approveCall[1].body);
    expect(sentBody.sourceRecordIds).toEqual(["1:none", "2:none"]);
    expect(sentBody.importBatchId).toBeTruthy();
  });

  // Regression: the panel used to auto-refresh the preview right after a successful approval —
  // a second full-account Rentec fetch fired back-to-back with the one the approval itself already
  // did, which could hit Rentec's own rate limit and leave the page showing stale "Ready" status
  // even though the approval had genuinely succeeded. "Done" must reflect the approval response
  // alone, never a follow-up preview call.
  it("shows Done immediately from the approval response alone, without any follow-up preview fetch", async () => {
    const fetchMock = fetchRouter({
      preview: singleYearPreview,
      approve: { success: true, importBatchId: "batch_1", requestedCount: 2, insertedCount: 2, skippedCount: 0, rejected: [], incomeCents: 100000, expenseCents: 20000 },
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    const previewCallsBefore = fetchMock.mock.calls.filter(([url]) => String(url).includes("preview")).length;
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm approval"));
    const previewCallsAfter = fetchMock.mock.calls.filter(([url]) => String(url).includes("preview")).length;
    expect(previewCallsAfter).toBe(previewCallsBefore);
    expect(mounted.container.textContent).toContain("Done — 2 imported");
    expect(mounted.container.querySelector("button")?.textContent).not.toBe("Approve 2019");
  });

  it("unlocks the next year using only the approval response, even if the batch plan is never refreshed", async () => {
    const fetchMock = fetchRouter({
      preview: previewBody({ eligibleByYear: [
        { year: "2019", count: 2, incomeCents: 100000, expenseCents: 20000, otherCents: 0, sourceRecordIds: ["1:none", "2:none"] },
        { year: "2020", count: 1, incomeCents: 5000, expenseCents: 0, otherCents: 0, sourceRecordIds: ["3:none"] },
      ] }),
      approve: { success: true, importBatchId: "batch_1", requestedCount: 2, insertedCount: 2, skippedCount: 0, rejected: [], incomeCents: 100000, expenseCents: 20000 },
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm approval"));
    expect(findButtonByText(mounted.container, "Approve 2020").disabled).toBe(false);
  });

  it("surfaces a server-side rejection (e.g. a row that became unsafe between preview and approval) without crashing", async () => {
    const fetchMock = fetchRouter({
      preview: singleYearPreview,
      approve: { success: true, importBatchId: "batch_1", requestedCount: 2, insertedCount: 1, skippedCount: 0, rejected: [{ sourceRecordId: "2:none", reason: "This row is now classified as \"conflict\"." }], incomeCents: 100000, expenseCents: 0 },
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Approve 2019"));
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm approval"));
    expect(mounted.container.textContent).not.toContain("undefined");
    expect(mounted.container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an error message if the preview request fails, without throwing", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({ error: "Rentec API request failed with HTTP 500." }) }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecFinancialHistoryImportPanel />);
    await flush();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Run preview"));
    expect(mounted.container.textContent).toContain("Rentec API request failed with HTTP 500.");
  });
});
