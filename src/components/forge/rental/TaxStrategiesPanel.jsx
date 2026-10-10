"use client";
import { useState } from "react";

// Rental Manager education: "8 Tax Strategies to Reduce Your Income Taxes".
// Ported faithfully from the researched content package (forge-ai-drop
// results/muse/rental-education-content-2026-10-10/tax-strategies-page.html)
// into the Rental Manager design system. Educational only — the disclaimers
// at the top and bottom of the page are part of the content and stay.
// Interactive scope is exactly the package's own: the strategy filter below.
// No user data, no forms, no personalized tax determination.

const STRATEGY_FILTERS = [
  { id: "all", label: "All 8" },
  { id: "advance", label: "Plan in advance" },
  { id: "filing", label: "Decided at filing" },
  { id: "exit", label: "Exit & sale" },
  { id: "family", label: "Family & home" },
];

const FILTER_LABELS = {
  all: "Showing all 8 strategies, in ranked order.",
  advance: "Strategies that must be planned in advance or during the year — they cannot be fixed at filing time.",
  filing: "Strategies that can still be decided at filing time.",
  exit: "Strategies that protect you at sale or exit.",
  family: "Strategies that run through your family or your home.",
};

// The data-tags of the eight strategy cards, in ranked order (mirrors the
// card markup below so the count line matches what the filter shows).
const CARD_TAGS = [
  "advance",
  "advance",
  "filing advance",
  "advance exit",
  "advance exit family",
  "advance family",
  "advance family",
  "advance",
];

