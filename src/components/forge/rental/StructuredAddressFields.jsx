"use client";
import { useState } from "react";
import { US_STATES } from "@/lib/address/usStates";
import { looksLikeFullAddress, parseUsAddress } from "@/lib/address/parseUsAddress";
import { validateAddressFields } from "@/lib/address/validateAddress";

const DEFAULT_NAMES = {
  street: "addressStreet",
  unit: "addressUnit",
  city: "addressCity",
  state: "addressState",
  zip: "addressZip",
};

const inputClassName = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
const errorInputClassName = "mt-1 w-full rounded-xl border border-red-500 bg-white px-4 py-3 dark:border-red-500 dark:bg-slate-900 dark:text-white";

// Stable default so the "parent submitted again" identity check below works.
const NO_EXTERNAL_ERRORS = {};

// Structured US address entry: street, unit/apt (optional), city, state
// dropdown, and validated ZIP. Pasting a full address into the street field
// parses and prefills every field (client-side only, no external service).
export default function StructuredAddressFields({
  initialValues = {},
  externalErrors = NO_EXTERNAL_ERRORS,
  fieldNames = DEFAULT_NAMES,
  idPrefix = "address",
  required = false,
  className = "md:col-span-2",
}) {
  const [values, setValues] = useState({
    street: initialValues.street || "",
    unit: initialValues.unit || "",
    city: initialValues.city || "",
    state: initialValues.state || "",
    zip: initialValues.zip || "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  // Fields the user edited since the parent last submitted. Their local
  // (possibly cleared) error wins over the stale submit-time error until the
  // parent submits again and replaces externalErrors.
  const [editedSinceExternal, setEditedSinceExternal] = useState({});
  const [prevExternalErrors, setPrevExternalErrors] = useState(externalErrors);
  if (prevExternalErrors !== externalErrors) {
    setPrevExternalErrors(externalErrors);
    setEditedSinceExternal({});
  }

  const errors = { ...fieldErrors };
  for (const [key, message] of Object.entries(externalErrors)) {
    if (!editedSinceExternal[key]) errors[key] = message;
  }

  function setField(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
    setEditedSinceExternal((current) => ({ ...current, [key]: true }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function validateField(key, value) {
    const result = validateAddressFields({ ...values, [key]: value }, { allowEmptyGroup: true });
    // In blur validation we only surface this field's own error, and only
    // when the group is non-empty (an untouched blank group is fine on edit).
    const groupEmpty = ["street", "unit", "city", "state", "zip"].every((k) => String((k === key ? value : values[k]) || "").trim() === "");
    setFieldErrors((current) => {
      const next = { ...current };
      if (groupEmpty || !result.errors[key]) delete next[key];
      else next[key] = result.errors[key];
      return next;
    });
  }

  function handleStreetPaste(event) {
    const pasted = event.clipboardData?.getData("text") || "";
    if (!looksLikeFullAddress(pasted)) return;
    const parsed = parseUsAddress(pasted);
    if (!parsed || !parsed.street || !parsed.city || !parsed.state || !parsed.zip) return;
    event.preventDefault();
    setValues({ street: parsed.street, unit: parsed.unit, city: parsed.city, state: parsed.state, zip: parsed.zip });
    setEditedSinceExternal({ street: true, unit: true, city: true, state: true, zip: true });
    setFieldErrors({});
  }

  return (
    <fieldset className={`${className} rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/40`}>
      <legend className="px-2 text-sm font-black uppercase tracking-wide text-slate-700 dark:text-slate-300">Property address</legend>
      <p className="text-xs text-slate-500 dark:text-slate-400">Tip: paste a full address into the street field and it will be split into the fields below.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2" htmlFor={`${idPrefix}-street`}>
          Street address
          <input id={`${idPrefix}-street`} name={fieldNames.street} value={values.street} required={required}
            onChange={(event) => setField("street", event.target.value)}
            onBlur={(event) => validateField("street", event.target.value)}
            onPaste={handleStreetPaste}
            placeholder="123 Main St" autoComplete="street-address"
            className={errors.street ? errorInputClassName : inputClassName} />
          {errors.street && <span className="mt-1 block text-xs font-bold text-red-700 dark:text-red-400">{errors.street}</span>}
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white" htmlFor={`${idPrefix}-unit`}>
          Unit / Apt <span className="font-normal text-slate-500">(optional)</span>
          <input id={`${idPrefix}-unit`} name={fieldNames.unit} value={values.unit}
            onChange={(event) => setField("unit", event.target.value)}
            placeholder="Apt 4" autoComplete="address-line2"
            className={inputClassName} />
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white" htmlFor={`${idPrefix}-city`}>
          City
          <input id={`${idPrefix}-city`} name={fieldNames.city} value={values.city} required={required}
            onChange={(event) => setField("city", event.target.value)}
            onBlur={(event) => validateField("city", event.target.value)}
            placeholder="Springfield" autoComplete="address-level2"
            className={errors.city ? errorInputClassName : inputClassName} />
          {errors.city && <span className="mt-1 block text-xs font-bold text-red-700 dark:text-red-400">{errors.city}</span>}
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white" htmlFor={`${idPrefix}-state`}>
          State
          <select id={`${idPrefix}-state`} name={fieldNames.state} value={values.state} required={required}
            onChange={(event) => { setField("state", event.target.value); validateField("state", event.target.value); }}
            autoComplete="address-level1"
            className={errors.state ? errorInputClassName : inputClassName}>
            <option value="">Select state</option>
            {US_STATES.map((state) => <option key={state.code} value={state.code}>{state.name}</option>)}
          </select>
          {errors.state && <span className="mt-1 block text-xs font-bold text-red-700 dark:text-red-400">{errors.state}</span>}
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white" htmlFor={`${idPrefix}-zip`}>
          ZIP code
          <input id={`${idPrefix}-zip`} name={fieldNames.zip} value={values.zip} required={required}
            onChange={(event) => setField("zip", event.target.value)}
            onBlur={(event) => validateField("zip", event.target.value)}
            placeholder="12345" autoComplete="postal-code" inputMode="numeric"
            className={errors.zip ? errorInputClassName : inputClassName} />
          {errors.zip && <span className="mt-1 block text-xs font-bold text-red-700 dark:text-red-400">{errors.zip}</span>}
        </label>
      </div>
    </fieldset>
  );
}
