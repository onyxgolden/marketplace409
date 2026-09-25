"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import computeRetirementTarget, { SPENDING_SMILE_DECLINE_PCT } from "@/domains/retirement/computeRetirementTarget";
import backtestRetirement from "@/domains/retirement/backtestRetirement";
import projectRetirementTimeline from "@/domains/retirement/projectRetirementTimeline";
import deriveRetirementMilestones from "@/domains/retirement/deriveRetirementMilestones";
import shillerAnnual from "@/domains/retirement/shillerAnnual.json";
import { ALLOCATION_PROFILES, allocationProfileById } from "@/domains/retirement/allocationProfiles";
import RetirementTimelineChart from "@/components/forge/budget/RetirementTimelineChart";

const STORAGE_KEY = "forge:retirement-card:v1";

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const inputClassName =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-500";

function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

const DEFAULTS = {
  expensesText: "", // empty = auto from the personal budget
  withdrawalRateText: "4",
  currentAgeText: "",
  retirementAgeText: "65",
  inflationText: "3",
  allocationId: "balanced",
  advancedOpen: false,
  includeHealthcare: true,
  pre65Text: "18000",
  post65Text: "6500",
  healthcareInflationText: "5",
  ssMonthlyText: "",
  ssClaimAge: "67",
  ssHaircut: false,
  rentalMonthlyText: "",
  planningAgeText: "95",
  mortgagePayoffAgeText: "",
  spendingSmile: false,
  checklist: { emergency: false, debt: false, fund: false },
};

function loadPersisted() {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      checklist: { ...DEFAULTS.checklist, ...(parsed.checklist ?? {}) },
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function NumberField({ label, value, onChange, hint, badge, min, step, inputMode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        {badge ? (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-800 dark:bg-sky-900/50 dark:text-sky-200">
            {badge}
          </span>
        ) : null}
      </span>
      <input
        type="number"
        className={`mt-1 ${inputClassName}`}
        value={value}
        min={min}
        step={step}
        inputMode={inputMode ?? "decimal"}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <span className="mt-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">{hint}</span> : null}
    </label>
  );
}

function LeverRow({ label, delta }) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
        <span className="text-sm font-bold text-slate-400 dark:text-slate-500">already maxed</span>
      </div>
    );
  }
  const good = delta < 0;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <span
        className={`text-sm font-black tabular-nums ${
          good ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
        }`}
      >
        {good ? "−" : "+"}
        {wholeDollars.format(Math.abs(delta)).replace("-", "")}
      </span>
    </div>
  );
}

function SurvivalFigure({ label, survivalPct, note }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3 text-center ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">
        <span className="text-sky-600 dark:text-sky-400">{survivalPct}%</span>
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{note}</p>
    </div>
  );
}

