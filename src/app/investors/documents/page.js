import Header from "@/components/Header";

export const dynamic = "force-dynamic";

export default function InvestorDocumentsPage() {
  const docs = [
    {
      title: "Assignment of Contract",
      badge: "Most Popular",
      description:
        "Used by wholesalers to assign their purchase rights to another buyer for an assignment fee.",
      file: "/investor-docs/assignment-of-contract.txt",
    },
    {
      title: "Subject-To Purchase Agreement",
      badge: "Creative Finance",
      description:
        "Template for acquiring property subject to the seller's existing financing remaining in place.",
      file: "/investor-docs/subject-to-purchase-agreement.txt",
    },
    {
      title: "Seller Information Sheet",
      badge: "Lead Intake",
      description:
        "Collect seller motivation, mortgage details, property condition, repairs, and timeline.",
      file: "/investor-docs/seller-information-sheet.txt",
    },
    {
      title: "Cash Offer Letter Template",
      description:
        "Simple one-page offer template for making quick cash offers on investment properties.",
      file: "/investor-docs/cash-offer-letter-template.txt",
    },
    {
      title: "Buyer Criteria Form",
      description:
        "Track investor buying preferences including locations, property types, price ranges, and funding.",
      file: "/investor-docs/buyer-criteria-form.txt",
    },
    {
      title: "Scope of Work Template",
      description:
        "Organize rehab work by trade, room, materials, labor, and contractor responsibility.",
      file: "/investor-docs/scope-of-work-template.txt",
    },
    {
      title: "Property Acquisition Checklist",
      description:
        "Step-by-step checklist from lead generation through due diligence and closing.",
      file: "/investor-docs/property-acquisition-checklist.txt",
    },
    {
      title: "Wholesale Deal Package Template",
      description:
        "Organize photos, repair estimates, ARV, comps, access instructions, and buyer notes.",
      file: "/investor-docs/wholesale-deal-package-template.txt",
    },
    {
      title: "Property Walkthrough Checklist",
      description:
        "Inspect structure, roof, foundation, plumbing, electrical, HVAC, and overall condition before purchasing.",
      file: "/investor-docs/property-walkthrough-checklist.txt",
    },
    {
      title: "Rehab Budget Worksheet",
      description:
        "Estimate repair costs by category including roofing, electrical, plumbing, flooring, paint, HVAC, and more.",
      file: "/investor-docs/rehab-budget-worksheet.txt",
    },
    {
      title: "Contractor Bid Sheet",
      description:
        "Compare multiple contractor bids side-by-side to identify the best value.",
      file: "/investor-docs/contractor-bid-sheet.txt",
    },
    {
      title: "Deal Analysis Worksheet",
      description:
        "Evaluate purchase price, ARV, rehab cost, rent, cash flow, and potential profit.",
      file: "/investor-docs/deal-analysis-worksheet.txt",
    },
  ];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            📄 Free Investor Documents
          </h1>

          <p className="text-xl text-green-100">
            Free resources for landlords, flippers, wholesalers, and real estate
            investors.
          </p>

          <p className="mt-4 text-sm text-green-100 max-w-3xl">
            Educational templates only. Real estate laws vary by state. Have an
            attorney review contracts before using them in an actual
            transaction.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {docs.map((doc) => (
            <div key={doc.title} className="bg-white rounded-3xl shadow-md p-6">
              {doc.badge && (
                <span className="inline-block mb-4 rounded-full bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-900">
                  {doc.badge}
                </span>
              )}

              <h2 className="text-2xl font-bold mb-3">{doc.title}</h2>

              <p className="text-gray-600 mb-6">{doc.description}</p>

              <a
                href={doc.file}
                download
                className="inline-block bg-green-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-600"
              >
                Download Free
              </a>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
