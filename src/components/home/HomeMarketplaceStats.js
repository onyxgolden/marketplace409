export default function HomeMarketplaceStats({
  listingsCount,
  businessesCount,
  petsCount,
  jobsCount,
}) {
  return (
    <section className="max-w-6xl mx-auto py-10 px-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        <div className="bg-white rounded-2xl shadow-md p-6 text-center">
          <h3 className="text-4xl font-extrabold text-blue-900">
            {listingsCount || 0}
          </h3>
          <p className="text-gray-600 mt-2">Live Listings</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6 text-center">
          <h3 className="text-4xl font-extrabold text-red-600">
            {businessesCount || 0}
          </h3>
          <p className="text-gray-600 mt-2">Local Businesses</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6 text-center">
          <h3 className="text-4xl font-extrabold text-green-700">
            {petsCount || 0}
          </h3>
          <p className="text-gray-600 mt-2">Pet Posts</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-6 text-center">
          <h3 className="text-4xl font-extrabold text-purple-700">
            {jobsCount || 0}
          </h3>
          <p className="text-gray-600 mt-2">Local Jobs</p>
        </div>
      </div>
    </section>
  );
}
