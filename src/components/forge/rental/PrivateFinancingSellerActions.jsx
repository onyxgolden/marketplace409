"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { ADJUSTMENT_ACTION_TYPES, HIGH_IMPACT_ACTION_TYPES } from "@/domains/private-financing/adjustmentActionRegistry";
import { financingPartyLabel } from "@/domains/private-financing/financingPartyLabel";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const centsToMoney = (cents) => (typeof cents === "number" ? money.format(cents / 100) : "—");
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600";
const STRONG_CONFIRM_PHRASE = "CONFIRM";

const CLOSURE_REASON_OPTIONS = [
  { value: "paid_in_full", label: "Paid in full" },
  { value: "written_off", label: "Written off" },
  { value: "cancelled", label: "Cancelled" },
];

// One entry per action type in ADJUSTMENT_ACTION_TYPES, driving both the form fields shown and the
// inputs payload sent to the preview/confirm endpoints. field.type controls both the input rendered and
// the dollars->cents (or forced-negative-cents) conversion applied on submit -- see toInputsPayload.
// Built as a function of `partyLabel` ("Seller" for seller_financing, "Lender" for personal_loan --
// see financingPartyLabel.js) AND `componentOptions` (the account's own real, ordered component list --
// never a fixed interest_bearing/zero_interest pair) rather than fixed module-level constants, since
// several field labels/descriptions name the platform-side party, and every componentId field must offer
// exactly this account's own components, never a hard-coded pair or an option the account doesn't have.
function buildActionConfigs(partyLabel, componentOptions) {
  return {
    [ADJUSTMENT_ACTION_TYPES.CONTRACTUAL_PRINCIPAL_CORRECTION]: {
      label: "Contractual principal correction",
      description: "Correct an administrative or data-entry error in a component's principal balance.",
      fields: [
        { name: "componentId", label: "Component", type: "select", options: componentOptions, required: true },
        { name: "deltaCents", label: "Correction amount ($, negative reduces principal)", type: "signedMoney", required: true },
        { name: "reason", label: "Reason", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.DISCRETIONARY_PRINCIPAL_CONCESSION]: {
      label: "Discretionary principal concession",
      description: `Grant a ${partyLabel.toLowerCase()}-chosen reduction in principal as a goodwill concession.`,
      fields: [
        { name: "componentId", label: "Component", type: "select", options: componentOptions, required: true },
        { name: "deltaCents", label: "Amount to forgive ($)", type: "negativeMoney", required: true },
        { name: "reason", label: `Reason (${partyLabel.toLowerCase()} record)`, type: "text", required: true },
        { name: "borrowerVisibleExplanation", label: "Explanation shown to the borrower", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.BRING_CURRENT_CREDIT]: {
      label: "Bring-current / reporting credit",
      description:
        "Apply the exact calculated shortage using this account's allocation policy. The credit amount is never seller-entered.",
      fields: [
        { name: "componentId", label: "Extra-credit component (only used when this account policy requires a selection)", type: "select", options: componentOptions, required: false },
        { name: "reason", label: `Reason (${partyLabel.toLowerCase()} record)`, type: "text", required: true },
        { name: "borrowerVisibleExplanation", label: "Explanation shown to the borrower", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.INTEREST_CORRECTION]: {
      label: "Interest correction",
      description: "Correct an administrative error in accrued interest on a specific component.",
      fields: [
        { name: "componentId", label: "Component", type: "select", options: componentOptions, required: true },
        { name: "deltaCents", label: "Correction amount ($, negative reduces accrued interest)", type: "signedMoney", required: true },
        { name: "reason", label: "Reason", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.INTEREST_WAIVER]: {
      label: "Interest waiver",
      description: "Forgive some or all currently accrued interest on a specific component as a goodwill waiver.",
      fields: [
        { name: "componentId", label: "Component", type: "select", options: componentOptions, required: true },
        { name: "deltaCents", label: "Amount to forgive ($)", type: "negativeMoney", required: true },
        { name: "reason", label: `Reason (${partyLabel.toLowerCase()} record)`, type: "text", required: true },
        { name: "borrowerVisibleExplanation", label: "Explanation shown to the borrower", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.STRIPE_FEE_REIMBURSEMENT]: {
      label: "Stripe-fee reimbursement",
      description: `Record a processor fee the ${partyLabel.toLowerCase()} absorbed. By default this is tracked separately and never touches the loan ledger.`,
      fields: [
        { name: "feeAmountCents", label: "Fee amount ($)", type: "money", required: true },
        { name: "postAsLoanCredit", label: "Post as a loan credit instead (unusual -- the default keeps this off the ledger entirely)", type: "checkbox" },
        { name: "componentId", label: "Component (only used if posted as a loan credit)", type: "select", options: componentOptions },
        { name: "reason", label: `Reason (${partyLabel.toLowerCase()} record)`, type: "text", required: true },
        { name: "borrowerVisibleExplanation", label: "Explanation shown to the borrower (required only if posted as a loan credit)", type: "text" },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.COMPENSATING_CORRECTION]: {
      label: "Compensating correction",
      description: "Reverse a prior principal or interest correction that was made in error.",
      fields: [
        { name: "reversesEventId", label: "Event to correct (from ledger history)", type: "text", required: true },
        { name: "deltaCents", label: "Correction amount ($)", type: "signedMoney", required: true },
        { name: "reason", label: "Reason", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.PAYMENT_REVERSAL]: {
      label: "Payment reversal",
      description: "Reverse a specific posted payment (e.g. a bounced check or failed transfer).",
      fields: [
        { name: "reversesEventId", label: "Payment to reverse (from ledger history)", type: "text", required: true },
        { name: "reason", label: "Reason", type: "text", required: true },
      ],
    },
    [ADJUSTMENT_ACTION_TYPES.ACCOUNT_CLOSURE]: {
      label: "Account closure",
      description: "Close this account. Only permitted once the replayed balance is exactly zero.",
      fields: [{ name: "closureReason", label: "Closure reason", type: "select", options: CLOSURE_REASON_OPTIONS, required: true }],
    },
  };
}

function initialFormValues(configs, actionType) {
  const config = configs[actionType];
  const values = {};
  for (const field of config.fields) {
    values[field.name] = field.type === "checkbox" ? false : (field.defaultValue ?? "");
  }
  return values;
}

function dollarsToCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

// Converts the form's raw string/boolean field values into the exact `inputs` shape the preview/confirm
// endpoints expect -- money fields become integer cents (never a float sent over the wire), and
// "negativeMoney" fields (concessions/waivers, which only ever forgive) are forced non-positive
// regardless of what the seller typed, matching each preview function's own "must be zero or negative"
// contract.
function toInputsPayload(configs, actionType, formValues) {
  const config = configs[actionType];
  const inputs = {};
  for (const field of config.fields) {
    const raw = formValues[field.name];
    if (field.type === "money") inputs[field.name] = dollarsToCents(raw);
    else if (field.type === "signedMoney") inputs[field.name] = dollarsToCents(raw);
    else if (field.type === "negativeMoney") inputs[field.name] = -Math.abs(dollarsToCents(raw) ?? 0);
    else if (field.type === "checkbox") inputs[field.name] = Boolean(raw);
    else inputs[field.name] = typeof raw === "string" ? raw.trim() : raw;
  }
  return inputs;
}

function FieldInput({ field, value, onChange }) {
  const inputClassName = "mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  if (field.type === "select") {
    return (
      <select value={value} required={field.required} onChange={(event) => onChange(event.target.value)} className={inputClassName}>
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === "checkbox") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="mt-1" />;
  }
  if (field.type === "date") {
    return <input type="date" value={value} required={field.required} onChange={(event) => onChange(event.target.value)} className={inputClassName} />;
  }
  if (field.type === "money" || field.type === "negativeMoney" || field.type === "signedMoney") {
    return <input type="number" step="0.01" value={value} required={field.required} onChange={(event) => onChange(event.target.value)} className={inputClassName} />;
  }
  return <input type="text" value={value} required={field.required} onChange={(event) => onChange(event.target.value)} className={inputClassName} />;
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// The seller-facing preview-first adjustment workflow: choose action -> enter inputs -> Preview (a
// non-mutating server call) -> review before/after values and warnings -> explicit acknowledgement (a
// stronger, typed confirmation for high-impact actions) -> Confirm (the one guarded, immutable append).
// Every number shown comes from the server's own preview response -- nothing here recomputes a balance.
export default function PrivateFinancingSellerActions({ accountId, product, components = [], onPosted, prefillReversalTarget }) {
  const partyLabel = financingPartyLabel(product);
  // Never a fixed interest_bearing/zero_interest pair -- exactly this account's own ordered components,
  // however many it actually has.
  const componentOptions = useMemo(() => components.map((component) => ({ value: component.componentKey, label: component.label })), [components]);
  const componentLabelsByKey = useMemo(
    () => Object.fromEntries(components.map((component) => [component.componentKey, component.label])),
    [components],
  );
  const configs = useMemo(() => buildActionConfigs(partyLabel, componentOptions), [partyLabel, componentOptions]);
  const [openActionType, setOpenActionType] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [effectiveDate, setEffectiveDate] = useState(todayISODate());
  const [previewStatus, setPreviewStatus] = useState("idle"); // idle | loading | ready | error
  const [previewResult, setPreviewResult] = useState(null); // { preview, previewToken }
  const [previewError, setPreviewError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [strongConfirmText, setStrongConfirmText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [appliedPrefillTarget, setAppliedPrefillTarget] = useState(null);
  const requestInFlight = useRef(false);

  const isHighImpact = openActionType ? HIGH_IMPACT_ACTION_TYPES.has(openActionType) : false;

  const openAction = useCallback((actionType) => {
    setOpenActionType(actionType);
    setFormValues(initialFormValues(configs, actionType));
    setEffectiveDate(todayISODate());
    setPreviewStatus("idle");
    setPreviewResult(null);
    setPreviewError("");
    setAcknowledged(false);
    setStrongConfirmText("");
    setPostError("");
    setReceipt(null);
  }, [configs]);

  // "Adjusting state when a prop changes," per React's own documented pattern -- deliberately NOT a
  // useEffect (which would cause an extra render pass every time a ledger row's "Reverse"/"Correct"
  // button is clicked). Each click from PrivateFinancingLedgerHistory constructs a brand-new object, so
  // reference inequality alone detects "a new prefill request arrived," even for the same event id
  // clicked twice in a row.
  if (prefillReversalTarget && prefillReversalTarget !== appliedPrefillTarget) {
    setAppliedPrefillTarget(prefillReversalTarget);
    setOpenActionType(prefillReversalTarget.actionType);
    setFormValues({ ...initialFormValues(configs, prefillReversalTarget.actionType), reversesEventId: prefillReversalTarget.eventId });
    setEffectiveDate(todayISODate());
    setPreviewStatus("idle");
    setPreviewResult(null);
    setPreviewError("");
    setAcknowledged(false);
    setStrongConfirmText("");
    setPostError("");
    setReceipt(null);
  }

  const cancel = useCallback(() => {
    setOpenActionType(null);
    setFormValues({});
    setPreviewStatus("idle");
    setPreviewResult(null);
    setPreviewError("");
    setAcknowledged(false);
    setStrongConfirmText("");
    setPostError("");
    setReceipt(null);
  }, []);

  const config = openActionType ? configs[openActionType] : null;

  const runPreview = useCallback(
    async (event) => {
      event.preventDefault();
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      setPreviewStatus("loading");
      setPreviewError("");
      setAcknowledged(false);
      setStrongConfirmText("");
      try {
        const inputs = toInputsPayload(configs, openActionType, formValues);
        const response = await fetch(`/api/private-financing/accounts/${accountId}/adjustments/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionType: openActionType, inputs, effectiveDate }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to compute a preview for this adjustment.");
        setPreviewResult(payload);
        setPreviewStatus("ready");
      } catch (error) {
        setPreviewError(error.message);
        setPreviewStatus("error");
      } finally {
        requestInFlight.current = false;
      }
    },
    [accountId, configs, effectiveDate, formValues, openActionType, requestInFlight],
  );

  const canConfirm = useMemo(() => {
    if (!previewResult || previewResult.preview.blockingValidation.length > 0) return false;
    if (!acknowledged) return false;
    if (isHighImpact && strongConfirmText.trim().toUpperCase() !== STRONG_CONFIRM_PHRASE) return false;
    return true;
  }, [previewResult, acknowledged, isHighImpact, strongConfirmText]);

  const confirmPost = useCallback(async () => {
    if (!canConfirm || posting) return;
    setPosting(true);
    setPostError("");
    try {
      const inputs = toInputsPayload(configs, openActionType, formValues);
      const response = await fetch(`/api/private-financing/accounts/${accountId}/adjustments/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actionType: openActionType, inputs, previewToken: previewResult.previewToken }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to post this adjustment.");
      setReceipt(payload.event);
      setPreviewResult(null);
      setPreviewStatus("idle");
      setAcknowledged(false);
      onPosted?.();
    } catch (error) {
      setPostError(error.message);
    } finally {
      setPosting(false);
    }
  }, [accountId, canConfirm, configs, formValues, onPosted, openActionType, posting, previewResult]);

  return (
    <section aria-labelledby="pf-actions-heading" className="rounded-2xl border border-slate-200 p-5 dark:border-slate-700">
      <h3 id="pf-actions-heading" className="text-lg font-black text-slate-950 dark:text-white">{partyLabel} actions</h3>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Every action is previewed before anything is posted. Posting appends a new, immutable ledger entry -- nothing is ever edited or deleted.
      </p>

      {!openActionType ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {Object.entries(configs).map(([actionType, actionConfig]) => (
            <button
              key={actionType}
              type="button"
              data-guided-workflow-control={`open-seller-action-${actionType}`}
              onClick={() => openAction(actionType)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {actionConfig.label}
            </button>
          ))}
        </div>
      ) : null}

      {openActionType && config ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-black text-slate-950 dark:text-white">{config.label}</p>
              <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">{config.description}</p>
            </div>
            <button type="button" data-guided-workflow-control="cancel-seller-action" onClick={cancel} className={`text-xs font-black uppercase tracking-wide text-slate-500 underline hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 ${FOCUS_RING}`}>
              Cancel
            </button>
          </div>

          {!receipt ? (
            <form onSubmit={runPreview} className="mt-4 grid gap-3 sm:grid-cols-2">
              {config.fields.map((field) => (
                <label key={field.name} className={`text-sm font-bold text-slate-900 dark:text-white ${field.type === "text" ? "sm:col-span-2" : ""}`}>
                  {field.label}
                  <FieldInput field={field} value={formValues[field.name]} onChange={(value) => setFormValues((current) => ({ ...current, [field.name]: value }))} />
                </label>
              ))}
              <label className="text-sm font-bold text-slate-900 dark:text-white">
                Effective date
                <input type="date" value={effectiveDate} min={todayISODate()} required onChange={(event) => setEffectiveDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" data-guided-workflow-control="preview-seller-action" disabled={previewStatus === "loading"}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition ${goldControlClassName} ${FOCUS_RING}`}>
                  {previewStatus === "loading" ? "Previewing…" : "Preview"}
                </button>
              </div>
            </form>
          ) : null}

          {previewStatus === "error" ? (
            <p role="alert" className="mt-3 text-sm font-bold text-red-800 dark:text-red-300">{previewError}</p>
          ) : null}

          {previewStatus === "ready" && previewResult && !receipt ? (
            <div className="mt-4 rounded-xl border border-sky-200 bg-white p-4 dark:border-sky-900/60 dark:bg-slate-900">
              <p className="text-sm font-black text-slate-950 dark:text-white">Preview</p>
              <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                {Object.entries(previewResult.preview.principalByComponent).map(([componentId, { before, after }]) => (
                  <div key={componentId}>
                    <dt className="font-bold uppercase text-slate-500 dark:text-slate-400">
                      {componentLabelsByKey[componentId] || componentId} before → after
                    </dt>
                    <dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{centsToMoney(before)} → {centsToMoney(after)}</dd>
                  </div>
                ))}
                <div><dt className="font-bold uppercase text-slate-500 dark:text-slate-400">Accrued interest before → after</dt><dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{centsToMoney(previewResult.preview.interestEffect.accruedInterestBeforeCents)} → {centsToMoney(previewResult.preview.interestEffect.accruedInterestAfterCents)}</dd></div>
                {previewResult.preview.pastDueEffect ? (
                  <>
                    <div><dt className="font-bold uppercase text-slate-500 dark:text-slate-400">Scheduled through this date</dt><dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{centsToMoney(previewResult.preview.pastDueEffect.scheduledAmountCents)}</dd></div>
                    <div><dt className="font-bold uppercase text-slate-500 dark:text-slate-400">Shortage before → after this credit</dt><dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{centsToMoney(previewResult.preview.pastDueEffect.pastDueBeforeCents)} → {centsToMoney(previewResult.preview.pastDueEffect.pastDueAfterCents)}</dd></div>
                    <div><dt className="font-bold uppercase text-slate-500 dark:text-slate-400">Next due date / amount</dt><dd className="mt-0.5 font-bold text-slate-900 dark:text-white">{previewResult.preview.pastDueEffect.nextDueDate} · {centsToMoney(previewResult.preview.pastDueEffect.nextDueAmountCents)}</dd></div>
                  </>
                ) : null}
              </dl>
              {previewResult.preview.warnings.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {previewResult.preview.warnings.map((warning) => (
                    <li key={warning} role="status" className="text-xs font-bold text-amber-900 dark:text-amber-200">⚠ {warning}</li>
                  ))}
                </ul>
              ) : null}
              {previewResult.preview.blockingValidation.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {previewResult.preview.blockingValidation.map((blocker) => (
                    <li key={blocker} role="alert" className="text-xs font-bold text-red-800 dark:text-red-300">✕ {blocker}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                  <label className="flex items-start gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
                    I have reviewed this preview and confirm the values above are correct.
                  </label>
                  {isHighImpact ? (
                    <label className="mt-3 block text-sm font-bold text-slate-900 dark:text-white">
                      Type CONFIRM to proceed with this high-impact action
                      <input type="text" value={strongConfirmText} onChange={(event) => setStrongConfirmText(event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white" />
                    </label>
                  ) : null}
                  {postError ? <p role="alert" className="mt-3 text-sm font-bold text-red-800 dark:text-red-300">{postError}</p> : null}
                  <button
                    type="button"
                    data-guided-workflow-control="confirm-seller-action"
                    disabled={!canConfirm || posting}
                    onClick={confirmPost}
                    className={`mt-3 rounded-lg px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50 bg-slate-950 hover:bg-slate-800 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300 ${FOCUS_RING}`}
                  >
                    {posting ? "Posting…" : `Confirm ${config.label}`}
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {receipt ? (
            <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                Posted: {receipt.eventType} (event {receipt.id}, ledger #{receipt.ledgerSequence}, effective {receipt.effectiveDate}).
              </p>
              <button type="button" data-guided-workflow-control="close-seller-action-receipt" onClick={cancel}
                className={`mt-3 rounded-lg border border-emerald-400 px-3 py-1.5 text-sm font-bold text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900/40 ${FOCUS_RING}`}>
                Done
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
