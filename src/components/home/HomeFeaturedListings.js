export default function HomeFeaturedListings({ featuredListings }) {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <div className="flex justify-between items-center mb-8">
        <h3 className="text-3xl font-bold">Featured Local Listings</h3>

        <a href="/browse" className="text-blue-900 font-bold">
          View All
        </a>
      </div>

      {!featuredListings || featuredListings.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-md p-8 text-center">
          <h4 className="text-2xl font-bold mb-2">No listings yet</h4>
          <p className="text-gray-600">
            Be the first to post something local.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredListings.map((listing) => (
            <a
              key={listing.id}
              href={`/listing/${listing.id}`}
              className="bg-white rounded-2xl shadow-md overflow-hidden block hover:shadow-xl"
            >
              {listing.image_url ? (
                <img
                  src={listing.image_url}
                  alt={listing.title}
                  className="h-44 w-full object-cover"
                />
              ) : (
                <div className="h-44 bg-gray-300 flex items-center justify-center text-5xl">
                  📦
                </div>
              )}

              <div className="p-5">
                <p className="text-sm text-gray-500">{listing.city}</p>

                <h4 className="text-xl font-bold">{listing.title}</h4>

                <p className="text-2xl font-bold text-green-700 mt-2">
                  {listing.price}
                </p>

                <p className="mt-3 text-gray-600 line-clamp-3">
                  {listing.description}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
