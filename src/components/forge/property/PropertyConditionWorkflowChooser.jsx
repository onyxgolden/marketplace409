export const PROPERTY_CONDITION_WORKFLOW_CHOICES =
  Object.freeze([
    Object.freeze({
      id: "record",
      label:
        "Record condition assessment",
      explanation:
        "Document an owner walkthrough with standardized structural, electrical, HVAC, plumbing, appliance, and optional-system observations.",
    }),
    Object.freeze({
      id: "history",
      label:
        "Review condition history",
      explanation:
        "Review prior assessment dates, summaries, and observation counts for the selected property without opening the assessment form.",
    }),
  ]);

export function getPropertyConditionWorkflowChoice(
  workflowId,
) {
  return (
    PROPERTY_CONDITION_WORKFLOW_CHOICES.find(
      ({ id }) =>
        id === workflowId,
    ) || null
  );
}

export function PropertyConditionWorkflowHeader({
  workflowId,
  showGuidance = true,
  onBack = () => {},
}) {
  const choice =
    getPropertyConditionWorkflowChoice(
      workflowId,
    );

  if (!choice) {
    return null;
  }

  return (
    <div
      data-property-condition-workflow-header
      className="flex flex-wrap items-start justify-between gap-4"
    >
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          Condition Workflow
        </div>

        <h4 className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">
          {choice.label}
        </h4>

        {showGuidance && (
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
            {choice.explanation}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
      >
        Back
      </button>
    </div>
  );
}

export default function PropertyConditionWorkflowChooser({
  showGuidance = true,
  onToggleGuidance = () => {},
  onChoose = () => {},
}) {
  return (
    <section
      data-property-condition-workflow-chooser
      className="mt-6 max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-base font-black text-slate-950 dark:text-slate-50">
          What do you want to do?
        </h4>

        <button
          type="button"
          aria-pressed={
            showGuidance
          }
          onClick={
            onToggleGuidance
          }
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
        >
          Guidance{" "}
          {showGuidance
            ? "on"
            : "off"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {PROPERTY_CONDITION_WORKFLOW_CHOICES.map(
          (choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                onChoose(
                  choice.id,
                )
              }
              className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm font-black text-slate-900 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50 dark:hover:border-emerald-500 dark:hover:bg-slate-800"
            >
              {choice.label}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
