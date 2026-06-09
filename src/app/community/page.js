import Header from "@/components/Header";
export default function CommunityPage() {
  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      <Header />

      <section className="bg-gradient-to-r from-blue-950 to-red-700 text-white py-20 px-6">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-6xl font-extrabold mb-6">Community Hub</h1>

          <p className="text-2xl text-blue-100 max-w-3xl mx-auto">
            Local events, pets, fundraisers, markets, schools, shelters, and
            community support across Southeast Texas.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto py-12 px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-3xl shadow-lg p-6">
            <div className="text-5xl mb-4">🐶</div>

            <h3 className="text-2xl font-bold mb-3">Pet of the Week</h3>

            <p className="text-gray-600 mb-5">
              Vote for local pets and support shelters.
            </p>

            <button className="bg-blue-900 text-white px-5 py-3 rounded-xl font-bold">
              View Pets
            </button>
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-6">
            <div className="text-5xl mb-4">❤️</div>

            <h3 className="text-2xl font-bold mb-3">Community Support</h3>

            <p className="text-gray-600 mb-5">
              Fundraisers, hardship assistance, and local relief efforts.
            </p>

            <button className="bg-red-600 text-white px-5 py-3 rounded-xl font-bold">
              View Causes
            </button>
          </div>

          <div className="bg-white rounded-3xl shadow-lg p-6">
            <div className="text-5xl mb-4">🌽</div>

            <h3 className="text-2xl font-bold mb-3">Farmers Markets</h3>

            <p className="text-gray-600 mb-5">
              Discover local produce, honey, and handmade goods.
            </p>

            <button className="bg-green-700 text-white px-5 py-3 rounded-xl font-bold">
              View Markets
            </button>
          </div>
        </div>
      </section>

      <footer className="bg-blue-900 text-white py-8 mt-12">
        <div className="max-w-6xl mx-auto text-center">
          <p>© 2026 409 Marketplace — Built for Local Communities</p>
        </div>
      </footer>
    </main>
  );
}
