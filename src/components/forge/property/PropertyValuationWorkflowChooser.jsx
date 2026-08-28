export const PROPERTY_VALUATION_WORKFLOW_CHOICES =
Object.freeze([
  Object.freeze({
    id: "record",
    label:
      "Record or update a property value",
    explanation:
      "Record a verified owner estimate, appraisal, assessed value, provider estimate, or purchase price with its effective date and notes.",
  }),
  Object.freeze({
    id: "import",
    label:
      "Import valuation CSV",
    explanation:
      "Preview a valuation spreadsheet, correct invalid rows, and approve valid property values before they are recorded.",
  }),
  Object.freeze({
    id: "history",
    label:
      "Review recorded values",
    explanation:
      "Review the latest owner-scoped value, source, valuation type, and effective date for each property.",
  }),
]);

export function getPropertyValuationWorkflowChoice(
  workflowId,
) {
  return (
    PROPERTY_VALUATION_WORKFLOW_CHOICES
      .find(
        (choice) =>
          choice.id === workflowId,
      ) || null
  );
}

export function PropertyValuationWorkflowHeader({
  workflowId,
  showGuidance,
  onBack,
}) {
  const choice =
    getPropertyValuationWorkflowChoice(
      workflowId,
    );

  if (!choice) {
    return null;
  }

  return (
    <div
      data-property-valuation-workflow-header
      className="border-b border-slate-200 pb-5 dark:border-slate-800"
    >
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-black text-emerald-800"
      >
        ← Back to valuation options
      </button>

      <h4 className="mt-4 text-xl font-black text-slate-950 dark:text-slate-50">
        {choice.label}
      </h4>

      {showGuidance && (
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          {choice.explanation}
        </p>
      )}
    </div>
  );
}

export default function PropertyValuationWorkflowChooser({
  showGuidance = true,
  onToggleGuidance,
  onChoose,
}) {
  return (
    <section
      data-property-valuation-workflow-chooser
      className="mt-6 max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h5 className="text-sm font-black text-slate-950 dark:text-slate-50">
          What do you want to do?
        </h5>

        <button
          type="button"
          aria-pressed={showGuidance}
          onClick={onToggleGuidance}
          className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
        >
          Guidance {showGuidance
            ? "on"
            : "off"}
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {PROPERTY_VALUATION_WORKFLOW_CHOICES.map(
          (choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                onChoose?.(
                  choice.id,
                )
              }
              className="min-h-20 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-black text-emerald-950 transition hover:border-emerald-400 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/50"
            >
              {choice.label}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