export default function TaxStrategiesPanel() {
  const [activeFilter, setActiveFilter] = useState("all");
  const visibleCount = CARD_TAGS.filter(
    (tags) => activeFilter === "all" || tags.split(" ").includes(activeFilter),
  ).length;
  const filterSummary = `${FILTER_LABELS[activeFilter]} (${visibleCount} of 8)`;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">FORGE · Rental Manager › <b>Tax Strategies</b></div>
        <div className="rounded-full border border-slate-300 px-3 py-1 text-xs font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300">US federal · Tax years 2025–2026 · As of Oct 10, 2026</div>
      </div>
      <header className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">8 Tax Strategies to Reduce Your Income Taxes</h1>
        <p className="max-w-3xl text-base leading-relaxed text-slate-600 dark:text-slate-300 mb-3 last:mb-0">Tax preparation reports completed transactions; <strong>proactive tax planning</strong> evaluates strategies before relevant deadlines — CPAs, enrolled agents, tax attorneys, and other qualified professionals may offer either or both services. Below are the eight strategies that matter most for a small-to-mid landlord, ranked by potential cash impact, how widely they apply, and how well they hold up on audit.</p>
        <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"><b>Educational information only — this is not tax advice.</b> FORGE is not a tax professional, and nothing on this page is a recommendation for your return. Every strategy here must be assessed by <b>your own tax professional for your situation</b> before you use it — eligibility turns on facts (hours, entities, income, state) that only they can weigh. Federal rules as researched Oct 10, 2026; state conformity varies and is out of scope. Several of these plays cannot be fixed after the year ends.</div>
      </header>
      <section aria-labelledby="frame-h" className="space-y-3 rounded-2xl border border-slate-200 border-l-4 border-l-sky-600 bg-white p-5 shadow-sm dark:border-slate-700 dark:border-l-sky-400 dark:bg-slate-900"><h2 id="frame-h" className="text-sm font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Who this is written for</h2> <p className="mb-3 leading-relaxed last:mb-0">The typical reader here runs a few rentals — often starting with a <strong>house hack: a personal (owner-occupied) loan on a 1–4 unit property, living in one unit and renting the others.</strong> That setup is in scope for this whole section, alongside conventional non-owner-occupied rentals.</p> <p className="mb-3 leading-relaxed last:mb-0">Tax-wise, the IRS treats that building as <strong>two assets</strong>: your personal residence and rental real estate. Shared costs — mortgage interest, taxes, insurance, the roof — are split by a reasonable method (square footage, room count, or, for comparable units, per-unit — a 4-plex with one owner unit often lands at 75% rental / 25% personal). Only the rental share is depreciated and reported on Schedule E; the personal share of interest and taxes goes on Schedule A only if you itemize, and the personal share of insurance, utilities, and repairs is simply nondeductible. Each strategy below carries a house-hack note where living in one unit changes the answer — including the two spots people most often get wrong: <strong>§121 (the home-sale exclusion) applies only to the unit you live in, not the whole building, and the “REPS covered” spouse tests are two different hour counts, not one.</strong></p> <span className="block rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"><span aria-hidden="true" className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-500 align-middle"></span> Worked example (4-plex, equal units, $600k purchase, land 20%): rental building basis $360k → $13,091/yr depreciation; rents $64,800/yr against $32,400 of rental-share expenses ≈ $19,309 of Schedule E income before any cost segregation. Sold after 5 years for $800k (assuming $40k of selling costs, a 5% load): the owner-unit gain of $40k is excludable under §121 if the 2-of-5 tests are met, while the rental units&apos; $185,455 gain splits into $65,455 of unrecaptured §1250 (max 25%) and $120,000 of long-term gain. Without selling costs the gains would be $50,000 and $215,455 — the selling-cost assumption is doing real work here, which is exactly why exit math needs to be run before the listing, not after. Illustrative only — IRS Pubs 527, 523, 925, 936; Reg. §1.121-1(e) (allocation for separate dwelling units).</span></section>
      <section aria-labelledby="stack-h" className="space-y-4">
        <h2 id="stack-h" className="text-2xl font-black tracking-tight">Borrowing against equity: the tax facts</h2>
        <p className="text-[15px] text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">A widely discussed approach — sometimes called “buy, borrow, die” — rests on three rules. Each is true; each has a cost attached.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"><span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950">1</span><h3 className="text-lg font-black">Loan proceeds are not income</h3><p className="mb-3 leading-relaxed last:mb-0">Borrowed money is not taxable income, because debt you must repay is not income; only forgiven debt generally can be. Refinancing releases cash without a tax bill in itself.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"><span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950">2</span><h3 className="text-lg font-black">Depreciation lowers your basis</h3><p className="mb-3 leading-relaxed last:mb-0">The IRS taxes the paper number, not the cash in your account — but every dollar of depreciation deducted now reduces basis and enlarges the taxable gain or recapture later. That is why the exit matters as much as the deduction.</p></div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"><span className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-sm font-black text-white dark:bg-amber-400 dark:text-slate-950">3</span><h3 className="text-lg font-black">Tax-free is not cost-free</h3><p className="mb-3 leading-relaxed last:mb-0">Every cash-out resets the interest clock on a larger balance. At a 24% bracket, a dollar of interest still costs 76 cents after the deduction — so borrowing works when what the cash earns beats that cost, not as a habit.</p></div>
        </div>
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 mb-3 last:mb-0"><b>The trade-off, stated plainly:</b> never selling and continually harvesting equity means the lender earns interest with certainty, in all markets, while the tax saving depends on brackets, basis, and a basis step-up rule that can change. Borrowing <i>with a purpose and a payoff horizon</i> (a better property, a higher-return use, a shorter remaining hold) is a different decision from borrowing as a permanent harvesting machine. This is the same arithmetic as the mortgage myth below, run on repeat.</p>
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 mb-3 last:mb-0"><b>Why an exit plan matters:</b> heavy depreciation lowers your basis. On a later taxable sale after borrowing against the property, the tax can exceed the cash left after paying off the debt — the amount you “realize” includes debt relief, and debt is not basis. Aggressive acceleration plus leverage demands the exit be decided first: exchange (§1031), hold, or hold to a stepped-up basis. Keep reserves and a cushion on debt-service coverage (rent ÷ full payment) rather than maxing loan-to-value; investor cash-outs commonly cap around 70–75% LTV. <span className="text-slate-500 dark:text-slate-400">Sources: Bankrate (loans not taxable); District Lending / Foundry Atlas (DSCR cash-out terms — typical ranges from lender pages, not promises).</span></p>
      </section>
      <section aria-labelledby="myth-h" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"><span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Myth — not a strategy</span> <h2 id="myth-h" className="text-2xl font-black tracking-tight">“Keep the mortgage for the write-off”</h2> <p className="mb-3 leading-relaxed last:mb-0">Banks love this one. A deduction is only worth the slice of tax it avoids — you never get the dollar back. Spend $10,000 on mortgage interest and here is the actual trade:</p> <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"><div className="text-3xl font-black">−$7,600</div><div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">At a 24% bracket: $10,000 interest saves $2,400 in tax. You are still $7,600 out of pocket.</div></div> <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60"><div className="text-3xl font-black">−$6,300</div><div className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">Even at the top 37% bracket: $10,000 returns $3,700 and costs $6,300 net.</div></div></div> <p className="mb-3 leading-relaxed last:mb-0">Rental interest is genuinely deductible on Schedule E as an ordinary business expense (principal is not) — the deduction is real, it is just outweighed. Who benefits from the myth? Whoever earns the spread on your balance, collecting years of front-loaded interest while you keep the risk.</p> <p className="border-t border-dashed border-slate-200 pt-3 dark:border-slate-700 mb-3 leading-relaxed last:mb-0"><b>The correct framing:</b> borrow when the property’s return after <i>all</i> costs beats the cost of the debt and the cash released earns more elsewhere — see the borrowing notes above. Never borrow <i>for</i> the interest deduction.</p> <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: <a href="https://www.lionhoodfinancial.com/blog/the-mortgage-tax-deduction-myth-why-paying-more-interest-to-save-on-taxes-is-a-losing-game" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Lionhood Financial — the mortgage tax deduction myth</a> · <a href="https://www.fool.com/taxes/2004/03/19/buy-a-home-not-a-deduction.aspx" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Motley Fool — buy a home, not a deduction</a> (older standard-deduction figures; the marginal-rate arithmetic is unchanged).</p></section>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter strategies">
          {STRATEGY_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              data-filter={filter.id}
              aria-pressed={activeFilter === filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={
                activeFilter === filter.id
                  ? "rounded-full border border-slate-950 bg-slate-950 px-4 py-1.5 text-sm font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-amber-400 dark:bg-amber-400 dark:text-slate-950"
                  : "rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-bold hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600 dark:bg-slate-900 dark:hover:bg-slate-800"
              }
            >
              {filter.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
          {filterSummary}
        </p>
      </div>
      <div id="cards" className="grid gap-4">
        <article data-tags="advance" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">1</div>
            <div>
              <h3 className="text-lg font-black">Short-term rental loophole</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Rent by the week or less and run it yourself — paper losses can offset a salary.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance / in-year only</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Offsets W-2 income</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Pairs with #3</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> $500k STR with a $100k cost-segregation loss against wages at 24% ≈ <b>$24k saved in Year 1</b>.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — STR unit inside your own building</b><p className="mb-3 leading-relaxed last:mb-0">Yes, the STR exception can apply to a rented unit in the same building — the test runs <b>per activity, not per building</b>. A unit averaging ≤7-day stays is not a “rental activity” for §469; if you also materially participate in <i>that unit&apos;s</i> activity, its losses (supersized by cost segregation on that unit) are nonpassive against W-2 income — <b>without needing REPS</b>. Living next door makes real self-management (and provable hours) easier.</p><ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0"><li>Your own unit is a different dwelling unit: personal use of <i>your</i> unit is not personal use of the STR unit. The §280A limits switch on for the STR unit only if <i>you</i> use <i>that unit</i> beyond the greater of 14 days or 10% of its rental days.</li><li>Cleaners&apos; and managers&apos; hours count against you in the “100 hours and more than anyone else” comparison — living on-site and doing the guest-facing work yourself is what keeps the test winnable.</li><li>Allocate expenses and depreciation to the STR unit by the same reasonable method used for the rest of the building (square footage / rental value); a cost-segregation study can be run on the whole property and the accelerated piece allocated to the unit.</li></ul><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: Reg. §1.469-1T(e)(3)(ii); IRS Pub. 925 — <a href="https://www.irs.gov/publications/p925" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p925</a>; BiggerPockets forum, “Tax implications of using one unit in a multifamily property as a STR” (practitioner discussion) — <a href="https://www.biggerpockets.com/forums/51/topics/1267319-tax-implications-of-using-one-unit-in-a-multifamily-property-as-a-str" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">biggerpockets.com</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">Rentals are normally passive (§469), but Reg. §1.469-1T(e)(3)(ii) excludes an activity averaging ≤7 days of customer use (or ≤30 days with significant services) from “rental activity” altogether. If you then <b>materially participate</b>, the losses are non-passive and can offset W-2 and other active income. Usually still Schedule E — daily in-stay services like cleaning and meals can push it to Schedule C with self-employment tax. The §461(l) excess-business-loss cap still applies (see #2).</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Average stay = rental days ÷ bookings ≤ 7, per property, per year</li>
                  <li>Material participation: practically 500+ hours, or 100+ hours and more than anyone else; spouse hours count</li>
                  <li>A full-service property manager usually defeats the 100-hour test</li>
                  <li>Personal use beyond the greater of 14 days or 10% of rental days triggers vacation-home limits</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Heavily audited area: a few long bookings can break the 7-day average</li>
                  <li>Back-filled hour logs and counting other people’s hours</li>
                  <li>Claiming participation on a manager-run unit</li>
                </ul>
                <p className="mb-3 leading-relaxed last:mb-0">Keep platform booking exports and contemporaneous time logs. Local STR rules are separate from the tax question.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance / in-year only.</b> Hours and booking mix happen during the year; they cannot be created at filing time.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Exception test:</b> the activity&apos;s average period of customer use is 7 days or less — Reg. §1.469-1T(e)(3)(ii)(A) — or 30 days or less with significant personal services. Average stay = total nights rented ÷ number of stays, per property, per year; one long booking can break the average.</li>
              <li><b>Then material participation is required</b> — one of the seven Reg. §1.469-5T(a) tests for that activity: (1) &gt;500 hours; (2) your participation is substantially all participation by all individuals; (3) &gt;100 hours and not less than any other individual (cleaners and property managers count); (4) significant-participation activities aggregating &gt;500 hours; (5) material participation in any 5 of the prior 10 years; (6) personal-service activity, 3 prior years; (7) facts-and-circumstances regular, continuous, substantial participation. A spouse&apos;s participation counts as yours (§469(h)(5)).</li>
              <li><b>Investor-type work does not count</b> unless you are directly involved in day-to-day management or operations: studying statements, preparing summaries for your own use, and monitoring finances in a nonmanagerial capacity are excluded (Reg. §1.469-5T(f)(2)).</li>
              <li><b>Personal-use limit:</b> if you use the unit personally beyond the greater of 14 days or 10% of the days it is rented at fair value, §280A dwelling-unit limits switch on for that unit.</li>
              <li><b>Reporting:</b> without substantial hotel-like services (daily cleaning, meals), a qualifying STR is generally still Schedule E — reported as nonpassive when the exception plus material participation are met. Substantial in-stay services can push it to Schedule C with self-employment tax.</li>
              <li><b>Losses still face the stack of limits:</b> basis, at-risk (§465), and the §461(l) excess-business-loss cap (2025: $313k single / $626k joint; 2026: $256k / $512k), with any excess becoming a net operating loss.</li>
              <li><b>Record-keeping:</b> platform booking exports proving the average stay, plus a contemporaneous time log (date, property, task, duration) — reconstructed round-number logs are routinely rejected. Local STR licensing/zoning is separate from the tax question but outcome-determinative.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Source: IRS Publication 925 (passive-activity and material-participation framework) — <a href="https://www.irs.gov/publications/p925" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p925</a></p>
          </details>
        </article>
        <article data-tags="advance" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">2</div>
            <div>
              <h3 className="text-lg font-black">Real Estate Professional Status (REPS) + grouping election</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Make long-term rentals non-passive so their losses can offset salaries and business income.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance / in-year only</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Best with a spouse</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Enables #3 for long-term rentals</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> a qualifying spouse plus a $150k cost-segregation loss against $250k of wages at 24% ≈ <b>$36k saved</b>.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — one spouse is the real estate professional</b><p className="mb-3 leading-relaxed last:mb-0">A common setup — one spouse runs the rentals while the other keeps a W-2 job — is exactly the fact pattern §469(c)(7) rewards, with one correction to the common shorthand. It is <b>not</b> “500 hours and it has to be your primary job.” There are two separate tests, and both have to line up in the same year:</p><ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0"><li><b>REPS itself (the professional spouse&apos;s status):</b> more than <b>750 hours</b> a year in real-property trades or businesses in which that spouse materially participates, <b>and</b> more than <b>half of all the personal-service time that spouse works anywhere</b> is in those businesses. On a joint return, one spouse can satisfy both tests alone — but hours cannot be pooled: the other spouse&apos;s hours do not lift the professional spouse over 750, and the other spouse&apos;s W-2 job does not enter the “more than half” denominator. Only the qualifying spouse&apos;s <i>own</i> working time counts, which is precisely why the “one spouse runs the rentals” plan works.</li><li><b>Material participation (each rental activity):</b> the separate test where the <b>500-hour</b> figure actually lives — Reg. §1.469-5T(a)(1). The other route is 100+ hours and more than any other individual (property managers and cleaners count as “other individuals”). A spouse&apos;s participation in an activity counts as the other spouse&apos;s for this test — so the other spouse&apos;s weekend repairs do help here, even though they add nothing to the professional spouse&apos;s 750.</li><li><b>Grouping election:</b> by default each rental is its own activity. The Reg. §1.469-9(g) election treats all of the professional spouse&apos;s rental real estate as one activity, so hours across the house hack plus other rentals aggregate — 200 hours on each of four properties clears the 500-hour test once grouped, and fails on every property ungrouped. The election statement goes on the <b>original timely filed</b> return; without it on file, the Tax Court has refused to aggregate.</li></ul><p className="mb-3 leading-relaxed last:mb-0">Once one spouse qualifies, the benefit is joint: nonpassive rental losses offset the other spouse&apos;s W-2 wages on the joint return, with no $25,000 cap and no $100k–$150k phaseout. Full rules, including the time-log standard that decides these cases, are in the complete rules below.</p><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: IRC §469(c)(7); Reg. §1.469-9(c)(4) (one spouse separately satisfies both); Reg. §1.469-5T (seven material-participation tests); IRS Pub. 925 — <a href="https://www.irs.gov/publications/p925" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p925</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">§469(c)(7) removes the automatic “passive” label for qualifying real estate professionals. Losses are then usable if you also materially participate — and a Reg. §1.469-9(g) election can group all your rentals into one activity so hours aggregate across properties (the <b>grouping election</b>, an on-switch rather than a benefit of its own). The classic play: one spouse qualifies while the other keeps the W-2 job. Even then, §461(l) caps usable excess business losses — 2025: $313k single / $626k married filing jointly; <b>2026 reset: $256k / $512k</b>, permanent; the excess becomes a net operating loss.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds — both tests</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>More than <b>750 hours/year</b> in real-property trades or businesses, <b>and</b></li>
                  <li>More than <b>half of all personal-service time</b> spent in them</li>
                  <li>Employees count hours only if they own more than 5%</li>
                  <li>One spouse can satisfy REPS while both spouses’ hours count toward material participation; no license required</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Among the most-litigated positions in landlord tax</li>
                  <li>Full-time W-2 holders claiming REPS; estimated or reconstructed logs; counting a property manager’s hours</li>
                  <li>Grouping is sticky: suspended losses free up only when the <i>entire group</i> is disposed of, which complicates a single-property sale or exchange</li>
                </ul>
                <p className="mb-3 leading-relaxed last:mb-0">Contemporaneous calendars are decisive. Grouping can be redone only if the original grouping was clearly inappropriate or facts materially change.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance / in-year only</b> for the hours — they cannot be manufactured retroactively. The grouping election itself is made with the return.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>REPS test 1 — more-than-half:</b> more than half of the personal services the qualifying spouse performs in all trades or businesses during the year are performed in real-property trades or businesses in which that spouse materially participates (IRC §469(c)(7)(B)). Only the qualifying spouse&apos;s own working time is in the denominator — the other spouse&apos;s job does not count either way.</li>
              <li><b>REPS test 2 — 750 hours:</b> more than 750 hours of services during the year in those same real-property trades or businesses. Real-property trades/businesses include development, construction, acquisition, conversion, rental, operation, management, leasing, and brokerage (§469(c)(7)(C)).</li>
              <li><b>Employee hours:</b> services performed as an employee in a real-property business count toward either test only if the spouse owns more than 5% of the employer — but a non-qualifying W-2 job still counts in the more-than-half denominator. Status is redetermined every year; no license is required.</li>
              <li><b>Joint-return rule:</b> the requirements are satisfied if and only if <i>either spouse separately</i> satisfies both tests (Reg. §1.469-9(c)(4)). Hours cannot be pooled. Separately, under §469(h)(5), a spouse&apos;s participation in an <i>activity</i> is treated as the other spouse&apos;s for material participation in that activity — that helps the activity test, never the 750-hour count.</li>
              <li><b>Material participation is still required per activity</b> — one of the seven Reg. §1.469-5T(a) tests (500+ hours; substantially-all; 100+ hours and not less than anyone else; etc.). Only services in activities the spouse materially participates in count toward the 750 (Reg. §1.469-9(c)(3) circularity).</li>
              <li><b>Grouping election (Reg. §1.469-9(g)):</b> by default each rental interest is a separate activity. The election treats all rental real estate as one activity so hours aggregate. It is made by statement attached to the <b>original timely filed</b> return, binds all future qualifying years (lying dormant in non-qualifying years), and may be revoked only on a material change in facts and circumstances; Rev. Proc. 2011-34 gives late-election relief when returns were consistently filed as if it had been made. Listing several properties on one Schedule E is not an election (<i>Hailstock</i>, T.C. Memo. 2016-146). Grouping rentals with a non-rental activity is prohibited.</li>
              <li><b>What counts as participation:</b> owner-capacity day-to-day work — tenant screening and communications, leasing decisions, approving expenditures, coordinating and inspecting repairs, rent enforcement, rental bookkeeping. What does not: investor-type work (studying financial statements, preparing summaries for your own use, monitoring finances nonmanagerially), investor-education hours (courses, webinars, podcasts, conferences, researching <i>future</i> acquisitions), work not customarily done by an owner that is performed mainly to manufacture hours, and ordinary commuting.</li>
              <li><b>Record-keeping standard:</b> Reg. §1.469-5T(f)(4) allows any reasonable means — appointment books, calendars, narrative summaries — and does not expressly require contemporaneous daily logs, but reconstructed, round-number, post-audit logs are routinely rejected as not credible, especially when implausible next to another job. A defensible system: a log updated weekly (date, property/activity, task, duration, business purpose), corroboration saved with it (tenant/contractor messages, invoices approved, mileage records, statements), a tally of <i>the spouse&apos;s non-real-estate work hours</i> too (the more-than-half denominator, with pay stubs/schedules), and at least rough hours for the property manager, cleaners, and major contractors per property (to defend the 100-hours-and-not-less-than-anyone test).</li>
              <li><b>Loss limits still stack after §469:</b> basis, at-risk (§465), and §461(l) excess-business-loss (excess becomes an NOL). Grouped-disposition caveat: selling one grouped property does not release suspended losses attributable to the group until the whole grouped activity is disposed of (matters mainly in non-REPS years). Materially participated rental income of a real estate professional can also be nonpassive for the 3.8% NIIT, under its own grouping analysis.</li>
              <li><b>State warning:</b> some states do not conform — California, for example, does not conform to the federal REPS loss treatment, so a zero-federal-tax year can still carry a state bill.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS Publication 925 — <a href="https://www.irs.gov/publications/p925" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p925</a> · Anchin on §461(l) — <a href="https://www.anchin.com/articles/excess-business-loss-limitation-federal-and-state-considerations-for-real-estate-professionals/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">anchin.com</a> · The Real Estate CPA on grouping elections — <a href="https://www.therealestatecpa.com/blog/what-are-the-different-grouping-elections-when-can-i-use-them/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">therealestatecpa.com</a></p>
          </details>
        </article>
        <article data-tags="filing advance" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"filing advance".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">3</div>
            <div>
              <h3 className="text-lg font-black">Cost segregation + 100% bonus depreciation</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Split a building into fast-write-off parts and deduct much of the price in Year 1.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Mostly filing-time</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">The engine inside #1 and #2</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800"><span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Law changed 2025</span></span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> $400k purchase with $320k of building basis; reclassifying 25% = <b>$80k Year-1 deduction</b>, ≈ <b>$19k of tax deferred</b> at 24%, less the study fee. This is acceleration — earlier deductions, not extra ones.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — a study only ever covers the rented part</b><p className="mb-3 leading-relaxed last:mb-0">A cost-segregation study on a house hack is scoped to the <b>rental portion only</b>. Your own unit is never depreciable while you live in it — not even if title sits in a wholly-owned LLC and you “pay rent” to it. The mechanics: split total cost basis into land vs. building (assessor ratio, appraisal, or replacement cost), then split the building basis between rental and personal by the same allocation method you use for expenses. Only the rental building basis is depreciated (27.5-year straight line) or cost-segregated — in a 75/25 four-plex, the study accelerates 75% of the components, never 100%.</p><ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0"><li>If you later move out and rent your former unit, depreciation on it starts then, on the <b>lesser of its basis or fair market value at conversion</b>.</li><li>Skipping depreciation does not dodge recapture: basis falls by depreciation allowed <i>or allowable</i> whether you claimed it or not — you forfeit the annual deduction and keep the sale tax.</li><li>Every dollar the study accelerates on the rental share enlarges the later recapture: §1245 components come back as ordinary income, the building shell as unrecaptured §1250 (see the sale rules in #5).</li></ul><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: IRS Pub. 527 (depreciation only on the part used for rental purposes; conversion rule) — <a href="https://www.irs.gov/publications/p527" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p527</a>; BiggerPockets forum, “Depreciation and House Hacking” (practitioner discussion) — <a href="https://www.biggerpockets.com/forums/922/topics/1281321-depreciation-and-house-hacking" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">biggerpockets.com</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">A residential building normally depreciates straight-line over 27.5 years (39 for commercial); land never depreciates. A cost-segregation study reclassifies components — appliances, flooring, specialty systems (5/7-year property) and land improvements (15-year) — typically <b>20–35% of building basis</b>. Property with a life of 20 years or less qualifies for §168(k) bonus depreciation: <b>100% for property acquired after Jan 19, 2025</b>, now permanent under the 2025 law (OBBBA). A late study can catch up missed years via a §481(a) adjustment on Form 3115 without amending returns.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Who qualifies</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Any depreciable rental or business property</li>
                  <li>The deduction only pays <i>cash</i> today if the loss is usable — non-passive via #1 or #2, or within the $25k active-participation allowance (see Basics below)</li>
                  <li>Study cost: roughly $1.5–5k for small residential, $5–15k+ for larger properties (vendor ranges, not promises)</li>
                  <li>The acquisition date fixes the bonus rate; property under binding contract on or before Jan 19, 2025 stays on the old schedule, and 2023–24 property is not retroactively upgraded</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Boilerplate or inflated studies — the IRS Cost Segregation Audit Techniques Guide is the examiner’s playbook</li>
                  <li>Basis falls by depreciation allowed <i>or allowable</i>, whether you claimed it or not</li>
                  <li>On a taxable sale, short-life parts recapture as ordinary income (§1245); the building slice is unrecaptured §1250 gain, up to 25%</li>
                </ul>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Leverage warning:</b> pair acceleration with an exit plan (exchange / hold) before combining it with heavy borrowing — see the borrowing notes above.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Mostly filing-time</b>, including look-back years through Form 3115 — one of the few plays that can still be decided after the year ends.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Baseline:</b> residential rental buildings depreciate straight-line over 27.5 years (39 years commercial) under MACRS with the mid-month convention; land is never depreciable. Cost basis = purchase price plus capitalized closing costs (title/transfer, acquisition legal), split land vs. building by tax-assessor ratio, appraisal, or insurance replacement cost.</li>
              <li><b>What a study reclassifies:</b> components into 5/7-year §1245 property (appliances, carpet, fixtures, specialty systems) and 15-year land improvements — typically 20–35% of building basis. Property with a recovery period of 20 years or less qualifies for §168(k) bonus depreciation.</li>
              <li><b>Bonus rate:</b> 100% for qualified property acquired <i>and</i> placed in service after January 19, 2025, now permanent (OBBBA); property under a binding contract on or before that date stays on the old phase-down schedule; 2023–24 property is not retroactively upgraded. IRS Notice 2026-11 (Jan. 14, 2026) adds interim rules, including a transitional 40% election.</li>
              <li><b>Late studies:</b> a study done years after purchase catches up all missed depreciation in one year via a §481(a) adjustment on Form 3115 — no amended returns needed.</li>
              <li><b>Usability gate:</b> the deduction pays cash today only if the loss is usable — nonpassive via #1 or #2, or within the $25,000 active-participation allowance (Basics below). Otherwise the loss suspends and banks for passive income or sale.</li>
              <li><b>Recapture:</b> on a taxable sale, §1245 (short-life) components recapture as ordinary income; the building shell is unrecaptured §1250 gain taxed at a maximum 25%. Basis is reduced by depreciation allowed <i>or allowable</i> — skipping the deduction forfeits the benefit and keeps the recapture.</li>
              <li><b>Record-keeping:</b> an engineering-based study from a qualified provider (the IRS Cost Segregation Audit Techniques Guide is the examiner&apos;s playbook; boilerplate or inflated studies are the audit risk), the closing statement supporting basis, and the land/building split support. Study cost is itself a deductible expense.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS Audit Techniques Guides — <a href="https://www.irs.gov/businesses/small-businesses-self-employed/audit-techniques-guides-atgs" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov ATGs</a> · BDO on IRS Notice 2026-11 bonus guidance — <a href="https://www.bdo.com/insights/tax/irs-issues-interim-guidance-on-bonus-depreciation-rules" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">bdo.com</a> · PKF O’Connor Davies — <a href="https://www.pkfod.com/insights/irs-issues-guidance-on-additional-first-year-depreciation-under-obbba/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">pkfod.com</a></p>
          </details>
        </article>
        <article data-tags="advance exit" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance exit".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">4</div>
            <div>
              <h3 className="text-lg font-black">1031 like-kind exchange (DST as the hands-off variant)</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Swap one investment property for another through an intermediary and defer the entire tax — gain and recapture.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance only — before closing</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Core exit-preserver</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> sell for $600k with a $250k basis (including $120k of depreciation taken): a taxable sale runs ≈ <b>$70–95k federal</b>. A completed 1031 defers <b>all of it</b>.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — exchanging a part-home, part-rental property</b><p className="mb-3 leading-relaxed last:mb-0">The two plays combine in one disposition: under <b>Rev. Proc. 2005-14</b>, you can take a §121 exclusion on the residential (owner-unit) portion and run a §1031 exchange on the rental portion of the same sale. The rental portion must independently satisfy every §1031 rule — like-kind replacement, qualified intermediary holding the proceeds, the 45/180-day clocks. One statutory block: <b>§121 is unavailable if the property was acquired in a §1031 exchange within the prior 5 years</b>, so a property you exchanged <i>into</i> and then moved into needs a five-year hold before the exclusion is back on the table. Basis, price, and selling expenses are allocated between the portions by the same method used for depreciation — changing the method at sale is an audit flag.</p><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: Rev. Proc. 2005-14 (cited in IRS Pub. 527 — <a href="https://www.irs.gov/publications/p527" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p527</a>); IRS Pub. 523 — <a href="https://www.irs.gov/publications/p523" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p523</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">§1031 gives nonrecognition for real property held for business or investment exchanged for like-kind real property (since the TCJA, real property only — no equipment, crypto, or partnership interests). A <b>qualified intermediary</b> holds the proceeds; your basis carries over, deferring both capital gain and depreciation recapture. Cash or debt relief you keep (“boot”) is taxable. Filed on Form 8824. Exchanging serially and holding until death can convert deferral into a stepped-up basis for heirs.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>US investment/business real estate only — no personal residences, flips, or foreign property; same taxpayer on both sides</li>
                  <li><b>Identify replacements in writing within 45 days; close within 180 days</b></li>
                  <li>Equal-or-greater value and replacement debt for full deferral; 3-property / 200% / 95% identification rules</li>
                  <li>Rev. Proc. 2008-16 provides a safe harbor for rental dwellings</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">The DST variant</h4>
                <p className="mb-3 leading-relaxed last:mb-0">A Delaware Statutory Trust lets you exchange into a fractional share of a large, sponsor-run property (Rev. Rul. 2004-86) — same 45/180 mechanics, no landlord duties. Accredited investors only (generally $200k/$300k income or $1M net worth excluding residence); minimums often ~$100k. The trustee is barred from the “seven deadly sins” — no new capital, no loan renegotiation or new debt, no reinvesting sale proceeds, no new or renegotiated leases (narrow exceptions) — which also means <b>a DST cannot be re-levered</b> after the exchange. Illiquid for 5–10 years with sponsor fees and zero control.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Missed 45/180-day clocks — the #1 killer</li>
                  <li>Touching the proceeds, mortgage boot, related-party errors</li>
                  <li>Converting the replacement property to personal use too quickly</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance only.</b> The intermediary must be engaged before the first closing; this cannot be fixed at filing time.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Eligible property:</b> US real property held for productive use in a trade or business or for investment, exchanged for like-kind real property of the same character. Since the TCJA, real property only — no equipment, vehicles, crypto, or partnership interests. No personal residences, no dealer/flip property, no foreign property. The same taxpayer must be on both sides of the exchange.</li>
              <li><b>The intermediary rule:</b> a qualified intermediary must hold the sale proceeds under an exchange agreement <i>before</i> the first closing; if you touch or control the proceeds, the exchange fails. Reported on Form 8824.</li>
              <li><b>The two clocks:</b> replacement property identified in writing within <b>45 days</b> of the relinquished closing, and the exchange completed within <b>180 days</b> (or the return due date with extensions, if earlier). Identification follows the 3-property rule, the 200%-of-value rule, or the 95% rule.</li>
              <li><b>Full deferral requires</b> trading equal-or-up in value <i>and</i> replacing the debt: any cash kept or debt relief not replaced is “boot,” taxable to the extent of gain. Basis carries over into the replacement, deferring both capital gain and depreciation recapture (including §1245 ordinary recapture).</li>
              <li><b>Rental safe harbor:</b> Rev. Proc. 2008-16 gives a safe harbor for dwelling units held for investment (own at least 24 months, rent at fair value 14+ days in each 12-month period, personal use within the greater of 14 days or 10% of rental days). Converting a replacement property to personal use too quickly is a classic failure.</li>
              <li><b>Related parties:</b> exchanges with related persons carry a 2-year hold rule for both sides; a disposition within 2 years voids the deferral except for death, involuntary conversion, or non-tax-avoidance transactions.</li>
              <li><b>DST variant rules:</b> Rev. Rul. 2004-86 treats a qualifying Delaware Statutory Trust interest as real property for §1031, with identical QI/45/180 mechanics. Accredited investors only (generally $200k single / $300k joint income, or $1M net worth excluding the primary residence); minimums often ~$100k. The trustee is barred from the “seven deadly sins”: no accepting new capital, no renegotiating loans or taking new debt (narrow exceptions), no reinvesting proceeds, capital spending limited to routine/non-structural items, no new or renegotiated leases (narrow exceptions), cash distributed or held only in short-term instruments. Consequence: a DST cannot be re-levered after the exchange; expect 5–10 year illiquidity and sponsor fees.</li>
              <li><b>Endgame:</b> serial exchanges followed by holding until death can pair deferral with a §1014 stepped-up basis for heirs — the only route that makes the deferred gain (and recapture) disappear rather than come due.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS like-kind exchange tips — <a href="https://www.irs.gov/businesses/small-businesses-self-employed/like-kind-exchanges-real-estate-tax-tips" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov</a> · IRS sales/trades FAQ — <a href="https://www.irs.gov/faqs/sale-or-trade-of-business-depreciation-rentals/sales-trades-exchanges" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov FAQs</a> · DST overview — <a href="https://www.firstexchange.com/learn/articles/what-is-a-delaware-statutory-trust-and-how-does-it-work" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">firstexchange.com</a></p>
          </details>
        </article>
        <article data-tags="advance exit family" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance exit family".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">5</div>
            <div>
              <h3 className="text-lg font-black">§121 exclusion + §1031 stacking (the conversion play)</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Live in it, then rent it (or the reverse, patiently): exclude up to $250k/$500k of gain forever and defer the rest.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance — multi-year sequencing</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Only play that makes gain disappear</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> a couple lives in a home 3 years, rents it 2, then sells with a $700k gain: exclude <b>$500k tax-free</b> and 1031 the remaining $200k — current federal tax ≈ <b>$0</b> (depreciation slice aside).</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — the unit you live in is the whole ballgame</b><p className="mb-3 leading-relaxed last:mb-0">This is the most commonly botched point in popular house-hacking content, because two house-hack shapes produce opposite answers:</p><ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0"><li><b>Separate dwelling units (a true duplex / triplex / four-plex): allocation is mandatory.</b> Reg. §1.121-1(e) treats rental units as space “separate from the dwelling unit” you live in. §121 excludes gain <b>only on your unit</b>; gain on the rented units is fully taxable (split between unrecaptured §1250 up to 25% on the depreciation taken and long-term capital gain on the rest). That the building is financed and conveyed as one property does not make it one dwelling unit. A loss on your unit is nondeductible; a loss on a rental unit is generally a deductible §1231 loss.</li><li><b>Same dwelling unit (rented room, basement, attic inside your own unit): no allocation.</b> The entire gain except the depreciation carve-out can be excluded — the recapture slice is taxed regardless.</li><li>Allocate price, selling expenses, and basis using the same method you used for depreciation (Reg. §1.121-1(e)(3)); the IRS duplex example in Pub. 523 is the template. Depreciation taken (or allowable) after May 6, 1997 is <b>never</b> excludable (§121(d)(6)).</li></ul><p className="mb-3 leading-relaxed last:mb-0">Practical consequence: on a separate-unit four-plex, only roughly your-unit&apos;s share of appreciation can ever be excluded — the rental units&apos; share needs the §1031 door (#4) or a taxable sale with reserves set aside. Plan that split before you buy, not the year you sell.</p><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: Reg. §1.121-1(e); IRS Pub. 523 (duplex example; post-May 6, 1997 depreciation carve-out) — <a href="https://www.irs.gov/publications/p523" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p523</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">§121 excludes <b>$250k (single) / $500k (married filing jointly)</b> of gain on a main home you owned and used for 2 of the last 5 years (once every 2 years). Depreciation is never excludable. Rev. Proc. 2005-14 lets you stack §121 and §1031 on the same sale: exclude first, exchange the remainder — and cash taken out up to the excluded amount can be tax-free boot.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>2-of-5-year ownership <i>and</i> use as a main home; once per 2 years</li>
                  <li>Post-2008 “nonqualified use” proration shrinks the exclusion for rental periods <i>before</i> you move in; renting <i>after</i> your last use as a home, within the 5-year window, is not nonqualified use</li>
                  <li>Property acquired in a 1031 must be held 5 years before §121 applies; Rev. Proc. 2008-16 gives a conversion safe harbor</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Miscounting nonqualified-use years</li>
                  <li>Selling after the 5-year window closes</li>
                  <li>Forgetting the depreciation slice stays taxable</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance, over multiple years.</b> The whole strategy is sequencing occupancy before the sale.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>The exclusion:</b> $250,000 of gain (single) / $500,000 (married filing jointly) on the sale of a main home, if you owned it and used it as your main home for periods aggregating 2 years (24 months, not necessarily consecutive) out of the 5 years before the sale, and you have not used §121 on another sale within the prior 2 years. Partial exclusions exist for sales driven by a change in employment, health, or unforeseen circumstances.</li>
              <li><b>Depreciation is never excludable:</b> gain attributable to depreciation after May 6, 1997 is taxed as unrecaptured §1250 (max 25%) — §121(d)(6). Cost-segregated §1245 components recapture as ordinary income.</li>
              <li><b>Nonqualified use (§121(b)(5)):</b> periods after 2008 when the property was not used as a main home generally shrink the exclusion pro-rata — but renting the property <i>after</i> your last use as a main home, within the 5-year window, is not nonqualified use. Rental periods <i>before</i> you move in are the ones that cost you.</li>
              <li><b>Multi-unit allocation (Reg. §1.121-1(e)):</b> where part of the property is separate from your dwelling unit (rented units in a 2–4 plex), gain is allocated between the residential and rental portions using the same method used for depreciation; only the residential portion is excludable. Portions within the same dwelling unit (rented room, basement) require no allocation. Residential portion reports on Form 8949/Schedule D; rental portion and recapture on Form 4797.</li>
              <li><b>Stacking (Rev. Proc. 2005-14):</b> on a sale that qualifies for both, apply §121 first, then exchange the remainder under §1031 with a qualified intermediary and the 45/180-day clocks; cash taken out up to the amount of gain excluded can be received as tax-free boot.</li>
              <li><b>The 5-year hold after an exchange:</b> property acquired in a §1031 exchange must be held 5 years before §121 applies (§121(d)(10)). Rev. Proc. 2008-16 provides the conversion safe harbor (24-month qualifying use on each side).</li>
              <li><b>Record-keeping:</b> closing statements from purchase and sale, proof of use as a main home across the 5-year window (licenses, voter registration, utility bills, tax-return addresses), rental-period records supporting the nonqualified-use computation, and the depreciation history (Forms 4562) that fixes the never-excludable slice.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Source: Kitces on converting rentals to a primary residence — <a href="https://www.kitces.com/blog/limits-to-converting-rental-property-into-a-primary-residence-to-plan-for-irc-section-121-capital-gains-exclusion/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">kitces.com</a></p>
          </details>
        </article>
        <article data-tags="advance family" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance family".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">6</div>
            <div>
              <h3 className="text-lg font-black">Hiring your children</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Pay your kids for real rental-business work: the business deducts it, and the kids may owe $0.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance / in-year — payroll first</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">≈ $15.8k–$16.1k sheltered per child</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> pay a child $12,000: you save ≈ <b>$2,880 at 24%</b> — plus ≈ <b>$1,836 of payroll tax</b> if the under-18 sole-proprietorship exemption applies — and the child owes <b>$0</b> federal income tax.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — no special rule, same tests</b><p className="mb-3 leading-relaxed last:mb-0">Family payroll follows the same rules in a mixed-use property. The general allocation principle from the framing section applies: wages are a rental expense only for genuine, documented work on the <b>rental</b> operation — the same bona-fide-duty, reasonable-pay, real-payroll standards in the rules below — while work on your own unit is personal and nondeductible. Treat the business-vs-chores line as a documentation question, and confirm it with your tax professional before the first paycheck.</p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">Wages for bona fide, age-appropriate work at reasonable pay are deductible to the business. The child shelters the wages under the dependent standard deduction — the greater of ~$1,350 or earned income + $450, capped at the regular standard deduction: <b>$15,750 in 2025, $16,100 in 2026</b> — so roughly <b>$15.8k/$16.1k per child per year</b> can be earned tax-free federally, with room beyond that via a Roth IRA contribution up to earned income and the annual limit. Wages are earned income, so the kiddie tax does not apply. You save at your marginal rate.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds — the entity matters</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Payroll-tax exemption (no Social Security/Medicare under 18; no FUTA under 21) applies <b>only</b> in a sole proprietorship or a partnership where <i>each</i> partner is the child’s parent — a single-member LLC taxed as disregarded gets sole-proprietor treatment</li>
                  <li>An LLC/partnership with a non-parent partner, or any corporation including an S-corp, loses the exemption (wages stay deductible)</li>
                  <li>Real duties — turnover cleaning, listing photos, guest and admin help — with timesheets, market-rate pay, actual W-2 payroll, and state child-labor law followed</li>
                  <li>If your rental income is passive and suspended, the wage deduction may only enlarge a suspended loss</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>No-show jobs and executive pay for a young child</li>
                  <li>No payroll records; gifts re-labeled as wages</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance / in-year.</b> The work and the payment must occur in the year; set payroll up first.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Bona fide employment:</b> the child must perform real, necessary, age-appropriate services for the business at reasonable (market-rate) compensation, judged by the work actually done — turnover cleaning, lawn and unit-turn help, listing photos, guest messaging, filing and admin support. No-show jobs, inflated pay, and executive rates for young children are the disallowed pattern.</li>
              <li><b>How the child&apos;s shelter works:</b> wages are earned income, sheltered by the dependent standard deduction — the greater of ~$1,350 or earned income plus $450, capped at the regular standard deduction ($15,750 in 2025; $16,100 in 2026). The kiddie tax does not apply to earned income. Wages also create Roth IRA contribution room up to the child&apos;s earned income and the annual limit.</li>
              <li><b>Payroll-tax exemption — entity-dependent:</b> wages paid to your child under 18 are exempt from Social Security and Medicare, and under 21 exempt from FUTA, <i>only</i> when the employer is a sole proprietorship or a partnership in which each partner is the child&apos;s parent. A single-member LLC taxed as a disregarded entity gets sole-proprietor treatment. Any corporation (including an S-corp) or a partnership with a non-parent partner loses the exemption — the wages remain deductible business expenses either way.</li>
              <li><b>Real payroll, not bookkeeping entries:</b> employment forms and eligibility verification as applicable, timesheets, payment by check or transfer from the business account at the stated rate, W-2 issued, payroll filings made, and state child-labor law (permitted ages, hours, work types) followed. Gifts re-labeled as wages after the fact fail.</li>
              <li><b>When it does not pay:</b> if the rental activity&apos;s income is passive and its losses are suspended, the wage deduction may only enlarge a suspended loss instead of saving current tax — and if the wages are paid from an activity the family does not materially participate in, check usability before assuming the 24%-style savings in the example.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS on family members in the family business — <a href="https://www.irs.gov/newsroom/tax-treatment-for-family-members-working-in-the-family-business" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov</a> · The Real Estate CPA — <a href="https://www.therealestatecpa.com/blog/hiring-your-kids-in-your-real-estate-business/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">therealestatecpa.com</a></p>
          </details>
        </article>
        <article data-tags="advance family" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance family".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">7</div>
            <div>
              <h3 className="text-lg font-black">The Augusta rule — §280A(g)</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Rent your home to your business for up to 14 days a year: the business deducts it, and you exclude it.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance / in-year</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Needs a separate business taxpayer</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example:</b> $1,000/day × 12 days = <b>$12,000 excluded</b> from your personal income, and the business saves ≈ <b>$2,880 at 24%</b>. Higher-value homes support higher fair-market rent — with proof.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — the 14 days attach to your residence</b><p className="mb-3 leading-relaxed last:mb-0">The Augusta rule lives on the <b>personal-residence side</b> of the building: §280A(g) excludes rent when a dwelling used as a residence is rented fewer than 15 days in the year, with no rental expenses allowed for those days. It does not exempt an ongoing rental unit rented through the year, and it needs the same separate-taxpayer business as everywhere else (an S-corp, C-corp, or partnership renting your home from you at documented fair-market rent for real meetings). Note the interaction to avoid: do not double-claim the same space and expenses as a home office (see Practical Tips) — pick one treatment per space per year and document it.</p><p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ border: "none", paddingTop: "2px", marginTop: "2px" }}>Sources: §280A(g); IRS Topic 415; §280A / Pub. 527 mixed-use framework — <a href="https://www.irs.gov/publications/p527" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p527</a></p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">If a dwelling used as a residence is rented for fewer than 15 days, the rental income is excluded and no rental expenses are allowed (§280A(g); IRS Topic 415). Separately, your business deducts the rent as an ordinary and necessary §162 expense at fair market value. The nickname comes from homeowners renting to visitors during Masters week in Augusta, Georgia.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li><b>14 days per year, maximum</b> — day 15 voids the exclusion for the whole year</li>
                  <li>Bona fide business purpose (meetings, retreats, trainings) with a written agreement, invoice, minutes, comparable rents, and a traceable payment</li>
                  <li><b>The catch:</b> it needs a separate taxpayer business — S-corp, C-corp, or a partnership (including a multi-member LLC taxed as one). A sole proprietor or single-member disregarded LLC cannot rent to itself, so a landlord with only passive Schedule E rentals often cannot use the business version</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li>Inflated self-set rates — the Tax Court has cut deductions back to proven fair market value</li>
                  <li>Missing agendas, minutes, or rent comps; renting a 15th day</li>
                  <li>Double-claiming the same space and expenses as a home office</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance / in-year.</b> The meetings, agreement, and payment must all occur within the year.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>The exclusion (§280A(g)):</b> if a dwelling unit used as a residence during the year is rented for fewer than 15 days total, the rental income is excluded from gross income and no rental expenses for those days are deductible. The 14-day cap is annual and absolute — a 15th rental day voids the exclusion for the entire year.</li>
              <li><b>The business-side deduction:</b> the renting business deducts fair-market rent as an ordinary and necessary expense under §162. The rate must be defensible: comparable local venues/homes, documented in advance — the Tax Court has cut self-set deductions back to proven fair market value.</li>
              <li><b>A separate taxpayer is mandatory:</b> the home&apos;s owner and the renting business must be different taxpayers — an S-corp, C-corp, or partnership (including a multi-member LLC taxed as one) renting from the owner personally. A sole proprietor or single-member disregarded LLC cannot rent to itself, which is why a landlord whose only activity is passive Schedule E rentals often cannot use the business version at all.</li>
              <li><b>Bona fide business purpose, documented:</b> real meetings, retreats, trainings, or planning sessions — with a written rental agreement, an invoice, an agenda and minutes naming attendees and business topics, and a traceable payment (check/transfer) from the business to the owner. Paper created at tax time is the failed pattern.</li>
              <li><b>No double-claiming:</b> the same space and days cannot simultaneously support a home-office deduction — pick one treatment per space per year (see Practical Tips).</li>
              <li><b>Reporting:</b> the excluded rent is generally not reported as income by the homeowner (it is excluded, not merely unreported income — keep the agreement and payment proof with the year&apos;s records); the business claims the rent expense on its own return.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: Sambrotman on the Augusta rule — <a href="https://sambrotman.com/the-augusta-rule-explained-tax-free-home-rentals-for-your-business/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">sambrotman.com</a> · Fraim CPA — <a href="https://fraimcpa.com/augusta-rule-rental-deduction/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">fraimcpa.com</a></p>
          </details>
        </article>
        <article data-tags="advance" className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" hidden={activeFilter !== "all" && !"advance".split(" ").includes(activeFilter)}>
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lg font-black text-white dark:bg-amber-400 dark:text-slate-950">8</div>
            <div>
              <h3 className="text-lg font-black">Buy equipment for the business — §179 expensing & bonus depreciation</h3>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">A machine the business needs can be deducted in Year 1 — but a deduction is worth only your tax bracket, never the full price.</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800 border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">Advance / in-year — must be placed in service</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">New or used equipment</span><span className="rounded-full border border-slate-300 bg-slate-100 px-2.5 py-0.5 text-xs font-bold dark:border-slate-600 dark:bg-slate-800">Same bonus engine as #3, for gear</span></div>
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed dark:border-slate-700 dark:bg-slate-800/60"><b>Example (the $67,000 Bobcat):</b> buy a skid steer for <b>$67,000</b>, used 100% in the business and running before year-end. §179 or 100% bonus depreciation deducts the full <b>$67,000 against your income</b> in Year 1. What you actually <b>save in tax</b> is only the deduction × your marginal bracket: ≈ <b>$8,040 at 12%</b>, ≈ $14,740 at 22%, ≈ $16,080 at 24%. You still spent $67,000 — a deduction is a discount at your bracket rate, not a rebate.</div>
          <div className="mt-3 space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed dark:border-sky-800 dark:bg-sky-950"><b className="block text-[11px] font-black uppercase tracking-wide text-sky-800 dark:text-sky-200">House-hack note — split the business use from your own unit</b><p className="mb-3 leading-relaxed last:mb-0">Equipment that serves the whole property — a tractor, mower, or skid steer working on all four units including yours — is deducted only for its <b>business-use share</b>. Work on your own unit is personal use. Keep a simple use log (date, unit/property, task): if business use is 75%, the deduction is 75% of the cost, and §179 is unavailable entirely if business use falls to 50% or below in the placed-in-service year. The rental share of the deduction lands on Schedule E and still has to pass the usability gates — passive losses suspend unless a door in #1, #2, or the $25k allowance (Basics below) is open.</p></div>
          <details className="mt-4">
            <summary className="cursor-pointer py-1 text-sm font-bold text-sky-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:text-sky-400">How it works, who qualifies, and what goes wrong</summary>
            <div className="grid gap-4 py-2 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">How it works</h4>
                <p className="mb-3 leading-relaxed last:mb-0">Business equipment — machinery, skid steers, trailers, mowers, tools, off-the-shelf software — is normally 5- or 7-year MACRS property, recovered a slice at a time. Two accelerators can move some or all of it into Year 1. <b>§179 expensing</b> lets you elect to deduct up to the full cost in the year the equipment is <b>placed in service</b>, item by item. <b>Bonus depreciation</b> (§168(k)) deducts <b>100%</b> of what §179 leaves, automatically unless you elect out, for property acquired after Jan 19, 2025. Used equipment qualifies for both (for bonus, it must be first use <i>by you</i>). Neither one puts money back in your pocket — each dollar deducted saves tax at your marginal rate, which is why the bracket, not the sticker price, decides whether a December purchase is smart.</p>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Key thresholds</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li><b>§179 caps (OBBBA):</b> maximum deduction <b>$2.5M for 2025</b> ($2.56M for 2026), phasing out dollar-for-dollar once total §179 property placed in service passes <b>$4M</b> ($4.09M in 2026) — rarely binding at landlord scale, but the caps exist</li>
                  <li><b>Placed in service, not just purchased:</b> the equipment must be ready and available for its intended use by Dec 31 — ordered in December but delivered or installed in January is next year&apos;s deduction</li>
                  <li><b>Business use must exceed 50%</b> for §179, and only the business-use percentage of the cost is deductible under either accelerator</li>
                  <li><b>§179 cannot exceed the year&apos;s taxable business income</b> (the excess carries forward); bonus has no income cap but still runs into the passive/at-risk/§461(l) loss limits before it saves cash</li>
                  <li>Vehicle caps still apply to road vehicles (2025 SUV §179 limit $31,300) — a skid steer is equipment, not a passenger vehicle, but a work truck has its own rules</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Risks & common mistakes</h4>
                <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
                  <li><b>Buying gear “for the write-off”:</b> spending $67,000 to save $8,000–$16,000 of tax is still spending $51,000–$59,000. Buy equipment the business needs; let the deduction be the bonus</li>
                  <li><b>Recapture:</b> sell the equipment, convert it to personal use, or let business use drop to 50% or below during its recovery period and the accelerated portion comes back as ordinary income (§1245 / §179 recapture)</li>
                  <li>Claiming 100% business use on equipment that also serves your own home or unit, with no use log to back it</li>
                  <li>Financed equipment: the full cost is the depreciable basis even with little money down — but the loan balance is still owed, and year-end “paper purchases” not yet in service fail the placed-in-service test</li>
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Timing</h4>
                <p className="mb-3 leading-relaxed last:mb-0"><b>Advance / in-year</b> for the purchase and the placed-in-service date; the §179 election itself is made on Form 4562 with the return (and can be revoked or adjusted on an amended return). State conformity varies — many states decouple from bonus depreciation, so the federal write-off may not repeat on the state return.</p>
              </div>
            </div>
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Complete rules</h4>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Eligible property:</b> tangible personal property used in the active conduct of a trade or business — machinery and equipment, tools, trailers, computers, off-the-shelf software — generally with a MACRS recovery period of 20 years or less (equipment is typically 5- or 7-year property). Land and buildings do not qualify; building components are strategy #3&apos;s territory. New and used equipment both qualify; for bonus depreciation the property&apos;s first use must be by you (or it must meet the used-property acquisition rules).</li>
              <li><b>§179 election mechanics:</b> you elect item by item on Form 4562, and may expense part of an item&apos;s cost and depreciate the rest. The deduction is capped at $2.5M for 2025 ($2.56M for 2026), reduced dollar-for-dollar when total §179 property placed in service exceeds $4M ($4.09M for 2026), and fully gone above roughly $6.5M ($6.65M for 2026). You may also elect to expense only part of the year&apos;s purchases — §179 is chosen property-by-property, bonus is not.</li>
              <li><b>§179 taxable-income limit:</b> the §179 deduction cannot exceed the aggregate taxable income from the active conduct of your trades or businesses for the year; the disallowed excess carries forward indefinitely (still subject to the limit in later years). Bonus depreciation has no such cap and can create or enlarge a loss — but for rental use the result then passes through the passive-loss (§469), at-risk (§465), and excess-business-loss (§461(l)) gates before it saves current cash.</li>
              <li><b>Bonus depreciation mechanics:</b> 100% for qualified property acquired and placed in service after January 19, 2025 (permanent under OBBBA; the transitional 40% election in IRS Notice 2026-11 aside). It applies automatically to the basis remaining after §179 unless you elect out by recovery class. There is no dollar cap and no business-income limit.</li>
              <li><b>Placed-in-service rule:</b> property is placed in service when ready and available for its specific use, not when the invoice is signed. Equipment delivered but not installed or operational until January belongs to the next tax year (IRS Publication 946). Year-end purchases should be received, set up, and used before Dec 31, with delivery records kept.</li>
              <li><b>Business-use percentage:</b> only the business-use share of cost is eligible; §179 requires business use above 50% in the placed-in-service year. Mixed-use equipment (business property plus your own unit, home, or personal jobs) needs a contemporaneous use log — jobs, dates, properties — to support the percentage claimed.</li>
              <li><b>Recapture:</b> if business use drops to 50% or below during the recovery period, the excess of the §179/bonus taken over straight MACRS is recaptured as ordinary income; on a sale, gain up to depreciation taken is ordinary under §1245. Accelerating a deduction on equipment you will sell or convert soon can hand the benefit back.</li>
              <li><b>Rental-activity use:</b> equipment bought for the rental business (turn work, landscaping, snow, repairs) is deducted on Schedule E as depreciation like other rental assets — subject to the same usability doors as #1, #2, and the $25,000 allowance. Equipment for a separate active business (e.g., a contracting or property-services business) follows that business&apos;s rules and can be what makes the §179 income limit and the Augusta-rule entity (#7) come together — a fact pattern for your tax professional, not an assumption.</li>
              <li><b>Record-keeping:</b> purchase invoice and proof of payment, placed-in-service evidence (delivery/install records, first job ticket), the business-use log, and financing documents (basis is the full cost even when financed; loan payments themselves are not deductible — interest is). Many states decouple from federal bonus depreciation or use lower §179 caps; confirm the state treatment before counting on the same write-off twice.</li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS Publication 946, “How to Depreciate Property” (§179, bonus, placed-in-service, and recapture rules) — <a href="https://www.irs.gov/publications/p946" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p946</a> · U.S. Bank — §179 and bonus depreciation limits table (2025: $2.5M / $4M; 2026: $2.56M / $4.09M) — <a href="https://www.usbank.com/corporate-and-commercial-banking/insights/credit-finance/equipment/maximize-deductions-section-179.html" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">usbank.com</a></p>
          </details>
        </article>
      </div>
      <section aria-labelledby="basics-h" className="space-y-4">
        <div className="space-y-1">
          <h2 id="basics-h" className="text-2xl font-black tracking-tight">The basics underneath all eight</h2>
          <p className="text-[15px] text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Not a headline strategy — this is the automatic layer every landlord already has. Optimize it; the eight plays build on it.</p>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <p className="mb-3 leading-relaxed last:mb-0">Straight-line depreciation (27.5 years residential, 39 commercial) on a $320k building basis is ≈ <b>$11.6k/year of shelter before any study</b>, on top of ordinary, necessary expenses. Two levers inside the basics are worth knowing:</p>
          <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
            <li><b>The $25,000 active-participation allowance (§469(i)):</b> owners of at least 10% who make management decisions can deduct up to $25,000 of rental losses against other income, phasing out between $100k–$150k of modified AGI (not inflation-indexed). For landlords under $100k, this may matter more in practice than ranks #6–7 — it just needs no separate playbook, so it lives here.</li>
            <li><b>QBI (§199A), now permanent:</b> up to 20% on profitable rentals that rise to a trade or business — the Rev. Proc. 2019-38 safe harbor asks for 250 hours of rental services and separate books.</li>
            <li><b>Repairs vs. improvements:</b> the tangible-property regulations (with a de-minimis safe harbor) decide what is expensed now versus capitalized — expensing a roof or HVAC as a “repair” is a classic error, and never claiming depreciation at all still costs you basis.</li>
          </ul>
          <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Sources: IRS Publication 925 — <a href="https://www.irs.gov/publications/p925" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p925</a> · The Tax Adviser on QBI for rental real estate — <a href="https://www.thetaxadviser.com/issues/2019/dec/rental-real-estate-businesses-qbi-deduction/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">thetaxadviser.com</a></p>
        </div>
      </section>
      <section aria-labelledby="tips-h" className="space-y-4">
        <div className="space-y-1">
          <h2 id="tips-h" className="text-2xl font-black tracking-tight">Practical tips: the everyday write-offs</h2>
          <p className="text-[15px] text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Smaller than the eight, but they run all year — and they are won or lost on records, not on forms.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">Home office — deduct a slice of the household bills</h3>
            <p className="mb-3 leading-relaxed last:mb-0">If you run the rentals from a dedicated space at home, §280A(c) allows a deduction for that portion of the house — which is really a deduction for a share of the household bills: mortgage interest and property taxes (or rent), utilities, homeowner&apos;s insurance, and repairs, allocated by the office&apos;s share of the home&apos;s square footage.</p>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>The tests:</b> the space must be used <b>regularly and exclusively</b> for the rental business (no guest bed, no kids&apos; homework table) and be your <b>principal place of business</b> — including the administrative/management case, where you do the books, tenant calls, and scheduling there and have no other fixed location for that work.</li>
              <li><b>Simplified method:</b> $5 per square foot, up to 300 sq ft — a <b>$1,500 maximum</b> deduction, no receipts math and no depreciation slice to recapture later (Rev. Proc. 2013-13).</li>
              <li><b>Regular method (Form 8829):</b> actual bills × office percentage. Usually bigger, but the depreciation portion of the home-office slice is recaptured when you sell the home.</li>
              <li><b>The landlord caveat:</b> the deduction needs the rental operation to rise to a trade or business, not mere investment activity — strongest when the household has REPS status (#2) or an active management operation. eligibility here is fact-specific; this is one to confirm with your professional before the first claim.</li>
              <li><b>Don&apos;t double-claim:</b> the same space can&apos;t be both your home office and your Augusta-rule rental (#7) — one treatment per space per year.</li>
            </ul>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">Vehicle — business miles are a deduction, if they&apos;re logged</h3>
            <p className="mb-3 leading-relaxed last:mb-0">Driving to a property for a showing, a repair run, a supply trip, or meeting a contractor is deductible travel. You pick one of two methods — and both live or die on the same log.</p>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Standard mileage:</b> a per-mile rate set by the IRS each year × business miles. Simplest, and usually best for an efficient vehicle.</li>
              <li><b>Actual expenses:</b> fuel, insurance, repairs, registration, and depreciation × your <b>business-use percentage</b> (business miles ÷ total miles for the year). Better for a costly truck — but you still need the mileage split to prove the percentage.</li>
              <li><b>The log is the deduction:</b> date, destination, business purpose, and miles, recorded at the time. A mileage app that auto-tracks drives and lets you classify business vs. personal — for example, <b>MileIQ</b> — plus calendar entries matching the trips is exactly the corroboration pattern that survives questions. A year-end reconstruction from memory is the weak version of the same evidence.</li>
              <li><b>Not deductible:</b> ordinary commuting from home to a regular workplace. Trips from home to a rental property for genuine rental work are rental travel, not commuting — that&apos;s why the purpose line in the log matters.</li>
            </ul>
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" style={{ marginTop: "12px" }}>
          <h3 className="text-lg font-black">Everyday habits that make the eight work</h3>
          <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
            <li><b>Log hours weekly, not at tax time.</b> REPS (#2), the STR exception (#1), and the grouping election are all decided by records. A contemporaneous log — date, property, task, duration, purpose — with tenant messages, approved invoices, and mileage records saved alongside it is the single highest-value habit on this page.</li>
            <li><b>Keep one account and card per property</b> (or at minimum per activity). Clean books are also the QBI safe-harbor expectation (250 hours of rental services, separate books — see Basics) and make a cost-segregation or 1031 paper trail trivial to assemble.</li>
            <li><b>Save the platform exports.</b> Booking-platform reports prove the ≤7-day average stay for #1; rent rolls and leases prove fair rent — including when family rents a unit, since below-market family rent can convert days to personal-use days under §280A.</li>
            <li><b>File the election statements with the return and keep copies.</b> The REPS grouping election (#2) goes on the original timely filed return; late relief exists (Rev. Proc. 2011-34) only when returns were consistently filed as if it had been made.</li>
            <li><b>Calendar the 1031 clocks the day a sale is contemplated</b> — 45 days to identify, 180 to close (#4). Missed clocks are the #1 killer and cannot be appealed into existence.</li>
            <li><b>Paper the family plays before the money moves:</b> timesheets and a real W-2 for the kids (#6); a written agreement, agenda, minutes, rent comps, and a traceable payment for Augusta days (#7).</li>
          </ul>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" style={{ marginTop: "12px", borderStyle: "dashed" }}>
          <h3 className="text-lg font-black">Free companion: REPS & material-participation hours tracker <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Free download</span></h3>
          <p className="mb-3 leading-relaxed last:mb-0">A free spreadsheet companion to strategies #1 and #2 is being built alongside this section — a weekly hours log structured the way the rules above demand: date, property/activity, task, duration, business purpose, plus roll-ups against the 750-hour REPS test, the more-than-half test, and the per-activity material-participation tests (500-hour and 100-hour), so a shortfall shows up in October, not at audit. <a href="/downloads/hours-mileage-tracker.xlsx" download className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Download the free REPS &amp; material-participation hours tracker (Excel)</a></p>
        </div>
      </section>
      <section aria-labelledby="drop-h" className="space-y-4">
        <div className="space-y-1">
          <h2 id="drop-h" className="text-2xl font-black tracking-tight">Researched, but not in the eight</h2>
          <p className="text-[15px] text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">Good strategies in the right situation — dropped from the headline list for a typical small-to-mid landlord, with the reason on the record.</p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">Candidate</th>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">What it is</th>
                <th scope="col" className="border-b border-slate-200 px-3 py-2 text-left text-xs font-black uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">Why it is not a headline here</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-l="Candidate" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800"><b>Opportunity Zones (§1400Z-2)</b></td>
                <td data-l="What it is" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Defer a capital gain by rolling it into a Qualified Opportunity Fund within 180 days; hold 10 years and the fund’s own appreciation can be excluded. <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Changed</span> Made permanent by the 2025 law — new rolling 5-year regime from Jan 1, 2027; legacy deferred gains are still recognized Dec 31, 2026.</td>
                <td data-l="Why not" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Needs outside gains and a fund sponsor, locks capital for 5–10 years, and conflicts with keeping equity borrowable and under your control.</td>
              </tr>
              <tr>
                <td data-l="Candidate" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800"><b>Installment sale (§453)</b></td>
                <td data-l="What it is" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Seller-finance the sale and spread the gain across the years you collect (Form 6252); each payment splits into interest (ordinary), tax-free basis recovery, and gain.</td>
                <td data-l="Why not" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Only fits when a buyer needs seller financing. Depreciation recapture is generally recognized in the year of sale before the cash arrives, buyer default leaves a tax and foreclosure mess, and it converts borrowable equity into a note.</td>
              </tr>
              <tr>
                <td data-l="Candidate" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800"><b>Self-directed IRA</b></td>
                <td data-l="What it is" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Buy rentals inside an IRA; rent and gains compound tax-deferred (traditional) or tax-free (Roth), through a self-directed custodian with non-recourse leverage only.</td>
                <td data-l="Why not" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Cuts against using rental losses and accessing equity: no usable depreciation, no personal leverage or equity access, and one prohibited transaction (personal/family use, sweat equity, dealing with disqualified persons) can disqualify the entire IRA as of January 1 of that year.</td>
              </tr>
              <tr>
                <td data-l="Candidate" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800"><b>Home office / S-corp for rentals</b></td>
                <td data-l="What it is" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">Home office: simplified method is $5/sq ft up to 300 sq ft — a <b>$1,500 maximum</b> deduction. S-corp: a popular entity move for landlords.</td>
                <td data-l="Why not" className="border-b border-slate-100 px-3 py-2 align-top dark:border-slate-800">The home-office deduction is small (≈ $360 at 24%) and eligibility for small landlords is fact-specific. Long-term rental income is already excluded from self-employment tax, so an S-corp buys no SE saving while adding traps — no debt basis, gain on distributing property, costly exits. Treat both as a caution box, not a strategy. <i>CPA-consensus sourcing; confirm before relying.</i></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0" style={{ marginTop: "8px" }}>Sources: IRS QOF page — <a href="https://www.irs.gov/credits-deductions/businesses/invest-in-a-qualified-opportunity-fund" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov</a> · GT Law on the permanent OZ regime — <a href="https://www.gtlaw.com/en/insights/2025/7/president-trump-signs-one-big-beautiful-bill-act-adopting-permanent-qualified-opportunity-zone-provisions-with-rolling-deferral" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">gtlaw.com</a> · IRS Publication 537 (installment sales) — <a href="https://www.irs.gov/publications/p537" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p537</a> · IRS Publication 590-B (IRAs) — <a href="https://www.irs.gov/publications/p590b" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">irs.gov/publications/p590b</a>. Dollar figures for fund minimums, study fees, and lender terms throughout this page come from vendor/lender pages and are typical ranges, not promises.</p>
      </section>
      <section aria-labelledby="law-h" className="space-y-4">
        <div className="space-y-1">
          <h2 id="law-h" className="text-2xl font-black tracking-tight">What changed for 2025–2026 — and what is still open</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">Recent law changes <span className="inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Verify before filing</span></h3>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>Bonus depreciation:</b> the old phase-down (40% for 2025) is replaced — <b>100%, permanent, for property acquired after Jan 19, 2025</b>. IRS Notice 2026-11 (Jan 14, 2026) adds interim rules, including a transitional 40% election.</li>
              <li><b>Excess business loss cap (§461(l)):</b> permanent; thresholds reset lower for 2026 — $256k / $512k (2025: $313k / $626k).</li>
              <li><b>Standard deduction:</b> $15,750 single / $31,500 joint (2025); $16,100 / $32,200 (2026) — this is what sets the per-child shelter in #6.</li>
              <li><b>QBI (§199A):</b> the scheduled sunset was removed; the deduction is permanent.</li>
              <li><b>Unchanged:</b> the 1031 clocks (45/180 days), the STR 7-day rule, the Augusta 14-day rule, and the $25k allowance phase-out range.</li>
            </ul>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">Open questions — stated plainly</h3>
            <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
              <li><b>State taxes:</b> conformity on bonus depreciation, STR/REPS treatment, and Opportunity Zones varies by state and is out of scope here. Do not assume the federal result is your state result.</li>
              <li><b>Your entity mix:</b> whether the “business” behind the Augusta rule and hiring kids is the rentals themselves or a separate management company can swap the order of ranks #6 and #7 for a given owner.</li>
              <li><b>Home-office eligibility</b> for small landlords rests on CPA-consensus secondary sources and fact-specific case law, not a single landlord-specific IRS authority.</li>
              <li><b>Course and workshop pricing</b> for the paid reading below: BiggerPockets store prices were index-cached Oct 10, 2026; Tom Wheelwright&apos;s Tax-Free Formula course price is not publicly posted (enrollment is periodic) and a $997 workshop price in an older press item is not quoted here as current.</li>
            </ul>
          </div>
        </div>
      </section>
      <section aria-labelledby="read-h" className="space-y-4">
        <div className="space-y-1">
          <h2 id="read-h" className="text-2xl font-black tracking-tight">Reading the source material</h2>
          <p className="text-[15px] text-slate-600 dark:text-slate-300 mb-3 leading-relaxed last:mb-0">The two sources landlords actually read on this — what they give away free, what they sell, and where to hold the salt.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">BiggerPockets — free tier</h3>
            <ul className="list-none space-y-3 pl-0">
              <li><a href="https://www.biggerpockets.com/blog/real-estate-1076" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">How to (Legally) Reduce Taxes with Real Estate (Real Estate Podcast #1076, Amanda Han)</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — podcast + full transcript</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Depreciation, cost segregation, the $25k allowance and its phaseouts, matched to the investor&apos;s participation status.</span></li>
              <li><a href="https://www.everand.com/podcast/559788227/370-Tax-Hacks-to-Juice-Your-ROI-with-Amanda-Han-and-Matt-MacFarland" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Tax Hacks to Juice Your ROI (Podcast #370, Han & MacFarland)</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">The authors&apos; framework: entity choice, depreciation/cost segregation, 1031 timing — and when not to DIY.</span></li>
              <li><a href="https://www.biggerpockets.com/forums/51/topics/1122635-the-so-called-str-loophole-hype-or-real?highlight_post=6418937&page=1" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">“The so-called STR loophole — hype or real?”</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free forum thread</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Practitioner-led: the ≤7-day average + material participation, with REPS and the $25k allowance as separate doors.</span></li>
              <li><a href="https://www.biggerpockets.com/forums/51/topics/1015842-tax-benefits-of-house-hacking" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Tax Benefits of House Hacking</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free forum thread</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Allocate mixed-use expenses, depreciate only the rental share; an LLC around your residence adds cost without tax benefit.</span></li>
              <li><a href="https://www.biggerpockets.com/forums/922/topics/1281321-depreciation-and-house-hacking" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Depreciation and House Hacking</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free forum thread</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">The 75/25 four-plex split worked in the open; cost segregation accelerates only the rental share.</span></li>
              <li><a href="https://www.biggerpockets.com/forums/51/topics/1267319-tax-implications-of-using-one-unit-in-a-multifamily-property-as-a-str" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">One unit in a multifamily property as an STR</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free forum thread</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">An STR unit as its own activity: ≤7-day average + material participation makes its cost-segregated losses nonpassive.</span></li>
            </ul>
            <p className="mt-3 border-t border-dashed border-slate-200 pt-2 text-xs leading-relaxed text-slate-500 dark:border-slate-700 dark:text-slate-400 [&_a]:break-all mb-3 last:mb-0">Forums are readable without payment; some participation and calculators require a free account, and Pro features are paid. Forum answers are practitioner experience, not authority — the IRS publications linked on the cards govern.</p>
          </div>
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-lg font-black">Tom Wheelwright — Kiyosaki&apos;s tax advisor, free tier</h3>
            <p className="mb-3 leading-relaxed last:mb-0" style={{ fontSize: "14px", margin: "0 0 4px" }}>Tom Wheelwright is the CPA behind Rich Dad&apos;s tax advice (founder of WealthAbility; author of <i>Tax-Free Wealth</i>). His framing: the tax code is mostly incentive provisions, so arranging your affairs to do what the government rewards — housing, business, energy — can lawfully drive tax toward zero. The free material states that thesis; the constraints live in the rules on the cards above.</p>
            <ul className="list-none space-y-3 pl-0">
              <li><a href="https://www.wealthability.com/podcast/buy-borrow-die/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Buy, Borrow, and Die (The WealthAbility Show, with Ed McCaffery)</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — episode + transcript</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Buy appreciating assets, borrow against them (loan proceeds aren&apos;t income), hold to death for the basis step-up — the source of the borrowing approach covered in the borrowing notes above. Read it alongside the caveat in that section: tax-free is not cost-free, and the lender wins on every cycle.</span></li>
              <li><a href="https://wealthability.com/show" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">The WealthAbility Show</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — 300+ episodes since 2018, also on YouTube</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Weekly application of the “make more, pay less” system: incentives, entities, real-estate strategies, advisor interviews.</span></li>
              <li><a href="https://www.youtube.com/watch?v=XpPZVcnG4Lw" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">How to Legally Not Pay Taxes</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — YouTube</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">The thesis in short form: tax law as stimulus incentives a business owner or investor can use to reach a zero-tax outcome, with planning.</span></li>
              <li><a href="https://www.youtube.com/watch?v=z5S-ijVnWAY" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">How Robert Kiyosaki Uses Debt to Build Wealth and Reduce Taxes (Rich Dad Radio Show)</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — YouTube</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Debt into appreciable, depreciable real estate, then refinanced to reach equity without a sale — contrast with the Myth box at the top of this page on borrowing <i>for</i> the deduction.</span></li>
              <li><a href="https://wealthability.com/getreport/" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200">Tom&apos;s Free Weekly Report</a> <span className="text-xs font-black text-sky-700 dark:text-sky-400">· Free — email signup</span><span className="block text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">Recurring short tax-strategy briefings; it is also the feeder for the paid programs below.</span></li>
            </ul>
          </div>
        </div>
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900" style={{ marginTop: "12px" }}>
          <h3 className="text-lg font-black">Paid tier — priced as found, Oct 10, 2026</h3>
          <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
            <li><b>BiggerPockets Publishing:</b> <a href="https://store.biggerpockets.com/products/the-book-on-tax-strategies-for-the-savvy-real-estate-investor" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200"><i>The Book on Tax Strategies for the Savvy Real Estate Investor</i></a> (Han & MacFarland, rev. 2026) from <b>$12.99</b>; <a href="https://store.biggerpockets.com/products/tax-strategies-book-bundle" target="_blank" rel="noopener" className="font-semibold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:decoration-sky-700 dark:hover:text-sky-200"><i>The Book on Advanced Tax Strategies</i></a> (2020) from <b>$12.99</b>, or both bundled at <b>$20.98</b> (list $25.98). The Advanced book&apos;s coverage maps closely to this page: zeroing taxable rental income, 1031 exchanges (including taking cash out), opportunity zones, self-directed accounts — plus a bonus chapter of REPS court cases. Store prices were index-cached at research time; the store is the authoritative price.</li>
            <li><b>Wheelwright:</b> <i>Tax-Free Wealth</i> (3rd ed. 2024) is a paid book, roughly <b>$20–27</b> new. The <b>Tax-Free Formula</b> course runs periodic limited enrollment and its price was <b>not publicly posted</b> on the pages retrieved — treat any quoted course price, and the $997 workshop price appearing in an older press item, as unverified rather than current.</li>
          </ul>
          <h3 className="text-lg font-black" style={{ marginTop: "14px" }}>Where the free guru material diverges from mainstream CPA guidance</h3>
          <ul className="mb-3 list-disc space-y-1.5 pl-5 last:mb-0">
            <li><b>“Depreciation offsets your other income,” stated as a default.</b> The signature illustration (positive cash flow, bigger paper loss, excess deducted against salary) silently assumes a usable-loss door — REPS plus material participation, the STR exception, or the $25k allowance. The mainstream default is the reverse: rental losses are passive, suspended above the phaseouts, and cost segregation without a door manufactures carryforwards, not refunds.</li>
            <li><b>“Permanently” zero tax; recapture minimized.</b> Buy-borrow-die defers; only the death step-up (current §1014) makes the deferral permanent. A lifetime sale triggers unrecaptured §1250 at up to 25%, ordinary §1245 recapture on cost-segregated property, and possible NIIT. Practitioner sources model the recapture on exit; the free content treats refinance-and-hold as the expected path.</li>
            <li><b>Borrowing framed as tax-free income.</b> Loan proceeds genuinely aren&apos;t income — but interest is deductible only as traced to use of proceeds, leverage magnifies loss and rate risk, cash-out spent personally creates nondeductible interest, and the whole loop depends on a step-up rule that is statutory and can change.</li>
            <li><b>House hacking is largely absent as a category.</b> The free materials address investors generically; the mixed-use allocation, the separate-dwelling-unit §121 split, and occupancy-covenant issues that dominate a 1–4 unit house hack are not treated there — the BiggerPockets forums are materially better on that fact pattern.</li>
            <li><b>Point of view.</b> Incentive-maximization is presented as the tax system&apos;s purpose and low tax as evidence of correct behavior. Mainstream CPA writing treats the same strategies as high-audit-salience positions that stand or fall on hours, logs, elections filed on original returns, and fair-rent / reasonable-compensation documentation — the record-keeping rules on the cards above.</li>
          </ul>
        </div>
      </section>
      <footer className="space-y-3 border-t border-slate-200 pt-5 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:text-slate-300"><b>About this section.</b> Built for FORGE Rental Manager from web research completed Oct 10, 2026 (IRS publications and pages read directly, plus reputable CPA and publisher sources), covering US federal rules for tax years 2025–2026. Figures marked as examples use a 24% marginal rate for illustration. This is education, not tax advice — several strategies here cannot be fixed after the year ends, so planning ahead matters. The strategies that require advance planning are labeled as such on every card. <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 mb-3 last:mb-0" style={{ marginTop: "16px" }}><b>Reminder:</b> everything above is educational information only — not tax advice. FORGE is not a tax professional. Have your own tax professional assess every rule against your situation before you use any of it.</p></footer>
    </div>
  );
}
