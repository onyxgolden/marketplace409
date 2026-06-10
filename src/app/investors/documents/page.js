import Header from "@/components/Header";

export const dynamic = "force-dynamic";

export default function InvestorDocumentsPage() {
  const docs = [
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
      title: "Rental Property Inspection Checklist",
      description:
        "Document move-in, move-out, and periodic rental inspections.",
      file: "/investor-docs/rental-property-inspection-checklist.txt",
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
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {docs.map((doc) => (
            <div key={doc.title} className="bg-white rounded-3xl shadow-md p-6">
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
