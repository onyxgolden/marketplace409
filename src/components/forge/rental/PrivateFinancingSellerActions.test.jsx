// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivateFinancingSellerActions from "./PrivateFinancingSellerActions.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => {
    root.unmount();
  });
  container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function clickAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function setInputAndFlush(input, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}
function setSelectAndFlush(select, value) {
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}
function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

const components = [
  { id: "pf_comp_1", componentKey: "ib", label: "Interest-bearing" },
  { id: "pf_comp_2", componentKey: "zi", label: "Zero-interest" },
];

const previewEnvelope = {
  principalByComponent: {
    ib: { before: 4_500_000, after: 4_499_000 },
    zi: { before: 1_000_000, after: 1_000_000 },
  },
  interestEffect: { accruedInterestBeforeCents: 5000, accruedInterestAfterCents: 5000 },
  pastDueEffect: null,
  payoffEffect: null,
  warnings: [],
  blockingValidation: [],
  proposedEventPayload: { eventType: "principal_correction" },
};

function stubFetchWithPreviewAndConfirm({ previewOverrides = {}, confirmOverrides = {} } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("/adjustments/preview")) {
      return jsonResponse(200, { success: true, preview: { ...previewEnvelope, ...previewOverrides }, previewToken: "token-abc" });
    }
    if (String(url).includes("/adjustments/confirm")) {
      return jsonResponse(200, {
        success: true,
        event: { id: "pf_evt_new", eventType: "principal_correction", ledgerSequence: 5, effectiveDate: "2026-08-29", recordedAt: "2026-08-29T00:00:00Z", amountCents: null, reason: "typo" },
        ...confirmOverrides,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  return { fetch, calls };
}

// Drives the contractual_principal_correction form to a valid, previewable state -- the simplest of the
// nine actions and NOT flagged high-impact, so it exercises the ordinary (non-strong-confirmation) path.
async function openAndFillContractualCorrection(container) {
  const openButton = container.querySelector('[data-guided-workflow-control="open-seller-action-contractual_principal_correction"]');
  await clickAndFlush(openButton);
  const componentSelect = container.querySelector("select");
  await setSelectAndFlush(componentSelect, "ib");
  const inputs = container.querySelectorAll("input");
  const deltaInput = [...inputs].find((el) => el.type === "number");
  await setInputAndFlush(deltaInput, "-10");
  const reasonInput = [...inputs].find((el) => el.type === "text");
  await setInputAndFlush(reasonInput, "typo fix");
}

describe("PrivateFinancingSellerActions", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
    vi.unstubAllGlobals();
  });

  it("renders a button for every supported action type, with no action open initially", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={() => {}} prefillReversalTarget={null} />);
    for (const label of [
      "Contractual principal correction", "Discretionary principal concession", "Bring-current / reporting credit",
      "Interest correction", "Interest waiver", "Stripe-fee reimbursement", "Compensating correction",
      "Payment reversal", "Account closure",
    ]) {
      expect(markup).toContain(label);
    }
    expect(markup).not.toContain("Preview</button>");
  });

  it("opens exactly one action at a time, and Cancel closes it without any fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-interest_waiver"]'));
    expect(mounted.container.textContent).toContain("Forgive some or all currently accrued interest");
    // Only one action panel is open -- the picker buttons are hidden while a form is open.
    expect(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-payment_reversal"]')).toBeFalsy();

    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="cancel-seller-action"]'));
    expect(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-interest_waiver"]')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not post on the initial form submission -- Preview is non-mutating and only calls the preview endpoint", async () => {
    const { fetch, calls } = stubFetchWithPreviewAndConfirm();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/adjustments/preview");
    expect(calls[0].init.method).toBe("POST");
    // No event has posted -- no receipt, no confirm call.
    expect(mounted.container.textContent).not.toContain("Posted:");
  });

  it("shows before/after balances and requires explicit acknowledgement before Confirm is enabled", async () => {
    const { fetch } = stubFetchWithPreviewAndConfirm();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));

    expect(mounted.container.textContent).toContain("$45,000.00"); // interestBearing.before
    expect(mounted.container.textContent).toContain("$44,990.00"); // interestBearing.after

    const confirmButton = mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]');
    expect(confirmButton.disabled).toBe(true);

    const ackCheckbox = mounted.container.querySelector('input[type="checkbox"]');
    await act(async () => {
      ackCheckbox.click();
      await Promise.resolve();
    });
    expect(confirmButton.disabled).toBe(false);
  });

  it("posts only after Confirm is clicked, refetches via onPosted, and shows a receipt naming the new event", async () => {
    const { fetch, calls } = stubFetchWithPreviewAndConfirm();
    vi.stubGlobal("fetch", fetch);
    const onPosted = vi.fn();
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={onPosted} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    await act(async () => {
      mounted.container.querySelector('input[type="checkbox"]').click();
      await Promise.resolve();
    });
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]'));

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("/adjustments/confirm");
    const confirmBody = JSON.parse(calls[1].init.body);
    expect(confirmBody.previewToken).toBe("token-abc");
    expect(onPosted).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toContain("Posted:");
    expect(mounted.container.textContent).toContain("pf_evt_new");
  });

  it("high-impact actions require typing CONFIRM in addition to the acknowledgement checkbox", async () => {
    const { fetch } = stubFetchWithPreviewAndConfirm();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-payment_reversal"]'));
    const inputs = mounted.container.querySelectorAll("input");
    const reversesInput = inputs[0];
    const reasonInput = inputs[1];
    await setInputAndFlush(reversesInput, "pf_evt_1");
    await setInputAndFlush(reasonInput, "bounced check");
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));

    const ackCheckbox = mounted.container.querySelector('input[type="checkbox"]');
    await act(async () => {
      ackCheckbox.click();
      await Promise.resolve();
    });
    const confirmButton = mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]');
    // Acknowledged but the CONFIRM phrase hasn't been typed yet -- still blocked for a high-impact action.
    expect(confirmButton.disabled).toBe(true);

    const strongConfirmInput = [...mounted.container.querySelectorAll("input")].find((el) => el.type === "text" && el !== reversesInput && el !== reasonInput);
    await setInputAndFlush(strongConfirmInput, "CONFIRM");
    expect(confirmButton.disabled).toBe(false);
  });

  it("does not require the CONFIRM phrase for an ordinary (non-high-impact) action", async () => {
    const { fetch } = stubFetchWithPreviewAndConfirm();
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    await act(async () => {
      mounted.container.querySelector('input[type="checkbox"]').click();
      await Promise.resolve();
    });
    expect(mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]').disabled).toBe(false);
  });

  it("displays warnings and blockers from the preview, and disables Confirm when blocked", async () => {
    const { fetch } = stubFetchWithPreviewAndConfirm({
      previewOverrides: { warnings: ["This is unusually large."], blockingValidation: ["Cannot reduce principal below zero."], proposedEventPayload: null },
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    expect(mounted.container.textContent).toContain("Cannot reduce principal below zero.");
    // Blocked previews never render the acknowledgement/confirm UI at all.
    expect(mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]')).toBeFalsy();
  });

  it("shows a safe error message and allows retrying the preview on failure", async () => {
    const fetch = vi.fn(async () => jsonResponse(400, { error: "This adjustment cannot be computed." }));
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    expect(mounted.container.textContent).toContain("This adjustment cannot be computed.");
    expect(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]')).toBeTruthy();
  });

  it("shows a safe error message when the confirm/post step fails, without losing the preview", async () => {
    const failingFetch = vi.fn(async (url, init) => {
      if (String(url).includes("/adjustments/preview")) return jsonResponse(200, { success: true, preview: previewEnvelope, previewToken: "token-abc" });
      if (String(url).includes("/adjustments/confirm")) return jsonResponse(409, { error: "This preview is stale. Please preview again." });
      throw new Error(`Unexpected fetch: ${url} ${init?.method}`);
    });
    vi.stubGlobal("fetch", failingFetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    await act(async () => {
      mounted.container.querySelector('input[type="checkbox"]').click();
      await Promise.resolve();
    });
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]'));
    expect(mounted.container.textContent).toContain("This preview is stale. Please preview again.");
    expect(mounted.container.textContent).not.toContain("Posted:");
  });

  it("prevents a double-submit by disabling Confirm while posting is in flight", async () => {
    let resolveConfirm;
    const fetch = vi.fn(async (url) => {
      if (String(url).includes("/adjustments/preview")) return jsonResponse(200, { success: true, preview: previewEnvelope, previewToken: "token-abc" });
      if (String(url).includes("/adjustments/confirm")) {
        return new Promise((resolve) => {
          resolveConfirm = () => resolve(jsonResponse(200, { success: true, event: { id: "pf_evt_new", eventType: "principal_correction", ledgerSequence: 5, effectiveDate: "2026-08-29", recordedAt: "x", amountCents: null, reason: null } }));
        });
      }
      throw new Error("unexpected");
    });
    vi.stubGlobal("fetch", fetch);
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await openAndFillContractualCorrection(mounted.container);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="preview-seller-action"]'));
    await act(async () => {
      mounted.container.querySelector('input[type="checkbox"]').click();
      await Promise.resolve();
    });
    const confirmButton = mounted.container.querySelector('[data-guided-workflow-control="confirm-seller-action"]');
    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });
    expect(confirmButton.disabled).toBe(true);
    const confirmCallCount = fetch.mock.calls.filter((call) => String(call[0]).includes("/adjustments/confirm")).length;
    expect(confirmCallCount).toBe(1);
    await act(async () => {
      resolveConfirm();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("prefills and opens the payment_reversal action when prefillReversalTarget is set (from the ledger's 'Reverse' button)", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={{ actionType: "payment_reversal", eventId: "pf_evt_target" }} />);
    expect(mounted.container.textContent).toContain("Payment reversal");
    const reversesInput = mounted.container.querySelector("input[type='text']");
    expect(reversesInput.value).toBe("pf_evt_target");
  });

  it("re-opens with a new prefill target even if the action type is the same as before", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={{ actionType: "payment_reversal", eventId: "pf_evt_a" }} />);
    await act(async () => {
      mounted.container.querySelector('[data-guided-workflow-control="cancel-seller-action"]').click();
      await Promise.resolve();
    });
    expect(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-payment_reversal"]')).toBeTruthy();

    act(() => {
      mounted.root.render(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={{ actionType: "payment_reversal", eventId: "pf_evt_b" }} />);
    });
    await flush();
    const reversesInput = mounted.container.querySelector("input[type='text']");
    expect(reversesInput.value).toBe("pf_evt_b");
  });

  it("distinguishes borrower-visible explanation fields from seller-only fields in the form", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-interest_waiver"]'));
    expect(mounted.container.textContent).toContain("Reason (seller record)");
    expect(mounted.container.textContent).toContain("Explanation shown to the borrower");
  });

  it("uses 'Seller' terminology by default (seller_financing, or no product supplied)", () => {
    const markup = renderToStaticMarkup(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={() => {}} prefillReversalTarget={null} />);
    expect(markup).toContain("Seller actions");
    const sellerFinancingMarkup = renderToStaticMarkup(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} product="seller_financing" onPosted={() => {}} prefillReversalTarget={null} />);
    expect(sellerFinancingMarkup).toContain("Seller actions");
  });

  it("uses 'Lender' terminology for a personal_loan account, never hard-coding 'Seller'", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} product="personal_loan" onPosted={vi.fn()} prefillReversalTarget={null} />);
    expect(mounted.container.textContent).toContain("Lender actions");
    expect(mounted.container.textContent).not.toContain("Seller");
    await clickAndFlush(mounted.container.querySelector('[data-guided-workflow-control="open-seller-action-discretionary_principal_concession"]'));
    expect(mounted.container.textContent).toContain("Reason (lender record)");
    expect(mounted.container.textContent).not.toContain("Seller");
  });

  it("is keyboard accessible: every action control is a real button or input reachable by tab order", async () => {
    vi.stubGlobal("fetch", vi.fn());
    mounted = mount(<PrivateFinancingSellerActions accountId="pf_acct_1" components={components} onPosted={vi.fn()} prefillReversalTarget={null} />);
    const buttons = mounted.container.querySelectorAll("button");
    for (const button of buttons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.hasAttribute("tabindex") && button.getAttribute("tabindex") === "-1").toBe(false);
    }
  });
});
