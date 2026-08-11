"use client";

export function normalizeApplicationFunctions(
  functions,
) {
  if (!Array.isArray(functions)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    functions
      .filter(
        (item) =>
          typeof item?.id ===
            "string" &&
          item.id.trim() &&
          typeof item?.label ===
            "string" &&
          item.label.trim(),
      )
      .map((item) =>
        Object.freeze({
          id:
            item.id.trim(),
          label:
            item.label.trim(),
        }),
      ),
  );
}

export function resolveActiveFunction(
  functions,
  requestedFunctionId,
) {
  const normalizedFunctions =
    normalizeApplicationFunctions(
      functions,
    );

  const requestedId =
    String(
      requestedFunctionId || "",
    ).trim();

  return (
    normalizedFunctions.find(
      (item) =>
        item.id === requestedId,
    )?.id ||
    normalizedFunctions[0]?.id ||
    null
  );
}

export default function ApplicationShell({
  applicationName,
  applicationDescription = null,
  functions = [],
  activeFunctionId,
  onFunctionChange,
  utility = null,
  activeSurface,
}) {
  const normalizedFunctions =
    normalizeApplicationFunctions(
      functions,
    );

  const resolvedActiveFunctionId =
    resolveActiveFunction(
      normalizedFunctions,
      activeFunctionId,
    );

  return (
    <section
      data-application-shell
      data-active-function={
        resolvedActiveFunctionId ||
        ""
      }
      className="min-h-screen bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100"
    >
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto max-w-[1800px] px-4 py-4 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">
                  FORGE Application
                </div>

                <h1 className="truncate text-2xl font-black tracking-tight lg:text-3xl dark:text-slate-50">
                  {applicationName}
                </h1>

                {applicationDescription && (
                  <p className="mt-1 max-w-3xl text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {applicationDescription}
                  </p>
                )}
              </div>
            </div>

            {utility && (
              <div data-application-utility>
                {utility}
              </div>
            )}
          </div>

          {normalizedFunctions.length >
            0 && (
            <nav
              aria-label={`${applicationName} functions`}
              className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1"
            >
              {normalizedFunctions.map(
                (item) => {
                  const active =
                    item.id ===
                    resolvedActiveFunctionId;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={
                        active
                          ? "page"
                          : undefined
                      }
                      onClick={() =>
                        onFunctionChange?.(
                          item.id,
                        )
                      }
                      className={
                        active
                          ? "shrink-0 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950"
                          : "shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-600 transition hover:border-slate-950 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:text-white"
                      }
                    >
                      {item.label}
                    </button>
                  );
                },
              )}
            </nav>
          )}
        </div>
      </header>

      <main
        data-active-function-surface={
          resolvedActiveFunctionId ||
          ""
        }
        className="mx-auto max-w-[1800px] p-4 lg:p-8"
      >
        {activeSurface}
      </main>
    </section>
  );
}
