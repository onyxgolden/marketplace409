export default function HomeCommunityHub() {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <h3 className="text-3xl font-bold mb-8">Community Hub</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <a href="/jobs" className="bg-white rounded-2xl shadow-md p-6 block hover:shadow-xl">
          <div className="text-5xl mb-4">💼</div>
          <h4 className="text-xl font-bold mb-2">409 Jobs</h4>
          <p className="text-gray-600 mb-4">
            Find local jobs, side work, hiring opportunities, and Southeast Texas employers.
          </p>
          <span className="text-blue-900 font-bold">View Jobs →</span>
        </a>

        <a href="/businesses" className="bg-white rounded-2xl shadow-md p-6 block hover:shadow-xl">
          <div className="text-5xl mb-4">🏪</div>
          <h4 className="text-xl font-bold mb-2">Local Businesses</h4>
          <p className="text-gray-600 mb-4">
            Discover contractors, shops, vendors, service providers, and local professionals.
          </p>
          <span className="text-blue-900 font-bold">View Businesses →</span>
        </a>

        <a href="/pets" className="bg-white rounded-2xl shadow-md p-6 block hover:shadow-xl">
          <div className="text-5xl mb-4">🐾</div>
          <h4 className="text-xl font-bold mb-2">Pets & Shelters</h4>
          <p className="text-gray-600 mb-4">
            Post lost pets, found pets, adoptable animals, browse local shelters and rescues, and vote for Pet of the Week.
          </p>
          <span className="text-blue-900 font-bold">View Pets →</span>
        </a>
      </div>
    </section>
  );
}
