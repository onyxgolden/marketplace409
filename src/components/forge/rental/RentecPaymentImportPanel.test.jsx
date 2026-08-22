// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentecPaymentImportPanel from "./RentecPaymentImportPanel.jsx";

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
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
function setInputValue(input, value) {
  nativeInputValueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent.trim() === text);
  if (!button) throw new Error(`No button found with text "${text}"`);
  return button;
}
async function clickButtonAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
}

describe("RentecPaymentImportPanel (static markup)", () => {
  it("never writes anything before a preview is run, and states so explicitly", () => {
    const markup = renderToStaticMarkup(<RentecPaymentImportPanel />);
    expect(markup).toContain("Preview only");
    expect(markup).toContain("Preview Rentec payments");
    expect(markup).not.toContain("Approve");
  });
});

describe("RentecPaymentImportPanel interaction", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  const previewBody = {
    success: true, status: "preview_only", importBatchId: "rentec_import_batch_1", propertyId: "10",
    preview: {
      classificationCounts: { matched: 1, already_imported: 0, ambiguous: 0, unmatched: 0, ignored_non_rent: 0, conflict: 0 },
      items: [{ classification: "matched", transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1", amountCents: 150000, isPartial: false }],
    },
  };

  it("previews a property and shows the matched transaction with a default-checked selection", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => previewBody }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    const input = mounted.container.querySelector("input");
    await act(async () => { setInputValue(input, "10"); });
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    expect(mounted.container.textContent).toContain("txn_1");
    expect(mounted.container.textContent).toContain("Approve 1 matched payment");
    const checkbox = mounted.container.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
  });

  it("requires an explicit confirmation before approving — clicking Approve does not immediately call the API", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => previewBody }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    const input = mounted.container.querySelector("input");
    await act(async () => { setInputValue(input, "10"); });
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    const previewCalls = fetchMock.mock.calls.length;
    await act(async () => { findButtonByText(mounted.container, "Approve 1 matched payment").click(); });
    expect(mounted.container.textContent).toContain("Confirm: record 1 payment");
    expect(fetchMock.mock.calls.length).toBe(previewCalls);
  });

  it("calls the approve route with only the selected matched items after confirmation", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes("rentec-payment-import-preview")) return Promise.resolve({ ok: true, json: async () => previewBody });
      return Promise.resolve({ ok: true, json: async () => ({ success: true, importBatchId: "rentec_import_batch_1", results: [{ transactionId: "txn_1", status: "applied", importId: "import_1", paymentId: "payment_1", chargeId: "charge_1" }] }) });
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    const input = mounted.container.querySelector("input");
    await act(async () => { setInputValue(input, "10"); });
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    await act(async () => { findButtonByText(mounted.container, "Approve 1 matched payment").click(); });
    await clickButtonAndFlush(findButtonByText(mounted.container, "Confirm approval"));

    const approveCall = fetchMock.mock.calls.find(([url]) => String(url).includes("rentec-payment-import-approve"));
    expect(approveCall).toBeTruthy();
    const [, options] = approveCall;
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toEqual({ importBatchId: "rentec_import_batch_1", propertyId: "10", approvals: [{ transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1" }] });
    expect(mounted.container.textContent).toContain("applied");
  });

  it("cancelling the confirmation never calls the approve route", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => previewBody }));
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    const input = mounted.container.querySelector("input");
    await act(async () => { setInputValue(input, "10"); });
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    await act(async () => { findButtonByText(mounted.container, "Approve 1 matched payment").click(); });
    await act(async () => { findButtonByText(mounted.container, "Cancel").click(); });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("approve"))).toBe(true);
  });
});
