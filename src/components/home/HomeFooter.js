export default function HomeFooter() {
  return (
    <footer className="bg-blue-900 text-white py-10 mt-10">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <h4 className="text-2xl font-bold mb-3">409 Marketplace</h4>
          <p className="text-blue-200">
            409 Marketplace connects Southeast Texas listings, businesses,
            jobs, pets, shelters, and real estate investor resources.
          </p>
        </div>

        <div>
          <h5 className="font-bold mb-3">Marketplace</h5>
          <p className="text-blue-100">Browse Listings</p>
          <p className="text-blue-100">Post Listing</p>
          <p className="text-blue-100">Import Listing</p>
        </div>

        <div>
          <h5 className="font-bold mb-3">Community</h5>
          <p className="text-blue-100">Pet & Shelters</p>
          <p className="text-blue-100">409 Jobs</p>
          <p className="text-blue-100">Local Businesses</p>
        </div>

        <div>
          <h5 className="font-bold mb-3">Local Business</h5>
          <p className="text-blue-100">Business Directory</p>
          <p className="text-blue-100">Add Business</p>
          <p className="text-blue-100">Post a Job</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 mt-8 pt-6 border-t border-blue-700 text-center text-blue-100">
        © 2026 409 Marketplace — Built for Local Communities
      </div>
    </footer>
  );
}
