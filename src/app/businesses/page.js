import BusinessAdminControls from "@/components/BusinessAdminControls";
import ShareButton from "@/components/ShareButton";
import Header from "@/components/Header";
import { BusinessRepository } from "@/domains/business";

export const dynamic = "force-dynamic";

export default async function BusinessesPage() {
  let businesses = [];
let error = null;

try {
  businesses = await BusinessRepository.getAll();
} catch (err) {
  error = err;
}

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="max-w-6xl mx-auto py-12 px-6">
        <h1 className="text-5xl font-extrabold mb-4">
          Local Business Directory
        </h1>

        <p className="text-xl text-gray-600 mb-8">
          Discover Southeast Texas businesses, services, shops, vendors, and
          local professionals.
        </p>

        <a
          href="/businesses/add"
          className="inline-block bg-red-600 text-white px-6 py-3 rounded-xl font-bold mb-8 hover:bg-red-500"
        >
          Add Local Business
        </a>

        {error && (
          <div className="bg-red-100 text-red-700 p-4 rounded-xl mb-6">
            Could not load businesses.
          </div>
        )}

        {!businesses || businesses.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-md p-8 text-center">
            <h2 className="text-2xl font-bold mb-2">No businesses yet</h2>
            <p className="text-gray-600">
              Be the first to add a local Southeast Texas business.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {businesses.map((business) => (
              <div
                key={business.id}
                className="bg-white rounded-2xl shadow-md overflow-hidden"
              >
                {business.image_url ? (
                  <img
                    src={business.image_url}
                    alt={business.name}
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="h-44 bg-blue-100 flex items-center justify-center text-6xl">
                    🏪
                  </div>
                )}

                <div className="p-5">
                  <p className="text-sm text-gray-500">{business.address?.city}</p>

                  <a href={`/businesses/${business.id}`} className="block">
                    <h2 className="text-xl font-bold hover:text-red-600">
                      {business.name}
                    </h2>
                  </a>

                  <p className="text-sm text-gray-500 mt-2">
                    {business.category}
                  </p>
                  {business.trust_tags && business.trust_tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {business.trust_tags.map((tag) => (
                        <span
                          key={tag}
                          className="bg-blue-100 text-blue-900 px-3 py-1 rounded-full text-xs font-bold"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 text-gray-600 max-h-44 overflow-y-auto pr-2">
                    {business.description}
                  </div>

                  {business.contact?.phone && (
                    <a
                      href={`tel:${business.contact.phone}`}
                      className="block mt-4 bg-green-700 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Call
                    </a>
                  )}

                  {business.contact?.website_url && (
                    <a
                      href={business.contact.website_url}
                      target="_blank"
                      className="block mt-3 bg-blue-900 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Website
                    </a>
                  )}

                  {business.facebook_url && (
                    <a
                      href={business.facebook_url}
                      target="_blank"
                      className="block mt-3 bg-blue-600 text-white text-center py-3 rounded-xl font-bold"
                    >
                      Facebook
                    </a>
                  )}

                  <ShareButton
                    title={business.name}
                    url={`https://409marketplace.online/businesses`}
                  />

                  <BusinessAdminControls businessId={business.id} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
