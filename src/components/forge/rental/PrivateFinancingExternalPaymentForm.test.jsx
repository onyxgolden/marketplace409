// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingExternalPaymentForm from "./PrivateFinancingExternalPaymentForm.jsx";

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
function setInput(input, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
function setSelect(select, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const components = [
  { componentKey: "primary", label: "Primary note" },
  { componentKey: "down", label: "Down-payment note" },
];
const previewPayload = {
  success: true,
  previewToken: "signed-token",
  duplicateCandidates: [],
  preview: {
    allocationBreakdown: {
      interestPaidByComponentCents: { primary: 1000 },
      principalPaidByComponentCents: { primary: 40_000, down: 10_785 },
      unallocatedCents: 0,
    },
    blockingValidation: [],
  },
};

describe("PrivateFinancingExternalPaymentForm", () => {
  let mounted;
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.unstubAllGlobals();
  });

  it("explains that the workflow records funds already received and does not move money", () => {
    const html = renderToStaticMarkup(
      <PrivateFinancingExternalPaymentForm accountId="a1" components={components} />,
    );
    expect(html).toContain("Record an external payment");
    expect(html).toContain("FORGE does not move money");
  });

  it("offers supported external methods and real account components", async () => {
    mounted = mount(<PrivateFinancingExternalPaymentForm accountId="a1" components={components} />);
    await act(async () => mounted.container.querySelector("button").click());
    const text = mounted.container.textContent;
    expect(text).toContain("Venmo");
    expect(text).toContain("Cash App");
    expect(text).toContain("Bank transfer / ACH");
    expect(text).toContain("Primary note");
    expect(text).toContain("Down-payment note");
  });

  it("previews before posting and sends integer cents plus provenance", async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, previewPayload));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingExternalPaymentForm accountId="a1" components={components} />);
    await act(async () => mounted.container.querySelector("button").click());
    await setInput(mounted.container.querySelector('input[type="number"]'), "517.85");
    await setSelect(mounted.container.querySelector("select"), "venmo");
    const textInputs = [...mounted.container.querySelectorAll('input[type="text"]')];
    await setInput(textInputs[0], "VENMO-123");

    await act(async () => {
      mounted.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("/api/private-financing/accounts/a1/payments/external/preview");
    expect(JSON.parse(options.body)).toMatchObject({
      amountCents: 51_785,
      paymentMethod: "venmo",
      sourceReference: "VENMO-123",
    });
    expect(mounted.container.textContent).toContain("Review payment allocation");
    expect(mounted.container.textContent).toContain("$517.85");
  });

  it("requires separate acknowledgement when possible duplicates exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, {
      ...previewPayload,
      duplicateCandidates: [{ id: "existing" }],
    })));
    mounted = mount(<PrivateFinancingExternalPaymentForm accountId="a1" components={components} />);
    await act(async () => mounted.container.querySelector("button").click());
    await setInput(mounted.container.querySelector('input[type="number"]'), "100");
    await setSelect(mounted.container.querySelector("select"), "cash");
    await setInput([...mounted.container.querySelectorAll('input[type="text"]')][0], "CASH-1");
    await act(async () => {
      mounted.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();
    expect(mounted.container.textContent).toContain("Possible duplicate payment found");
    const confirm = [...mounted.container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm and record"),
    );
    expect(confirm.disabled).toBe(true);
  });

  it("confirms with the signed token, renders a receipt, and refreshes authoritative state", async () => {
    const onPosted = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response(200, previewPayload))
      .mockResolvedValueOnce(response(200, {
        success: true,
        event: { id: "evt-2", amountCents: 51_785, paymentMethod: "venmo", ledgerSequence: 2 },
      }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(
      <PrivateFinancingExternalPaymentForm accountId="a1" components={components} onPosted={onPosted} />,
    );
    await act(async () => mounted.container.querySelector("button").click());
    await setInput(mounted.container.querySelector('input[type="number"]'), "517.85");
    await setSelect(mounted.container.querySelector("select"), "venmo");
    await setInput([...mounted.container.querySelectorAll('input[type="text"]')][0], "VENMO-123");
    await act(async () => {
      mounted.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    await flush();

    const checkboxes = [...mounted.container.querySelectorAll('input[type="checkbox"]')];
    await act(async () => checkboxes.at(-1).click());
    const confirm = [...mounted.container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm and record"),
    );
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      previewToken: "signed-token",
      amountCents: 51_785,
      paymentMethod: "venmo",
      sourceReference: "VENMO-123",
    });
    expect(mounted.container.textContent).toContain("Payment recorded");
    expect(mounted.container.textContent).toContain("ledger #2");
    expect(onPosted).toHaveBeenCalledOnce();
  });
});
