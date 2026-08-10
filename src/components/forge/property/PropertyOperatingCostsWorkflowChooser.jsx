export const OPERATING_COST_WORKFLOW_CHOICES =
  Object.freeze([
    Object.freeze({
      id: "property-tax",
      label:
        "Add or update property tax",
      explanation:
        "Upload a tax statement or enter verified annual tax details, review every populated field, and approve the obligation for the selected property.",
    }),
    Object.freeze({
      id: "insurance-policy",
      label:
        "Add or update insurance policy",
      explanation:
        "Upload a declaration or enter verified premium, coverage, provider, and policy details before approving the policy.",
    }),
    Object.freeze({
      id: "verify-coverage",
      label:
        "Verify incomplete coverage",
      explanation:
        "Complete missing insurance dates and policy facts so verified premiums can accrue into property NOI without changing imported cash payments.",
    }),
    Object.freeze({
      id: "review",
      label:
        "Review taxes and insurance",
      explanation:
        "Review annual obligations, coverage periods, recognition status, payment reconciliation, and preserved verification notes.",
    }),
    Object.freeze({
      id: "import",
      label:
        "Import category ledger CSV",
      explanation:
        "Preview owner-scoped tax and insurance rows, resolve invalid records and warnings, then approve the verified import.",
    }),
  ]);

export function getOperatingCostWorkflowChoice(
  workflowId,
) {
  return (
    OPERATING_COST_WORKFLOW_CHOICES.find(
      ({ id }) =>
        id === workflowId,
    ) || null
  );
}

export function PropertyOperatingCostsWorkflowHeader({
  workflowId,
  showGuidance = true,
  onBack = () => {},
}) {
  const choice =
    getOperatingCostWorkflowChoice(
      workflowId,
    );

  if (!choice) {
    return null;
  }

  return (
    <div
      data-property-operating-cost-workflow-header
      className="flex flex-wrap items-start justify-between gap-4"
    >
      <div>
        <div className="text-xs font-black uppercase tracking-wide text-blue-700">
          Taxes &amp; Insurance Workflow
        </div>

        <h4 className="mt-1 text-xl font-black text-slate-950">
          {choice.label}
        </h4>

        {showGuidance && (
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600">
            {choice.explanation}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onBack}
        className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700"
      >
        Back
      </button>
    </div>
  );
}

export default function PropertyOperatingCostsWorkflowChooser({
  showGuidance = true,
  onToggleGuidance = () => {},
  onChoose = () => {},
}) {
  return (
    <section
      data-property-operating-cost-workflow-chooser
      className="mt-6 max-w-3xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-base font-black text-slate-950">
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
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-600"
        >
          Guidance{" "}
          {showGuidance
            ? "on"
            : "off"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {OPERATING_COST_WORKFLOW_CHOICES.map(
          (choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() =>
                onChoose(
                  choice.id,
                )
              }
              className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm font-black text-slate-900 shadow-sm transition hover:border-blue-400 hover:bg-blue-50"
            >
              {choice.label}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
