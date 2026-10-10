"use client";
import { useState } from "react";

// The only two calculators in the Rental Manager education section, ported
// 1:1 from the researched "Finding the Money" page (forge-ai-drop
// results/muse/rental-education-content-2026-10-10). Formulas, bands, guard
// messages, and default values are the page's own; results compute on button
// click only, in memory — nothing is saved or sent.

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const CALC_CLASS =
  "space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-800/60";
const GRID_CLASS = "grid gap-3 sm:grid-cols-2";
const LABEL_CLASS = "mb-1 block text-[13px] font-bold";
const INPUT_CLASS =
  "w-full rounded-xl border border-slate-300 bg-white p-2.5 text-base text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
const BUTTON_CLASS =
  "rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-black text-white hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300";
const RESULT_CLASS =
  "rounded-xl border border-slate-200 bg-white p-4 text-[15px] leading-relaxed dark:border-slate-700 dark:bg-slate-900";
const SRC_CLASS = "text-xs leading-relaxed text-slate-500 dark:text-slate-400";

function bandBadge(band) {
  if (!band) return null;
  const tone =
    band.tone === "good"
      ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200"
      : band.tone === "bad"
        ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
        : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`ml-2 inline-block rounded-full px-2.5 py-0.5 align-middle text-xs font-black ${tone}`}>
      {band.text}
    </span>
  );
}

