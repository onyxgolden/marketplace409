export default function HomeBusinessSpotlight({ featuredBusinesses }) {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <div className="bg-white rounded-3xl shadow-md p-8">
        <div className="flex flex-col md:flex-row justify-between gap-6 items-center">
          <div>
            <p className="text-sm uppercase tracking-wide text-gray-500 mb-2">
              Support Local Business
            </p>

            <h3 className="text-3xl font-bold mb-3">
              Local Business Spotlight
            </h3>

            <p className="text-gray-600 text-lg">
              Featuring real Southeast Texas businesses, contractors, makers,
              farms, shelters, and service providers.
            </p>
          </div>

          <a
            href="/businesses"
            className="bg-blue-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-800"
          >
            View Businesses
          </a>
        </div>

        {!featuredBusinesses || featuredBusinesses.length === 0 ? (
          <div className="mt-8 bg-gray-100 rounded-2xl p-6 text-center">
            <h4 className="text-2xl font-bold mb-2">No businesses yet</h4>
            <p className="text-gray-600">
              Add a local business to appear in the spotlight.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
            {featuredBusinesses.map((business) => (
              <a
                key={business.id}
                href="/businesses"
                className="border rounded-2xl p-5 block hover:shadow-xl"
              >
                {business.image_url ? (
                  <img
                    src={business.image_url}
                    alt={business.name}
                    className="h-36 w-full object-cover rounded-xl mb-4"
                  />
                ) : (
                  <div className="text-4xl mb-3">🏪</div>
                )}

                <h4 className="text-xl font-bold">{business.name}</h4>

                <p className="text-sm text-gray-500 mt-1">{business.city}</p>

                <p className="text-gray-600 mt-2 line-clamp-3">
                  {business.description}
                </p>

                <p className="mt-3 text-sm font-bold text-blue-900">
                  {business.category}
                </p>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
