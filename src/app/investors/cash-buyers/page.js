import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CashBuyersPage() {
  const { data: buyers, error } = await supabase
    .from("cash_buyers")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="max-w-7xl mx-auto py-10 px-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-4xl font-extrabold">
              409 Cash Buyer Directory
            </h1>
            <p className="text-gray-600 mt-2">
              Local real estate buyers looking for investment properties.
            </p>
          </div>

          <a
            href="/investors/cash-buyers/add"
            className="bg-green-700 text-white px-5 py-3 rounded-xl font-bold hover:bg-green-600 text-center"
          >
            Add Cash Buyer
          </a>
        </div>

        {error && (
          <div className="bg-red-100 text-red-800 p-4 rounded-xl mb-6">
            {error.message}
          </div>
        )}

        {!buyers || buyers.length === 0 ? (
          <div className="bg-white rounded-2xl shadow p-8 text-center">
            <p className="text-gray-600">No cash buyers listed yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {buyers.map((buyer) => (
              <div key={buyer.id} className="bg-white rounded-2xl shadow p-6">
                <h2 className="text-2xl font-bold">{buyer.name}</h2>

                {buyer.company_name && (
                  <p className="text-gray-600 font-semibold mt-1">
                    {buyer.company_name}
                  </p>
                )}

                <div className="mt-4 space-y-2 text-sm">
                  {buyer.cities && (
                    <p>
                      <span className="font-bold">Areas:</span> {buyer.cities}
                    </p>
                  )}

                  {buyer.property_types && (
                    <p>
                      <span className="font-bold">Property Types:</span>{" "}
                      {buyer.property_types}
                    </p>
                  )}

                  {buyer.max_price && (
                    <p>
                      <span className="font-bold">Max Price:</span>{" "}
                      {buyer.max_price}
                    </p>
                  )}

                  {buyer.funding_type && (
                    <p>
                      <span className="font-bold">Funding:</span>{" "}
                      {buyer.funding_type}
                    </p>
                  )}
                </div>

                {buyer.notes && (
                  <p className="text-gray-700 mt-4 whitespace-pre-wrap">
                    {buyer.notes}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-3">
                  <a
                    href={`tel:${buyer.phone}`}
                    className="bg-green-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-green-600"
                  >
                    Call
                  </a>

                  <a
                    href={`mailto:${buyer.email}`}
                    className="bg-gray-900 text-white px-4 py-2 rounded-xl font-bold hover:bg-gray-800"
                  >
                    Email
                  </a>

                  <a
                    href={`/investors/cash-buyers/edit/${buyer.id}`}
                    className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-600"
                  >
                    Edit
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