export function DtiCalculator() {
  const [income, setIncome] = useState("10000");
  const [debts, setDebts] = useState("3200");
  const [rent, setRent] = useState("2000");
  const [pitia, setPitia] = useState("1700");
  const [result, setResult] = useState(null);

  function calculate() {
    const inc = parseFloat(income) || 0;
    const monthlyDebts = parseFloat(debts) || 0;
    const monthlyRent = parseFloat(rent) || 0;
    const monthlyPitia = parseFloat(pitia) || 0;
    if (inc <= 0) {
      setResult({ error: "Enter a gross monthly income above $0." });
      return;
    }
    const anri = monthlyRent * 0.75 - monthlyPitia;
    const before = (monthlyDebts / inc) * 100;
    const addedDebt = anri < 0 ? -anri : 0;
    const after = ((monthlyDebts + addedDebt) / inc) * 100;
    const band =
      after <= 36
        ? { tone: "good", text: "within 36% manual range" }
        : after <= 45
          ? { tone: "mid", text: "36–45%: needs strong credit/reserves (manual) or DU" }
          : after <= 50
            ? { tone: "mid", text: "45–50%: DU only, fragile — lender overlays vary" }
            : { tone: "bad", text: "above the 50% DU maximum in the cited guide" };
    setResult({ before, after, anri, pitia: monthlyPitia, band });
  }

  return (
    <div className={CALC_CLASS} aria-label="DTI calculator">
      <h3 className="text-lg font-black">Try it: what does one more door do to your DTI?</h3>
      <p className="text-[13px] text-slate-600 dark:text-slate-300">
        Uses the report&rsquo;s formulas only: qualifying rental income = rent × 75% − PITIA; a negative
        result is added to your debts. In-memory only — nothing is saved or sent.
      </p>
      <div className={GRID_CLASS}>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dti-income">
            Gross monthly income ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dti-income"
            min="0"
            value={income}
            onChange={(event) => setIncome(event.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dti-debts">
            Current monthly debts incl. your home PITIA ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dti-debts"
            min="0"
            value={debts}
            onChange={(event) => setDebts(event.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dti-rent">
            New property monthly rent ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dti-rent"
            min="0"
            value={rent}
            onChange={(event) => setRent(event.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dti-pitia">
            New property PITIA ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dti-pitia"
            min="0"
            value={pitia}
            onChange={(event) => setPitia(event.target.value)}
          />
        </div>
      </div>
      <button className={BUTTON_CLASS} type="button" onClick={calculate}>
        Calculate new DTI
      </button>
      <div className={RESULT_CLASS} aria-live="polite">
        {result === null ? (
          "Enter your numbers and calculate."
        ) : result.error ? (
          result.error
        ) : (
          <>
            DTI before: <b>{result.before.toFixed(1)}%</b> → after this property:{" "}
            <b>{result.after.toFixed(1)}%</b>
            {bandBadge(result.band)}
            <br />
            {result.anri >= 0 ? (
              <>
                Qualifying rental income is +{fmt(result.anri)}/mo. With under 12 months of landlord
                experience it may only offset PITIA, not add income — so this calculator conservatively
                treats a positive result as $0 of new debt rather than new income.
              </>
            ) : (
              <>
                Qualifying rental result is {fmt(result.anri)}/mo — a loss, so {fmt(-result.anri)}/mo is
                added to your debts.
              </>
            )}
            <br />
            <span className="text-[13px]">
              Rent must reach ~1.33× PITIA ({fmt((result.pitia * 4) / 3)} at this PITIA) before it adds
              qualifying income. Reserves (6 months PITIA + 2%/4%/6% of other balances) and the
              10-financed-property cap apply separately.
            </span>
          </>
        )}
      </div>
      <p className={SRC_CLASS}>
        Worked example from the report: $120k W-2 ($10,000/mo), $3,200/mo existing debts = 32% DTI.
        Rentals at $2,000 rent / $1,700 PITIA each qualify at −$200/mo each: DTI goes 34% → 38% (3
        doors) → <strong>42% at 5 doors</strong> — before the next loan&rsquo;s own negative ANRI.
      </p>
    </div>
  );
}

export function DscrCalculator() {
  const [rent, setRent] = useState("2900");
  const [pitia, setPitia] = useState("2710");
  const [result, setResult] = useState(null);

  function calculate() {
    const monthlyRent = parseFloat(rent) || 0;
    const monthlyPitia = parseFloat(pitia) || 0;
    if (monthlyPitia <= 0) {
      setResult({ error: "Enter a PITIA above $0." });
      return;
    }
    const d = monthlyRent / monthlyPitia;
    const band =
      d < 1.0
        ? { tone: "bad", text: "below 1.00 — “no-ratio” territory (30%+ down, higher rate) if offered at all" }
        : d < 1.2
          ? { tone: "mid", text: "1.00–1.19 — within the typical 1.00–1.25 minimum band, pricing usually less favourable" }
          : { tone: "good", text: "~1.20–1.25+ — where best pricing typically sits in the cited ranges" };
    setResult({ rent: monthlyRent, pitia: monthlyPitia, d, band });
  }

  return (
    <div className={CALC_CLASS} aria-label="DSCR calculator">
      <h3 className="text-lg font-black">Try it: your property&rsquo;s DSCR</h3>
      <div className={GRID_CLASS}>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dscr-rent">
            Monthly rent ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dscr-rent"
            min="0"
            value={rent}
            onChange={(event) => setRent(event.target.value)}
          />
        </div>
        <div>
          <label className={LABEL_CLASS} htmlFor="education-dscr-pitia">
            Monthly PITIA incl. HOA ($)
          </label>
          <input
            className={INPUT_CLASS}
            type="number"
            id="education-dscr-pitia"
            min="1"
            value={pitia}
            onChange={(event) => setPitia(event.target.value)}
          />
        </div>
      </div>
      <button className={BUTTON_CLASS} type="button" onClick={calculate}>
        Calculate DSCR
      </button>
      <div className={RESULT_CLASS} aria-live="polite">
        {result === null ? (
          "Enter rent and PITIA and calculate."
        ) : result.error ? (
          result.error
        ) : (
          <>
            DSCR = {fmt(result.rent)} ÷ {fmt(result.pitia)} = <b>{result.d.toFixed(2)}</b>
            {bandBadge(result.band)}
            <br />
            <span className="text-[13px]">
              Remember: DSCR 1.00 is not cash flow — vacancy, repairs, capex, and management sit below
              this line. The appraiser&rsquo;s market rent (Form 1007), not your pro forma, may be what
              counts.
            </span>
          </>
        )}
      </div>
      <p className={SRC_CLASS}>
        Bands from the report: below 1.00 may need a “no-ratio” structure with 30%+ down; 1.00–1.19
        often qualifies with less favourable pricing; ~1.20–1.25+ is where best pricing typically sits.
        These are market ranges, not approval guarantees — and DSCR ignores vacancy, repairs, capex, and
        management.
      </p>
    </div>
  );
}
