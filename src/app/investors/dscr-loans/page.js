import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import { supabase } from "@/lib/supabase";
import DscrCalculator from "@/components/dscr/DscrCalculator";
import DscrDirectory from "@/components/dscr/DscrDirectory";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "DSCR Loan Provider Directory | 409 Marketplace",
  description:
    "Find DSCR lenders for investment property financing. Plain-English explainer, illustrative DSCR calculator, and a moderated directory of loan providers. FORGE is not a lender.",
};

export default async function DscrLoansPage() {
  const { data: lenders } = await supabase
    .from("dscr_lenders")
    .select("*")
    .eq("status", "published")
    .order("company_name", { ascending: true });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-5xl mx-auto py-10 px-6">
        {/* Disclaimer — visible without scrolling */}
        <div
          className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-5 mb-8"
          role="note"
          aria-label="Important disclaimer"
        >
          <p className="font-extrabold text-amber-900">
            FORGE is not a lender.
          </p>
          <p className="text-sm text-amber-900 mt-1">
            FORGE does not originate loans, underwrite, quote rates, or guarantee
            terms. This page is a directory for information only. All terms are
            provider-claimed unless marked otherwise — verify independently via{" "}
            <a
              href="https://www.nmlsconsumeraccess.org/"
              target="_blank"
              rel="noopener noreferrer external"
              className="underline font-semibold"
            >
              NMLS Consumer Access (external)
            </a>
            .
          </p>
        </div>

        <h1 className="text-4xl font-extrabold">DSCR loan providers</h1>
        <p className="text-gray-600 mt-2 max-w-3xl">
          DSCR (debt service coverage ratio) loans let investment-property
          buyers qualify on the property&apos;s rent — usually with no tax
          returns required. Below: what DSCR means, an illustrative calculator,
          and lenders who offer these loans.
        </p>

        {/* 1. Explainer */}
        <section aria-labelledby="explainer" className="mt-10">
          <h2 id="explainer" className="text-2xl font-extrabold">
            What is a DSCR loan?
          </h2>
          <div className="mt-4 bg-white rounded-2xl shadow p-6 md:p-8 prose prose-sm max-w-none text-gray-800">
            <p>
              <strong>DSCR</strong> stands for{" "}
              <strong>debt service coverage ratio</strong>. It answers one
              question: does the property&apos;s rent cover its mortgage
              payment?
            </p>
            <p className="mt-3">
              <strong>The ratio:</strong> monthly rent ÷ monthly housing payment
              (principal, interest, taxes, insurance, HOA). A ratio of 1.20x
              means the rent covers the payment 1.2 times over.
            </p>
            <p className="mt-3">
              <strong>How lenders use it:</strong> instead of asking for your
              pay stubs and tax returns, a DSCR lender looks at whether the
              property pays for itself. Many set a minimum ratio — commonly
              around 1.0x to 1.25x — but every lender defines the inputs
              differently. Some use market rent, some use actual rent, some
              subtract a vacancy allowance first.
            </p>
            <p className="mt-3">
              <strong>What properties qualify:</strong> typically 1-unit through
              10+ unit investment properties. Most DSCR loans are for
              non-owner-occupied (investment) properties only — not your
              primary home.
            </p>
            <p className="mt-3">
              <strong>What it is not:</strong> a DSCR loan is still a real
              mortgage with real underwriting. Lenders still check credit,
              reserves, and the property itself. A good ratio helps; it does
              not guarantee approval anywhere.
            </p>
            <p className="mt-3 text-sm bg-gray-100 rounded-lg p-3">
              <strong>Why this matters on FORGE:</strong> because DSCR loans
              qualify on the property instead of your personal income, they are
              the natural financing tool for buy-and-hold investors — the
              people FORGE is built for. This directory exists so you can find
              providers without hunting across a dozen lender sites.
            </p>
          </div>
        </section>

        {/* 2. Calculator */}
        <section aria-labelledby="calculator" className="mt-10">
          <h2 id="calculator" className="text-2xl font-extrabold sr-only">
            Illustrative DSCR calculator
          </h2>
          <DscrCalculator />
        </section>

        {/* 3. Directory */}
        <section aria-labelledby="directory" className="mt-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <h2 id="directory" className="text-2xl font-extrabold">
              Provider directory
            </h2>
            <a
              href="/investors/dscr-loans/submit"
              className="bg-green-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-600 text-center"
            >
              List your company
            </a>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Listed alphabetically — order implies no endorsement or ranking.
            Fields marked <span className="bg-amber-100 text-amber-900 text-xs font-semibold px-2 py-0.5 rounded-full">provider-claimed</span> come
            from the lender, not from FORGE.
          </p>
          <DscrDirectory initialLenders={lenders ?? []} />
        </section>

        {/* 4. Consumer safeguards */}
        <section aria-labelledby="safeguards" className="mt-10">
          <h2 id="safeguards" className="text-2xl font-extrabold">
            Before you borrow
          </h2>
          <div className="mt-4 bg-white rounded-2xl shadow p-6 text-sm space-y-3 text-gray-800">
            <p>
              <strong>A directory card is not a Loan Estimate.</strong> Ask each
              lender for a formal Loan Estimate and compare them side by side.
              The{" "}
              <a
                href="https://www.consumerfinance.gov/owning-a-home/compare/"
                target="_blank"
                rel="noopener noreferrer external"
                className="text-green-700 underline"
              >
                CFPB&apos;s comparison guidance (external)
              </a>{" "}
              walks through what to look at.
            </p>
            <p>
              <strong>Verify licensing yourself.</strong> Every card links to{" "}
              <a
                href="https://www.nmlsconsumeraccess.org/"
                target="_blank"
                rel="noopener noreferrer external"
                className="text-green-700 underline"
              >
                NMLS Consumer Access (external)
              </a>
              . Look up the company before you share personal information.
            </p>
            <p>
              <strong>Terms change.</strong> Cards show when terms were last
              confirmed. Anything past our reconfirmation window is marked and
              hidden from default views until the provider updates it.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
