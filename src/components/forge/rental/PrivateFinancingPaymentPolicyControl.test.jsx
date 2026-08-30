// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingPaymentPolicyControl from "./PrivateFinancingPaymentPolicyControl.jsx";

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
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

describe("PrivateFinancingPaymentPolicyControl", () => {
  let mounted;
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.unstubAllGlobals();
  });

  it("shows the current rule and explains the external-payment separation", () => {
    const html = renderToStaticMarkup(
      <PrivateFinancingPaymentPolicyControl accountId="a1" currentPolicy="partial_allowed" />,
    );
    expect(html).toContain("Current rule: Partial payments allowed");
    expect(html).toContain("never prevents you from truthfully");
  });

  it("offers full-or-more and exact-only as distinct closed choices", async () => {
    mounted = mount(
      <PrivateFinancingPaymentPolicyControl accountId="a1" currentPolicy="partial_allowed" />,
    );
    await act(async () => mounted.container.querySelector("button").click());
    expect(mounted.container.textContent).toContain("Full amount or more required");
    expect(mounted.container.textContent).toContain("Exact amount only");
    expect(mounted.container.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });

  it("requires a changed rule, reason, and explicit acknowledgement", async () => {
    mounted = mount(
      <PrivateFinancingPaymentPolicyControl accountId="a1" currentPolicy="partial_allowed" />,
    );
    await act(async () => mounted.container.querySelector("button").click());
    const save = [...mounted.container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm rule change"),
    );
    expect(save.disabled).toBe(true);
    await act(async () => mounted.container.querySelector('input[value="full_amount_or_more"]').click());
    expect(save.disabled).toBe(true);
    await setInput(mounted.container.querySelector('input[type="text"]'), "Require full payment");
    expect(save.disabled).toBe(true);
    await act(async () => mounted.container.querySelector('input[type="checkbox"]').click());
    expect(save.disabled).toBe(false);
  });

  it("posts a prospective immutable policy version and refreshes account detail", async () => {
    const onChanged = vi.fn();
    const fetch = vi.fn().mockResolvedValue(
      response(200, {
        success: true,
        servicingPolicy: {
          version: 2,
          paymentAcceptancePolicy: "full_amount_or_more",
          effectiveAt: "2026-08-30T16:00:00Z",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    mounted = mount(
      <PrivateFinancingPaymentPolicyControl
        accountId="a1"
        currentPolicy="partial_allowed"
        onChanged={onChanged}
      />,
    );
    await act(async () => mounted.container.querySelector("button").click());
    await act(async () => mounted.container.querySelector('input[value="full_amount_or_more"]').click());
    await setInput(mounted.container.querySelector('input[type="text"]'), "Require full payment");
    await act(async () => mounted.container.querySelector('input[type="checkbox"]').click());
    const save = [...mounted.container.querySelectorAll("button")].find((button) =>
      button.textContent.includes("Confirm rule change"),
    );
    await act(async () => {
      save.click();
      await Promise.resolve();
    });
    await flush();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/private-financing/accounts/a1/servicing-policy");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      paymentAcceptancePolicy: "full_amount_or_more",
      reason: "Require full payment",
    });
    expect(mounted.container.textContent).toContain(
      "Payment rule changed to Full amount or more required",
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
