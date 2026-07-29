import Header from "@/components/Header";
import RealEstateWorkspaceNavigation from "@/components/forge/RealEstateWorkspaceNavigation";
import ShareButton from "@/components/ShareButton";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function InvestorContractorsPage() {
  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: false });

  const contractorKeywords = [
    "contractor",
    "cleaning",
    "roof",
    "roofing",
    "electric",
    "electrical",
    "pest",
    "plumb",
    "plumbing",
    "hvac",
    "foundation",
    "floor",
    "flooring",
    "paint",
    "painting",
    "drywall",
    "cabinet",
    "cabinets",
    "window",
    "door",
    "land clearing",
    "dumpster",
    "hauling",
    "remodel",
    "construction",
    "handyman",
  ];

  const contractors =
    businesses?.filter((business) => {
      const category = business.category?.toLowerCase() || "";
      const description = business.description?.toLowerCase() || "";
      const name = business.name?.toLowerCase() || "";

      return contractorKeywords.some(
        (word) =>
          category.includes(word) ||
          description.includes(word) ||
          name.includes(word),
      );
    }) || [];

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />
      <RealEstateWorkspaceNavigation />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            🔨 409 Rehab Contractors
          </h1>

          <p className="text-xl text-green-100">
            Local contractors, trades, and rehab professionals for Southeast
            Texas investors.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="flex flex-col md:flex-row justify-between gap-4 items-start md:items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold">Contractor Directory</h2>
            <p className="text-gray-600 mt-2">
              Pulled from local businesses listed on 409 Marketplace.
            </p>
          </div>

          <a
            href="/businesses/add"
            className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-500"
          >
            Add Contractor Business
          </a>
        </div>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load contractor businesses.
          </div>
        )}

        {contractors.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            <h3 className="text-2xl font-bold mb-3">
              No rehab contractors listed yet
            </h3>

            <p className="text-gray-600 mb-6">
              Add contractor businesses to start building the 409 investor
              contractor list.
            </p>

            <a
              href="/businesses/add"
              className="inline-block bg-green-700 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-600"
            >
              Add First Contractor
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {contractors.map((business) => {
              const businessUrl = `https://409marketplace.online/businesses/${business.id}`;

              return (
                <div
                  key={business.id}
                  className="bg-white rounded-3xl shadow-md overflow-hidden"
                >
                  {business.image_url ? (
                    <img
                      src={business.image_url}
                      alt={business.name}
                      className="h-44 w-full object-cover"
                    />
                  ) : (
                    <div className="h-44 bg-green-100 flex items-center justify-center text-6xl">
                      🔨
                    </div>
                  )}

                  <div className="p-6">
                    <p className="text-sm text-gray-500">{business.city}</p>

                    <h3 className="text-xl font-bold mt-1">{business.name}</h3>

                    {business.category && (
                      <p className="text-sm font-bold text-green-800 mt-2">
                        {business.category}
                      </p>
                    )}

                    <div className="mt-3 text-gray-600 max-h-32 overflow-y-auto pr-2">
                      {business.description}
                    </div>

                    {business.phone && (
                      <a
                        href={`tel:${business.phone}`}
                        className="block mt-4 bg-green-700 text-white text-center py-3 rounded-xl font-bold"
                      >
                        Call Contractor
                      </a>
                    )}

                    {business.website_url && (
                      <a
                        href={business.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block mt-3 bg-blue-900 text-white text-center py-3 rounded-xl font-bold"
                      >
                        Website
                      </a>
                    )}

                    <a
                      href={`/businesses/${business.id}`}
                      className="block mt-3 bg-gray-800 text-white text-center py-3 rounded-xl font-bold"
                    >
                      View Business
                    </a>

                    <ShareButton title={business.name} url={businessUrl} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
