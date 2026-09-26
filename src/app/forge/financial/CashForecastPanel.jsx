"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { forgeTheme } from "@/components/forge/theme";
import { ForgeEmptyState, ForgeErrorState, ForgeLoadingState } from "@/components/forge/ForgeStates";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { forecastCashFlow } from "@/domains/ledger/brain/forecast.js";
import { money } from "./formatMoney.js";

const DAY_OPTIONS = [30, 60, 90];

const WARNING_STYLES = {
  shortfall: "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40",
  tight: "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
};

const WARNING_BADGE = {
  shortfall: "bg-red-600 text-white",
  tight: "bg-amber-500 text-slate-950",
};

function formatShortDate(iso) {
  const [year, month, day] = String(iso ?? "").split("-").map(Number);
  if (!year || !month || !day) return iso ?? "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[month - 1]} ${day}`;
}

function daysOutLabel(daysFromStart) {
  if (daysFromStart <= 0) return "today";
  if (daysFromStart === 1) return "tomorrow";
  return `in ${daysFromStart} days`;
}

function warningTitle(warning) {
  const when = `${formatShortDate(warning.date)} (${daysOutLabel(warning.daysFromStart)})`;
  if (warning.type === "shortfall") {
    return `${warning.accountName} goes negative ${when} — projected ${money(warning.projectedBalance)}`;
  }
  return `${warning.accountName} runs tight ${when} — down to ${money(warning.projectedBalance)}`;
}

// Dependency-free sparkline of the weekly checkpoints. viewBox + non-uniform
// scaling keeps it crisp at any width; a dashed zero line anchors the eye.
function ForecastSparkline({ checkpoints, danger }) {
  const points = (checkpoints ?? []).map((c) => Number(c.projectedBalance) || 0);
  if (points.length < 2) return null;
  const width = 200;
  const height = 44;
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const span = max - min || 1;
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => height - 4 - ((v - min) / span) * (height - 8);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const stroke = danger === "shortfall" ? "#dc2626" : danger === "tight" ? "#d97706" : "#64748b";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-11 w-full"
      role="img"
      aria-label="Projected balance trend"
    >
      {min < 0 && (
        <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />
      )}
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Low-confidence burn block: when the history behind the daily burn is too
// thin, the burn figure (and the lowest-balance figure that depends on it) are
// withheld as dashes -- never presented as facts. The user can supply a daily
// spend assumption, which re-runs the pure forecast client-side under their
// number and labels it as theirs.
function AccountBurnBlock({
  account,
  withheld,
  explanation,
  override,
  draft,
  onDraftChange,
  onApply,
  onClear,
}) {
  const inputClass =
    "w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="mt-2">
      <p className={forgeTheme.textSmall}>
        Lowest:{" "}
        {withheld ? (
          <span className="font-black text-slate-900 dark:text-slate-100">—</span>
        ) : (
          <>
            {money(account.minBalance)} on {formatShortDate(account.minBalanceDate)}
          </>
        )}
        {" · "}Burn{" "}
        {withheld ? (
          <span className="font-black text-slate-900 dark:text-slate-100">—</span>
        ) : override != null ? (
          <span>
            {money(override)}/day{" "}
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-black uppercase text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
              your estimate
            </span>
          </span>
        ) : (
          <span>
            {money(account.dailyBurn)}/day
          </span>
        )}
      </p>

      {withheld && (
        <div
          role="status"
          className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30"
        >
          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
            Burn withheld — {explanation}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-300">
            The daily spend rate can&apos;t be measured from this little history, so it
            isn&apos;t shown — and this account&apos;s balance projection and shortfall
            warnings are hidden with it. Enter what
            you actually spend per day and the projection re-runs from your number.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs font-bold text-amber-900 dark:text-amber-200">
              Assume $/day
              <input
                type="number"
                min="0"
                step="1"
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onApply();
                }}
                aria-label={`Assume daily spend for ${account.name}`}
                className={`ml-2 ${inputClass}`}
              />
            </label>
            <button
              type="button"
              onClick={onApply}
              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {override != null && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Projected from your estimate of {money(override)}/day, not from measured
          history.{" "}
          <button
            type="button"
            onClick={onClear}
            className="font-bold text-sky-700 underline dark:text-sky-400"
          >
            Clear estimate
          </button>
        </p>
      )}
    </div>
  );
}