export default function RetirementNumberCard({ budgetMonthlyExpenses }) {
  const [persisted, setPersisted] = useState(loadPersisted);
  const update = (patch) => setPersisted((previous) => ({ ...previous, ...patch }));

  // Persist every input + the checklist on every change (local only, no backend).
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch {
      // localStorage unavailable — the card still works, it just won't remember.
    }
  }, [persisted]);

  const budgetAuto = Number.isFinite(budgetMonthlyExpenses) && budgetMonthlyExpenses > 0 ? budgetMonthlyExpenses : null;
  const expensesTyped = parseNumber(persisted.expensesText);
  const usingBudgetAuto = (persisted.expensesText ?? "").trim() === "";
  const monthlyExpenses = usingBudgetAuto ? budgetAuto : expensesTyped;

  const withdrawalRatePct = parseNumber(persisted.withdrawalRateText);
  const currentAge = parseNumber(persisted.currentAgeText);
  const retirementAge = parseNumber(persisted.retirementAgeText);
  const generalInflationPct = parseNumber(persisted.inflationText);

  const ageValid = currentAge != null && currentAge > 0 && currentAge < 120;
  const inputsValid =
    monthlyExpenses != null &&
    monthlyExpenses >= 0 &&
    withdrawalRatePct != null &&
    withdrawalRatePct > 0 &&
    ageValid &&
    retirementAge != null &&
    retirementAge > 0 &&
    generalInflationPct != null &&
    generalInflationPct >= 0;

  // Shared domain input; the smile scenario reuses it with the flag flipped.
  const domainInput = useMemo(() => {
    if (!inputsValid) return null;
    return {
      monthlyExpenses,
      withdrawalRatePct,
      currentAge,
      retirementAge,
      planningAge: parseNumber(persisted.planningAgeText) ?? 95,
      generalInflationPct,
      healthcareInflationPct: parseNumber(persisted.healthcareInflationText) ?? 5,
      includeHealthcare: persisted.includeHealthcare,
      pre65HealthcareAnnual: parseNumber(persisted.pre65Text) ?? 18000,
      post65HealthcareAnnual: parseNumber(persisted.post65Text) ?? 6500,
      monthlySSBenefit: parseNumber(persisted.ssMonthlyText) ?? 0,
      ssClaimAge: parseNumber(persisted.ssClaimAge) ?? 67,
      ssHaircut: persisted.ssHaircut,
      monthlyRentalCashFlow: parseNumber(persisted.rentalMonthlyText) ?? 0,
    };
  }, [
    inputsValid,
    monthlyExpenses,
    withdrawalRatePct,
    currentAge,
    retirementAge,
    generalInflationPct,
    persisted.planningAgeText,
    persisted.healthcareInflationText,
    persisted.includeHealthcare,
    persisted.pre65Text,
    persisted.post65Text,
    persisted.ssMonthlyText,
    persisted.ssClaimAge,
    persisted.ssHaircut,
    persisted.rentalMonthlyText,
  ]);

  const result = useMemo(
    () => (domainInput ? computeRetirementTarget({ ...domainInput, spendingSmile: false }) : null),
    [domainInput],
  );
  const smileResult = useMemo(
    () =>
      domainInput && persisted.spendingSmile
        ? computeRetirementTarget({ ...domainInput, spendingSmile: true })
        : null,
    [domainInput, persisted.spendingSmile],
  );

  const planningAge = parseNumber(persisted.planningAgeText) ?? 95;

  const selectAllocation = (id) => {
    const profile = allocationProfileById(id);
    update({ allocationId: id, withdrawalRateText: profile ? String(profile.withdrawalRatePct) : persisted.withdrawalRateText });
  };

  const toggleChecklist = (key) =>
    update({ checklist: { ...persisted.checklist, [key]: !persisted.checklist[key] } });

  const emergencyTarget = monthlyExpenses != null ? monthlyExpenses * 6 : null;

  const showHeadline = result != null && result.requiredNestEgg != null && Number.isFinite(result.requiredNestEgg);

  // Historical backtest: replay this plan through every real retirement start
  // year in the Shiller dataset. Real dollars on both sides (the series are
  // real total returns), so no inflation math is needed here.
  const backtest = useMemo(() => {
    if (!showHeadline) return null;
    const profile = allocationProfileById(persisted.allocationId);
    return backtestRetirement({
      nestEgg: result.requiredNestEgg,
      annualWithdrawal: result.portfolioNeedAnnual,
      stockPct: profile?.stockPct ?? 0.6,
      horizonYears: planningAge - retirementAge,
      data: shillerAnnual,
    });
  }, [showHeadline, result, persisted.allocationId, planningAge, retirementAge]);

  const showSmileHeadline =
    showHeadline &&
    persisted.spendingSmile &&
    smileResult != null &&
    smileResult.requiredNestEgg != null &&
    Number.isFinite(smileResult.requiredNestEgg);

  // Smile backtest: the smile nest egg funded by a declining real-withdrawal
  // path — the historically honest validation of the smaller number.
  const backtestSmile = useMemo(() => {
    if (!showSmileHeadline) return null;
    const profile = allocationProfileById(persisted.allocationId);
    return backtestRetirement({
      nestEgg: smileResult.requiredNestEgg,
      annualWithdrawal: smileResult.portfolioNeedAnnual,
      stockPct: profile?.stockPct ?? 0.6,
      horizonYears: planningAge - retirementAge,
      spendingDeclinePct: SPENDING_SMILE_DECLINE_PCT,
      data: shillerAnnual,
    });
  }, [showSmileHeadline, smileResult, persisted.allocationId, planningAge, retirementAge]);

  // Milestone timeline: year-by-year balance projection at the allocation's
  // long-run average real return (derived from the Shiller dataset — never
  // invented), with milestone dots. The smile scenario reuses the declining
  // withdrawal path so both lines match their headlines.
  const timelineFlat = useMemo(() => {
    if (!showHeadline) return null;
    const profile = allocationProfileById(persisted.allocationId);
    return projectRetirementTimeline({
      retirementAge,
      planningAge,
      retirementYear: result.retirementYear,
      nestEgg: result.requiredNestEgg,
      annualWithdrawal: result.portfolioNeedAnnual,
      stockPct: profile?.stockPct ?? 0.6,
      data: shillerAnnual,
    });
  }, [showHeadline, result, persisted.allocationId, planningAge, retirementAge]);

  const timelineSmile = useMemo(() => {
    if (!showSmileHeadline) return null;
    const profile = allocationProfileById(persisted.allocationId);
    return projectRetirementTimeline({
      retirementAge,
      planningAge,
      retirementYear: smileResult.retirementYear,
      nestEgg: smileResult.requiredNestEgg,
      annualWithdrawal: smileResult.portfolioNeedAnnual,
      stockPct: profile?.stockPct ?? 0.6,
      spendingDeclinePct: SPENDING_SMILE_DECLINE_PCT,
      data: shillerAnnual,
    });
  }, [showSmileHeadline, smileResult, persisted.allocationId, planningAge, retirementAge]);

  const milestones = useMemo(() => {
    if (!inputsValid) return [];
    return deriveRetirementMilestones({
      currentAge,
      retirementAge,
      planningAge,
      ssClaimAge: parseNumber(persisted.ssClaimAge) ?? 67,
      monthlySSBenefit: parseNumber(persisted.ssMonthlyText) ?? 0,
      mortgagePayoffAge: parseNumber(persisted.mortgagePayoffAgeText),
    });
  }, [
    inputsValid,
    currentAge,
    retirementAge,
    planningAge,
    persisted.ssClaimAge,
    persisted.ssMonthlyText,
    persisted.mortgagePayoffAgeText,
  ]);

  return (
    <section aria-labelledby="retirement-number-heading" className="mt-6 rounded-3xl border bg-white p-5 shadow-sm dark:bg-slate-900 sm:p-6 border-slate-200 dark:border-slate-800">
      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-600 dark:text-sky-400">Retire</p>
      <h2 id="retirement-number-heading" className="mt-1 text-xl font-black text-slate-950 dark:text-slate-50">
        Your retirement number
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        The 4%-rule nest egg that funds your spending — with your real expenses, pulled straight from this budget.
      </p>

      {/* Headline — both numbers side by side when the smile is on, so the
          research assumption is a comparison, never a hidden optimism dial. */}
      <div className="mt-4">
        {showHeadline ? (
          showSmileHeadline ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-950 px-5 py-6 text-center dark:bg-slate-950/60 dark:ring-1 dark:ring-slate-800">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    Flat real spending
                  </p>
                  <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-white sm:text-4xl">
                    {wholeDollars.format(result.requiredNestEgg)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">conservative</p>
                </div>
                <div className="rounded-2xl bg-sky-950 px-5 py-6 text-center ring-1 ring-sky-800 dark:bg-sky-950/60">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-300">
                    Spending smile
                  </p>
                  <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-white sm:text-4xl">
                    {wholeDollars.format(smileResult.requiredNestEgg)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-sky-400/80">research-based · Blanchett/Kitces</p>
                </div>
              </div>
              <p className="mt-2 text-center text-xs font-semibold text-slate-400">
                in {result.retirementYear} dollars · funds spending to age {planningAge}
              </p>
            </>
          ) : (
            <div className="rounded-2xl bg-slate-950 px-5 py-6 text-center dark:bg-slate-950/60 dark:ring-1 dark:ring-slate-800">
              <p className="text-4xl font-black tabular-nums tracking-tight text-white sm:text-5xl">
                {wholeDollars.format(result.requiredNestEgg)}
              </p>
              <p className="mt-2 text-xs font-semibold text-slate-400">
                in {result.retirementYear} dollars · funds spending to age {planningAge}
              </p>
            </div>
          )
        ) : (
          <div className="rounded-2xl bg-slate-950 px-5 py-6 text-center dark:bg-slate-950/60 dark:ring-1 dark:ring-slate-800">
            <p className="text-4xl font-black tracking-tight text-slate-500">—</p>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              {!ageValid
                ? "Enter your current age below to see your number."
                : "Fill in the inputs below — no guesses are made for you."}
            </p>
          </div>
        )}
      </div>

      {/* Historical backtest — second headline; dual figures with the smile */}
      {showHeadline ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          {backtest?.survivalPct == null ? (
            <>
              <p className="text-center text-2xl font-black tabular-nums text-slate-400">—</p>
              <p className="mt-1 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                Not enough history to backtest a {backtest?.horizonYears ?? "—"}-year horizon.
              </p>
            </>
          ) : showSmileHeadline && backtestSmile?.survivalPct != null ? (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <SurvivalFigure
                  label="Flat real spending"
                  survivalPct={backtest.survivalPct}
                  note="would have survived"
                />
                <SurvivalFigure
                  label="Spending smile"
                  survivalPct={backtestSmile.survivalPct}
                  note="would have survived"
                />
              </div>
              <p className="mt-2 text-center text-[11px] font-medium text-slate-500 dark:text-slate-500">
                of {backtest.windowsTested} historical {backtest.horizonYears}-year retirements,{" "}
                {shillerAnnual.years[0]}–{shillerAnnual.years[shillerAnnual.years.length - 1]} ·
                Historical stress-test: past returns don&apos;t predict the future.
              </p>
            </>
          ) : (
            <>
              <p className="text-center text-2xl font-black tabular-nums text-slate-900 dark:text-slate-50">
                Would have survived{" "}
                <span className="text-sky-600 dark:text-sky-400">{backtest.survivalPct}%</span>
              </p>
              <p className="mt-1 text-center text-xs font-semibold text-slate-600 dark:text-slate-400">
                of {backtest.windowsTested} historical {backtest.horizonYears}-year retirements
              </p>
              <p className="mt-1 text-center text-[11px] font-medium text-slate-500 dark:text-slate-500">
                {shillerAnnual.years[0]}–{shillerAnnual.years[shillerAnnual.years.length - 1]} · worst
                starting years:{" "}
                {backtest.worstStarts.length > 0
                  ? backtest.worstStarts.join(", ")
                  : "none — every window survived"}{" "}
                · Historical stress-test: past returns don&apos;t predict the future.
              </p>
            </>
          )}
        </div>
      ) : null}

      {/* Milestone timeline — year-by-year balance projection with milestone dots */}
      {showHeadline && timelineFlat?.years?.length ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Milestone timeline</p>
          <div className="mt-2">
            <RetirementTimelineChart
              flat={timelineFlat}
              smile={persisted.spendingSmile ? timelineSmile : null}
              milestones={milestones}
              currentAge={currentAge}
              retirementAge={retirementAge}
              planningAge={planningAge}
              smileOn={persisted.spendingSmile && timelineSmile != null}
            />
          </div>
          {timelineFlat.exhaustedAt != null ? (
            <p className="mt-2 text-center text-xs font-bold text-amber-600 dark:text-amber-400">
              At the historical-average return, the flat path runs out at age {timelineFlat.exhaustedAt} —
              the survival % above is the honest stress test.
            </p>
          ) : null}
          <p className="mt-2 text-center text-[11px] font-medium text-slate-500 dark:text-slate-500">
            Projected at the long-run average real return of your allocation (
            {timelineFlat.avgRealReturnPct}%/yr) — a historical average, not a promise.
            Pre-retirement savings growth isn&apos;t modeled. A generic planning estimate,
            never personalized advice.
          </p>
        </div>
      ) : null}

      {/* Simple inputs */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative">
          <NumberField
            label="Monthly expenses"
            value={persisted.expensesText}
            onChange={(value) => update({ expensesText: value })}
            badge={usingBudgetAuto && budgetAuto != null ? "from your personal budget" : null}
            min="0"
            step="50"
            hint={
              usingBudgetAuto
                ? budgetAuto != null
                  ? `Using ${wholeDollars.format(budgetAuto)}/mo from your planned budget — type to override.`
                  : "No planned budget yet — type your monthly spending."
                : "Typed override — clear the field to return to the budget value."
            }
          />
          {!usingBudgetAuto ? (
            <button
              type="button"
              onClick={() => update({ expensesText: "" })}
              className="absolute right-2 top-7 rounded-lg px-2 py-1 text-[11px] font-bold text-sky-600 hover:bg-sky-50 dark:text-sky-400 dark:hover:bg-sky-950/40"
            >
              Reset to budget
            </button>
          ) : null}
        </div>
        <NumberField
          label="Withdrawal %"
          value={persisted.withdrawalRateText}
          onChange={(value) => update({ withdrawalRateText: value })}
          min="0.5"
          step="0.25"
          hint="Assumption — set by the allocation picker below, still editable."
        />
        <NumberField
          label="Current age"
          value={persisted.currentAgeText}
          onChange={(value) => update({ currentAgeText: value })}
          min="1"
          step="1"
          inputMode="numeric"
          hint={!ageValid ? "Required — the number stays blank until you enter this." : null}
        />
        <NumberField
          label="Retirement age"
          value={persisted.retirementAgeText}
          onChange={(value) => update({ retirementAgeText: value })}
          min="1"
          step="1"
          inputMode="numeric"
        />
        <NumberField
          label="Inflation %"
          value={persisted.inflationText}
          onChange={(value) => update({ inflationText: value })}
          min="0"
          step="0.25"
          hint="Assumption — general prices, 2–3% is the long-run consensus."
        />
      </div>

      {/* Allocation picker */}
      <div className="mt-5">
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Allocation — picks your withdrawal assumption</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Allocation profile">
          {ALLOCATION_PROFILES.map((profile) => {
            const selected = persisted.allocationId === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectAllocation(profile.id)}
                className={`rounded-2xl border p-3 text-left transition ${
                  selected
                    ? "border-sky-500 bg-sky-50 ring-2 ring-sky-500/30 dark:border-sky-500 dark:bg-sky-950/40"
                    : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600"
                }`}
              >
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">{profile.label}</p>
                <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">{profile.mix}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-500">{profile.historicalBand}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          Historical averages, not promises — not a recommendation.
        </p>
      </div>

      {/* Levers */}
      {showHeadline ? (
        <div className="mt-5">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">What moves the number</p>
          <div className="mt-2 space-y-1.5">
            <LeverRow label="Retire 2 years later" delta={result.levers.retireLater2} />
            <LeverRow label="Spend $200/mo less" delta={result.levers.spendLess200} />
            <LeverRow label="Claim Social Security at 70" delta={result.levers.ssAt70} />
          </div>
        </div>
      ) : null}

      {/* Advanced */}
      <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => update({ advancedOpen: !persisted.advancedOpen })}
          aria-expanded={persisted.advancedOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-black text-slate-800 dark:text-slate-200">Advanced assumptions</span>
          <span className="text-slate-400" aria-hidden="true">
            {persisted.advancedOpen ? "▾" : "▸"}
          </span>
        </button>
        {persisted.advancedOpen ? (
          <div className="space-y-5 border-t border-slate-200 px-4 py-4 dark:border-slate-800">
            {/* Spending path */}
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Spending path in retirement</p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Spending path">
                {[
                  {
                    value: false,
                    title: "Flat real spending",
                    desc: "Conservative — same buying power every year.",
                  },
                  {
                    value: true,
                    title: "Spending smile",
                    desc: "Research-based — real spending falls ~1%/yr (Blanchett/Kitces).",
                  },
                ].map((option) => {
                  const selected = persisted.spendingSmile === option.value;
                  return (
                    <button
                      key={option.title}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update({ spendingSmile: option.value })}
                      className={`rounded-2xl border p-3 text-left transition ${
                        selected
                          ? "border-sky-500 bg-sky-50 ring-2 ring-sky-500/30 dark:border-sky-500 dark:bg-sky-950/40"
                          : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600"
                      }`}
                    >
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100">{option.title}</p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">{option.desc}</p>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Generic research assumption, not advice — both numbers are always shown side by side for
                comparison.
              </p>
            </div>

            {/* Healthcare */}
            <div>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={persisted.includeHealthcare}
                  onChange={(event) => update({ includeHealthcare: event.target.checked })}
                  className="h-4 w-4 rounded accent-sky-600"
                />
                Include healthcare costs
              </label>
              {persisted.includeHealthcare ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <NumberField
                    label="Pre-65 healthcare /yr"
                    value={persisted.pre65Text}
                    onChange={(value) => update({ pre65Text: value })}
                    min="0"
                    step="500"
                    hint="ACA/COBRA bridge — HealthView reference figure, replace with your estimate."
                  />
                  <NumberField
                    label="Post-65 healthcare /yr"
                    value={persisted.post65Text}
                    onChange={(value) => update({ post65Text: value })}
                    min="0"
                    step="500"
                    hint="T. Rowe Price median, per person — replace with your estimate."
                  />
                  <NumberField
                    label="Healthcare inflation %"
                    value={persisted.healthcareInflationText}
                    onChange={(value) => update({ healthcareInflationText: value })}
                    min="0"
                    step="0.5"
                    hint="Assumption — healthcare has run ~6%/yr vs ~3% general."
                  />
                </div>
              ) : null}
              {persisted.includeHealthcare && showHeadline ? (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  At 65, the post-65 cost is about {wholeDollars.format(result.post65At65)}/yr in nominal dollars.
                </p>
              ) : null}
            </div>

            {/* Social Security */}
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Social Security</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField
                  label="Monthly benefit at 67"
                  value={persisted.ssMonthlyText}
                  onChange={(value) => update({ ssMonthlyText: value })}
                  min="0"
                  step="50"
                  hint="In today's dollars — your SSA statement number."
                />
                <label className="block">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Claim age</span>
                  <select
                    className={`mt-1 ${inputClassName}`}
                    value={persisted.ssClaimAge}
                    onChange={(event) => update({ ssClaimAge: event.target.value })}
                  >
                    <option value="62">62 (reduced)</option>
                    <option value="67">67 (full)</option>
                    <option value="70">70 (max)</option>
                  </select>
                  <span className="mt-1 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    62 → 70% · 67 → 100% · 70 → 124%. Assumed to keep pace with inflation.
                  </span>
                </label>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={persisted.ssHaircut}
                  onChange={(event) => update({ ssHaircut: event.target.checked })}
                  className="h-4 w-4 rounded accent-sky-600"
                />
                Assume 75% of promised benefit (trust-fund haircut)
              </label>
            </div>

            {/* Rental income */}
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Rental income</p>
              <div className="mt-3 max-w-sm">
                <NumberField
                  label="Monthly rental cash flow in retirement"
                  value={persisted.rentalMonthlyText}
                  onChange={(value) => update({ rentalMonthlyText: value })}
                  min="0"
                  step="100"
                  hint="Your rentals are your pension — in today's dollars."
                />
              </div>
            </div>

            {/* Planning age */}
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Planning horizon</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="max-w-sm">
                  <NumberField
                    label="Plan spending to age"
                    value={persisted.planningAgeText}
                    onChange={(value) => update({ planningAgeText: value })}
                    min="1"
                    step="1"
                    inputMode="numeric"
                    hint="Assumption — Fidelity plans to 96."
                  />
                </div>
                <div className="max-w-sm">
                  <NumberField
                    label="Mortgage paid off at age"
                    value={persisted.mortgagePayoffAgeText}
                    onChange={(value) => update({ mortgagePayoffAgeText: value })}
                    min="1"
                    step="1"
                    inputMode="numeric"
                    hint="Optional — adds a milestone dot on the timeline."
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Sequencing checklist */}
      <div className="mt-5">
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Before you fund the number</p>
        <div className="mt-2 space-y-1.5">
          {[
            {
              key: "emergency",
              label: "Emergency fund covered",
              detail:
                emergencyTarget != null
                  ? `Target: 6 months of expenses = ${wholeDollars.format(emergencyTarget)}`
                  : "Target: 6 months of expenses",
            },
            {
              key: "debt",
              label: "High-interest debt handled",
              link: { href: "/forge/financial#debt-payoff", text: "Open the debt payoff optimizer →" },
            },
            { key: "fund", label: "Fund this number" },
          ].map((item) => (
            <div
              key={item.key}
              className="flex items-start gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60"
            >
              <input
                type="checkbox"
                checked={persisted.checklist[item.key] ?? false}
                onChange={() => toggleChecklist(item.key)}
                aria-label={item.label}
                className="mt-1 h-4 w-4 rounded accent-sky-600"
              />
              <div>
                <p
                  className={`text-sm font-semibold ${
                    persisted.checklist[item.key]
                      ? "text-slate-400 line-through dark:text-slate-500"
                      : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {item.label}
                </p>
                {item.detail ? (
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{item.detail}</p>
                ) : null}
                {item.link ? (
                  <Link
                    href={item.link.href}
                    className="text-[11px] font-bold text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {item.link.text}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Education blurb */}
      <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-400">
        Higher expected return comes with higher risk — the allocation picker sets the withdrawal-rate{" "}
        <em>assumption</em>, it doesn&apos;t promise a return. This is a generic planning estimate, never
        personalized advice. Deeper lessons are coming in the investing classroom.
      </p>
    </section>
  );
}
