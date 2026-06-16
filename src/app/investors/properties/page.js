import Header from "@/components/Header";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function InvestorPropertiesPage() {
  const { data: properties } = await supabase
    .from("investor_properties")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-green-900 text-white py-16 px-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-5xl font-extrabold mb-4">
            🏘 Investment Properties
          </h1>

          <p className="text-xl text-green-100">
            Rentals, rehab opportunities, wholesale deals, and investment
            properties.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        {!properties || properties.length === 0 ? (
          <div className="bg-white rounded-3xl shadow-md p-8 text-center">
            <h2 className="text-3xl font-bold mb-4">
              No investment properties yet
            </h2>

            <a
              href="/investors/add-property"
              className="inline-block bg-green-700 text-white px-6 py-3 rounded-xl font-bold"
            >
              Add First Property
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {properties.map((property) => (
              <div
                key={property.id}
                className="bg-white rounded-3xl shadow-md overflow-hidden"
              >
                {property.image_url ? (
                  <img
                    src={property.image_url}
                    alt={property.address}
                    className="h-52 w-full object-cover"
                  />
                ) : (
                  <div className="h-52 bg-gray-300 flex items-center justify-center text-6xl">
                    🏠
                  </div>
                )}

                <div className="p-6">
                  <h3 className="text-xl font-bold mb-2">{property.address}</h3>

                  <p className="text-gray-500 mb-3">
                    {property.city}, {property.county}
                  </p>

                  <p className="font-bold text-green-700 text-2xl mb-2">
                    ${Number(property.asking_price || 0).toLocaleString()}
                  </p>

                  <p className="text-sm font-semibold text-blue-900 mb-3">
                    {property.property_type}
                  </p>

                  <div className="flex gap-4 text-sm mb-3">
                    <span>{property.bedrooms} bd</span>
                    <span>{property.bathrooms} ba</span>
                    <span>{property.sqft} sf</span>
                  </div>

                  <p className="text-gray-700 line-clamp-4">
                    {property.summary}
                  </p>

                  <div className="mt-4 border-t pt-4 text-sm">
                    <p>
                      <strong>ARV:</strong> $
                      {Number(property.arv || 0).toLocaleString()}
                    </p>

                    <p>
                      <strong>Rehab:</strong> $
                      {Number(property.rehab_cost || 0).toLocaleString()}
                    </p>

                    <p>
                      <strong>Rent:</strong> $
                      {Number(property.estimated_rent || 0).toLocaleString()}
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <a
                        href={`/investors/properties/edit/${property.id}`}
                        className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold hover:bg-blue-600"
                      >
                        Edit
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
