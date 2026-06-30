export default function HomeCategories() {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <h3 className="text-3xl font-bold mb-8">Popular Categories</h3>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        <a
          href="/browse?category=Vehicles"
          className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
        >
          🚗
          <h4 className="text-xl font-bold mt-3">Vehicles</h4>
        </a>

        <a
          href="/browse?category=Rentals"
          className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
        >
          🏠
          <h4 className="text-xl font-bold mt-3">Rentals</h4>
        </a>

        <a
          href="/jobs"
          className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
        >
          💼
          <h4 className="text-xl font-bold mt-3">409 Jobs</h4>
        </a>

        <a
          href="/pets"
          className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
        >
          🐶
          <h4 className="text-xl font-bold mt-3">Pets & Shelters</h4>
        </a>

        <a
          href="/investors"
          className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl"
        >
          🏘
          <h4 className="text-xl font-bold mt-3">Real Estate Investors</h4>
        </a>
      </div>
    </section>
  );
}
