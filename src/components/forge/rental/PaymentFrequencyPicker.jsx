// R13: shared payment-frequency picker -- weekly / bi-weekly / monthly with
// plain-English explanations. Used by the owner lease forms and the tenant
// portal self-scheduling control.
export const PAYMENT_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly", description: "Paid monthly — 12 payments a year" },
  { value: "biweekly", label: "Every two weeks", description: "Paid every two weeks — 26 payments a year" },
  { value: "weekly", label: "Weekly", description: "Paid weekly — 52 payments a year" },
];

export function paymentFrequencyDescription(value) {
  return (PAYMENT_FREQUENCY_OPTIONS.find((option) => option.value === value) || PAYMENT_FREQUENCY_OPTIONS[0]).description;
}

export default function PaymentFrequencyPicker({ name = "paymentFrequency", defaultValue = "monthly", className, id }) {
  return <label className="text-sm font-bold text-slate-900 dark:text-white">Payment frequency
    <select name={name} id={id} defaultValue={defaultValue}
      className={className || "mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white"}>
      {PAYMENT_FREQUENCY_OPTIONS.map((option) => <option key={option.value} value={option.value}>
        {option.label} — {option.description}
      </option>)}
    </select>
    <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
      How often rent is charged. The monthly rent is split into equal whole-cent payments.
    </span>
  </label>;
}
