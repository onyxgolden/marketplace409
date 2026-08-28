import TransactionReviewWorkspaceSurface from "@/components/forge/workspace/views/TransactionReviewWorkspaceSurface";

function propertyLabel(property) {
  return property.name || property.address || property.id;
}

function formatReportCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);
}

export default function TransactionReviewWorkspace({
  reviews,
  properties,
  selectedProperties,
  setSelectedProperties,
  selectedReviewItems,
  setSelectedReviewItems,
  assignmentStatus,
  assignProperty,
  assignSelectedProperties,
}) {
  const needsReview = reviews.filter((review) => review.needsAssignment);

  const selectedCount = Object.values(selectedReviewItems).filter(Boolean).length;

  const allSelectableIndexes = reviews
    .map((review, index) => (review.needsAssignment ? index : null))
    .filter((index) => index !== null);

  const allSelected =
    allSelectableIndexes.length > 0 &&
    allSelectableIndexes.every((index) => selectedReviewItems[index]);

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedReviewItems({});
      return;
    }

    const nextSelection = {};

    allSelectableIndexes.forEach((index) => {
      nextSelection[index] = true;
    });

    setSelectedReviewItems(nextSelection);
  }

  return (
    <TransactionReviewWorkspaceSurface
      variant="embedded"
      queue={
        <div className="bg-white rounded-3xl shadow-lg p-8 dark:bg-slate-900 dark:shadow-black/40">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold dark:text-slate-50">Transaction Review</h2>
          <p className="text-gray-600 mt-1 dark:text-slate-400">
            Assign unknown transactions to a property so Forge can learn future rules.
          </p>
        </div>

        <div className="rounded-2xl border bg-gray-50 px-5 py-3 font-bold dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
          {needsReview.length} need assignment
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 rounded-2xl border bg-gray-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/60">
        <div className="font-semibold dark:text-slate-100">
          {selectedCount} transaction{selectedCount === 1 ? "" : "s"} selected
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="rounded-xl border px-4 py-2 font-semibold hover:bg-white dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {allSelected ? "Clear All" : "Select All"}
          </button>

          <button
            type="button"
            onClick={assignSelectedProperties}
            disabled={selectedCount === 0}
            className="rounded-xl bg-green-700 px-4 py-2 font-bold text-white disabled:bg-gray-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            Assign Selected
          </button>

          <button
            type="button"
            onClick={() => setSelectedReviewItems({})}
            disabled={selectedCount === 0}
            className="rounded-xl border px-4 py-2 font-semibold disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            Clear Selection
          </button>
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No transaction review items available.</p>
      ) : (
        <div className="space-y-4">
          {reviews.map((review, index) => {
            const status = assignmentStatus[index];
            const recommendations = review.recommendations || [];
            const topRecommendation = recommendations[0];

            return (
              <div
                key={`${review.transaction?.id || review.record?.date}-${index}`}
                className="rounded-2xl border bg-gray-50 p-5 dark:border-slate-700 dark:bg-slate-800/60"
              >
                <div className="grid grid-cols-1 lg:grid-cols-6 gap-4 items-center">
                  <label className="flex items-center gap-3 font-semibold dark:text-slate-100">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedReviewItems[index])}
                      onChange={(event) =>
                        setSelectedReviewItems((current) => ({
                          ...current,
                          [index]: event.target.checked,
                        }))
                      }
                      disabled={!review.needsAssignment}
                      className="h-5 w-5 accent-amber-500 disabled:opacity-40"
                    />
                    Select
                  </label>

                  <div className="lg:col-span-2">
                    <p className="font-bold dark:text-slate-50">{review.transaction?.description || "No description"}</p>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      {review.transaction?.date} · {formatReportCurrency(review.transaction?.amountCents || 0)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 font-bold dark:text-slate-400">
                      Current Property
                    </p>
                    <p className="font-semibold dark:text-slate-100">
                      {review.resolvedProperty?.name || review.record?.property || "Unknown Property"}
                    </p>
                  </div>

                  <select
                    value={selectedProperties[index] || ""}
                    onChange={(event) =>
                      setSelectedProperties((current) => ({
                        ...current,
                        [index]: event.target.value,
                      }))
                    }
                    disabled={!review.needsAssignment}
                    className="rounded-xl border bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-amber-400"
                  >
                    <option value="">
                      {review.needsAssignment ? "Select property" : "Already resolved"}
                    </option>

                    {properties.map((property) => (
                      <option key={property.id} value={property.id}>
                        {propertyLabel(property)}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => assignProperty(review, index)}
                    disabled={!review.needsAssignment || status?.type === "saving"}
                    className="rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:bg-gray-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
                  >
                    {status?.type === "saving" ? "Assigning..." : "Assign"}
                  </button>
                </div>

                {review.needsAssignment && topRecommendation && (
                  <div className="mt-4 rounded-2xl border bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          Forge Recommendation
                        </p>
                        <p className="mt-1 font-bold dark:text-slate-50">
                          {propertyLabel(topRecommendation.property)}
                        </p>
                      </div>

                      <div className="rounded-xl border bg-gray-50 px-4 py-2 font-bold dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100">
                        {Math.round((review.confidence || 0) * 100)}% confidence
                      </div>
                    </div>

                    <p className="mt-3 text-sm text-gray-700 dark:text-slate-300">
                      {topRecommendation.explanation}
                    </p>

                    {recommendations.length > 1 && (
                      <div className="mt-3">
                        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          Other matches
                        </p>

                        <ul className="mt-2 space-y-1 text-sm text-gray-700 dark:text-slate-300">
                          {recommendations.slice(1).map((recommendation) => (
                            <li key={recommendation.property.id}>
                              {propertyLabel(recommendation.property)} ·{" "}
                              {Math.round(recommendation.score * 100)}%
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {status && (
                  <p
                    className={`mt-3 text-sm font-semibold ${
                      status.type === "error"
                        ? "text-red-700 dark:text-red-400"
                        : "text-green-700 dark:text-emerald-400"
                    }`}
                  >
                    {status.message}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
        </div>
      }
    />
  );
}