async function loadForecast(days) {
  const response = await fetch(`/api/financial/forecast?days=${days}`);
  const payload = await response.json();
  if (!response.ok || payload?.success !== true) {
    throw new Error(payload?.error || "Could not build the cash forecast.");
  }
  return payload.data;
}

export default function CashForecastPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [days, setDays] = useState(90);
  // Stale-while-revalidate, keyed by horizon: switching horizons serves the cached
  // forecast instantly and refreshes in the background; switching back to a recently
  // viewed horizon never flashes "Projecting balances…".
  const { data: forecast, error, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    `financial:forecast:${days}`,
    () => loadForecast(days),
    { ttlMs: 60_000 },
  );

  function changeDays(option) {
    if (option === days) return;
    setDays(option);
  }

  // Switching horizons swaps the cache key, so keep the last visible forecast on screen
  // while the new horizon loads — the horizon switch never blanks the panel.
  const [lastForecast, setLastForecast] = useState(null);
  if (forecast && forecast !== lastForecast) {
    // Adjusting state during render on a fresh payload: the standard React
    // derived-state pattern, so the previous horizon stays visible mid-switch.
    setLastForecast(forecast);
  }
  const visible = forecast ?? lastForecast;

  // User-supplied daily-spend assumptions, keyed by account id. They flip a
  // withheld burn metric back to shown -- labeled as the user's estimate, and
  // re-running the pure forecast client-side under that number.
  const [burnOverrides, setBurnOverrides] = useState({});
  const [burnDrafts, setBurnDrafts] = useState({});

  const burnConfidence = visible?.meta?.burnConfidence ?? null;
  const burnWithheld = burnConfidence != null && burnConfidence.confident === false;

  const accounts = useMemo(() => visible?.accounts ?? [], [visible]);
  const patterns = visible?.recurringPatterns ?? null;
  const meta = visible?.meta ?? null;

  const recomputedByAccount = useMemo(() => {
    if (!burnWithheld || !patterns || !meta) return {};
    const out = {};
    for (const [accountId, override] of Object.entries(burnOverrides)) {
      const account = accounts.find((entry) => entry.accountId === accountId);
      const assumed = Number(override);
      if (!account || !Number.isFinite(assumed) || assumed < 0) continue;
      const result = forecastCashFlow({
        accounts: [
          {
            accountId: account.accountId,
            name: account.name,
            startingBalance: account.startingBalance,
          },
        ],
        recurringPatterns: patterns,
        dailyBurn: { [accountId]: assumed },
        startDate: meta.startDate,
        days: meta.days,
        safetyBuffer: meta.safetyBuffer,
      });
      if (result.accounts[0]) out[accountId] = result.accounts[0];
    }
    return out;
  }, [burnWithheld, patterns, meta, accounts, burnOverrides]);

  // Accounts with an applied assumption show the re-run projection; everything
  // else shows the server figure (with burn metrics withheld when confidence
  // is low). When the burn is withheld and the user hasn't supplied an
  // assumption, the server projection is stripped: its checkpoints and
  // warnings were computed with the low-confidence burn, so keeping them
  // would leak the unreliable trajectory through the sparkline, the warning
  // list, and the danger coloring. Warnings always follow the displayed
  // accounts.
  const displayAccounts = accounts.map((account) => {
    const recomputed = recomputedByAccount[account.accountId];
    if (recomputed) return recomputed;
    if (burnWithheld) {
      return { ...account, checkpoints: [], warnings: [] };
    }
    return account;
  });

  // Accounts whose projection is withheld (no user assumption applied) — the
  // "no shortfalls" all-clear must not print for them.
  const withheldProjectionCount = burnWithheld
    ? accounts.filter((account) => recomputedByAccount[account.accountId] == null).length
    : 0;
  const warnings = displayAccounts
    .flatMap((account) => account.warnings ?? [])
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dangerByAccount = Object.fromEntries(
    displayAccounts.map((account) => [
      account.accountId,
      account.warnings?.some((w) => w.type === "shortfall")
        ? "shortfall"
        : account.warnings?.length > 0
          ? "tight"
          : null,
    ]),
  );

  return (
    <section data-cash-forecast id="cash-forecast" className={forgeTheme.card}>
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
        className="flex w-full items-start justify-between gap-3 rounded-xl text-left"
      >
        <span className="min-w-0">
          <span className={forgeTheme.labelSmall}>Forge Brain</span>
          <h2 className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">Cash forecast</h2>
        </span>
        <ChevronDown
          size={20}
          aria-hidden="true"
          className={`mt-1 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            Projected cash balances from detected recurring payments and your recent daily burn —
            read-only, nothing here moves money.
          </p>

          <div className="mt-3 flex gap-2">
            {DAY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => changeDays(option)}
                aria-pressed={days === option}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  days === option
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {option} days
              </button>
            ))}
          </div>

          <div className="mt-4">
            {!visible && isLoading && <ForgeLoadingState label="Projecting balances…" />}

            {!visible && !isLoading && error && (
              <ForgeErrorState
                title="Could not build the cash forecast."
                detail={error}
                onRetry={refresh}
              />
            )}

            {visible && error && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Could not refresh — showing the last saved forecast.
              </p>
            )}

            {visible && (isRefreshing || !forecast) && (
              <p role="status" className={`${forgeTheme.textSmall} mt-2`}>
                Updating…
              </p>
            )}

            {visible && accounts.length === 0 && (
              <ForgeEmptyState
                headline="No cash accounts with known balances to forecast"
                guidance="Add a bank account with a balance and this forecast will project it forward from your recurring payments and recent daily burn."
              />
            )}

            {visible && warnings.length > 0 && (
              <ul className="flex flex-col gap-2">
                {warnings.map((warning, index) => (
                  <li
                    key={`${warning.accountId}-${warning.date}-${index}`}
                    className={`rounded-xl border px-4 py-3 ${WARNING_STYLES[warning.type] ?? WARNING_STYLES.tight}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {warningTitle(warning)}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold uppercase ${WARNING_BADGE[warning.type] ?? WARNING_BADGE.tight}`}
                      >
                        {warning.type}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {visible && warnings.length === 0 && accounts.length > 0 && (
              withheldProjectionCount > 0 ? (
                <p className={forgeTheme.textSmall}>
                  Shortfall warnings are withheld for{" "}
                  {withheldProjectionCount === accounts.length ? "all accounts" : "some accounts"} —
                  not enough spending history to project reliably.
                </p>
              ) : (
                <p className={forgeTheme.textSmall}>
                  No shortfalls or tight spots in the next {days} days.
                </p>
              )
            )}

            {visible && accounts.length > 0 && (
              <ul className={`flex flex-col gap-3 ${warnings.length > 0 ? "mt-4" : "mt-2"}`}>
                {displayAccounts.map((account) => {
                  const override =
                    burnWithheld && burnOverrides[account.accountId] != null
                      ? Number(burnOverrides[account.accountId])
                      : null;
                  // No user assumption + withheld burn = no projection at all:
                  // the sparkline would otherwise draw the unreliable trajectory.
                  const projectionWithheld = burnWithheld && override == null;
                  return (
                    <li
                      key={account.accountId}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{account.name}</p>
                        <p className={forgeTheme.textSmall}>Now {money(account.startingBalance)}</p>
                      </div>
                      {projectionWithheld ? (
                        <div
                          role="status"
                          className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                        >
                          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                            Projection withheld — not enough spending history to project this account&apos;s balance.
                          </p>
                        </div>
                      ) : (
                        <ForecastSparkline
                          checkpoints={account.checkpoints}
                          danger={dangerByAccount[account.accountId]}
                        />
                      )}
                      <AccountBurnBlock
                        account={account}
                        withheld={burnWithheld && override == null}
                        explanation={burnConfidence?.explanation ?? ""}
                        override={override}
                        draft={burnDrafts[account.accountId] ?? ""}
                        onDraftChange={(value) =>
                          setBurnDrafts((current) => ({
                            ...current,
                            [account.accountId]: value,
                          }))
                        }
                        onApply={() => {
                          const assumed = Number(burnDrafts[account.accountId]);
                          if (!Number.isFinite(assumed) || assumed < 0) return;
                          setBurnOverrides((current) => ({
                            ...current,
                            [account.accountId]: assumed,
                          }));
                          setBurnDrafts((current) => ({
                            ...current,
                            [account.accountId]: "",
                          }));
                        }}
                        onClear={() =>
                          setBurnOverrides((current) => {
                            const next = { ...current };
                            delete next[account.accountId];
                            return next;
                          })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
