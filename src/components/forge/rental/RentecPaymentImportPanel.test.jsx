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
async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}
const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
function setSelectValue(select, value) {
  nativeSelectValueSetter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
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

const linkedProperties = [{ id: "unit_1", label: "1218 Wagner St" }];

function fetchRouter({ properties = linkedProperties, preview: previewBody, approve: approveBody } = {}) {
  return vi.fn((url) => {
    const href = String(url);
    if (href.includes("rentec-linked-properties")) return Promise.resolve({ ok: true, json: async () => ({ success: true, properties }) });
    if (href.includes("rentec-payment-import-preview")) return Promise.resolve({ ok: true, json: async () => previewBody });
    if (href.includes("rentec-payment-import-approve")) return Promise.resolve({ ok: true, json: async () => approveBody });
    throw new Error(`Unexpected fetch: ${href}`);
  });
}

describe("RentecPaymentImportPanel (static markup)", () => {
  it("never writes anything and never exposes an approval action before any data has loaded", () => {
    const markup = renderToStaticMarkup(<RentecPaymentImportPanel />);
    expect(markup).toContain("Preview only");
    expect(markup).toContain("Loading your Rentec-linked properties");
    expect(markup).not.toContain("Approve");
  });
});

describe("RentecPaymentImportPanel property picker", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  it("loads the owner's linked properties without ever calling Rentec — only the linked-properties list endpoint is hit before Preview is clicked", async () => {
    const fetchMock = fetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("rentec-linked-properties");
    expect(mounted.container.textContent).toContain("1218 Wagner St");
  });

  it("renders human-readable property labels, not raw provider ids", async () => {
    const fetchMock = fetchRouter({ properties: [{ id: "unit_1", label: "1218 Wagner St" }, { id: "unit_2", label: "4800 Kent Ave" }] });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    const options = Array.from(mounted.container.querySelectorAll("option")).map((option) => option.textContent);
    expect(options).toEqual(["Choose a property…", "1218 Wagner St", "4800 Kent Ave"]);
  });

  it("defaults to no selection, and the Preview button starts disabled", async () => {
    const fetchMock = fetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    const select = mounted.container.querySelector("select");
    expect(select.value).toBe("");
    expect(findButtonByText(mounted.container, "Preview Rentec payments").disabled).toBe(true);
  });

  it("shows a useful empty state pointing to Rentec Migration when no properties are linked, instead of a free-text field", async () => {
    const fetchMock = fetchRouter({ properties: [] });
    vi.stubGlobal("fetch", fetchMock);
    const onNavigate = vi.fn();
    mounted = mountPanel(<RentecPaymentImportPanel onNavigate={onNavigate} />);
    await flush();
    expect(mounted.container.textContent).toContain("No properties are linked to Rentec yet");
    expect(mounted.container.querySelector("select")).toBeNull();
    expect(mounted.container.querySelector('input[type="text"]')).toBeNull();
    await act(async () => { findButtonByText(mounted.container, "Go to Rentec Migration").click(); });
    expect(onNavigate).toHaveBeenCalledWith("rentec-migration");
  });

  it("never calls Rentec (the preview endpoint) before the landlord selects a property and clicks Preview", async () => {
    const fetchMock = fetchRouter();
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("rentec-payment-import-preview"))).toBe(false);
  });
});

describe("RentecPaymentImportPanel interaction", () => {
  let mounted;
  afterEach(() => {
    if (mounted) { unmountPanel(mounted); mounted = null; }
    vi.unstubAllGlobals();
  });

  const previewBody = {
    success: true, status: "preview_only", importBatchId: "rentec_import_batch_1",
    propertyId: "unit_1", rentecPropertyId: "10",
    preview: {
      classificationCounts: { matched: 1, already_imported: 0, ambiguous: 0, unmatched: 0, ignored_non_rent: 0, conflict: 0 },
      items: [{ classification: "matched", transactionId: "txn_1", leaseId: "lease_1", chargeId: "charge_1", amountCents: 150000, isPartial: false }],
    },
  };

  async function mountAndSelectProperty() {
    const fetchMock = fetchRouter({ preview: previewBody });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    const select = mounted.container.querySelector("select");
    await act(async () => { setSelectValue(select, "unit_1"); });
    return fetchMock;
  }

  it("previews the selected property and shows the matched transaction with a default-checked selection", async () => {
    await mountAndSelectProperty();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    expect(mounted.container.textContent).toContain("txn_1");
    expect(mounted.container.textContent).toContain("Approve 1 matched payment");
    const checkbox = mounted.container.querySelector('input[type="checkbox"]');
    expect(checkbox.checked).toBe(true);
  });

  it("sends the FORGE property id (not the raw Rentec id) to the preview endpoint", async () => {
    const fetchMock = await mountAndSelectProperty();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    const previewCall = fetchMock.mock.calls.find(([url]) => String(url).includes("rentec-payment-import-preview"));
    expect(JSON.parse(previewCall[1].body)).toEqual({ propertyId: "unit_1" });
  });

  it("requires an explicit confirmation before approving — clicking Approve does not immediately call the API", async () => {
    const fetchMock = await mountAndSelectProperty();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    const previewCalls = fetchMock.mock.calls.length;
    await act(async () => { findButtonByText(mounted.container, "Approve 1 matched payment").click(); });
    expect(mounted.container.textContent).toContain("Confirm: record 1 payment");
    expect(fetchMock.mock.calls.length).toBe(previewCalls);
  });

  it("calls the approve route using the server-resolved Rentec property id, not the FORGE property id and not anything the browser typed", async () => {
    const fetchMock = fetchRouter({
      preview: previewBody,
      approve: { success: true, importBatchId: "rentec_import_batch_1", results: [{ transactionId: "txn_1", status: "applied", importId: "import_1", paymentId: "payment_1", chargeId: "charge_1" }] },
    });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mountPanel(<RentecPaymentImportPanel />);
    await flush();
    const select = mounted.container.querySelector("select");
    await act(async () => { setSelectValue(select, "unit_1"); });
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
    const fetchMock = await mountAndSelectProperty();
    await clickButtonAndFlush(findButtonByText(mounted.container, "Preview Rentec payments"));
    await act(async () => { findButtonByText(mounted.container, "Approve 1 matched payment").click(); });
    await act(async () => { findButtonByText(mounted.container, "Cancel").click(); });
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("approve"))).toBe(true);
  });
});
