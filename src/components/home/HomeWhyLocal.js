export default function HomeWhyLocal() {
  return (
    <section className="bg-blue-950 text-white py-16 px-6 mt-14">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h3 className="text-4xl font-extrabold mb-4">Why Local Matters</h3>

          <p className="text-blue-200 text-lg max-w-3xl mx-auto">
            Every dollar spent locally helps strengthen Southeast Texas
            businesses, families, jobs, shelters, farms, and communities.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="text-center">
            <div className="text-5xl mb-4">🏪</div>
            <h4 className="text-2xl font-bold mb-2">Support Local Business</h4>
            <p className="text-blue-200">
              Help small businesses, contractors, and local sellers grow.
            </p>
          </div>

          <div className="text-center">
            <div className="text-5xl mb-4">🇺🇸</div>
            <h4 className="text-2xl font-bold mb-2">Buy American</h4>
            <p className="text-blue-200">
              Promote Made in USA products and regional manufacturing.
            </p>
          </div>

          <div className="text-center">
            <div className="text-5xl mb-4">🐶</div>
            <h4 className="text-2xl font-bold mb-2">Community First</h4>
            <p className="text-blue-200">
              Support shelters, events, farms, and local causes.
            </p>
          </div>

          <div className="text-center">
            <div className="text-5xl mb-4">🤝</div>
            <h4 className="text-2xl font-bold mb-2">Stronger Together</h4>
            <p className="text-blue-200">
              Build a trusted local network for commerce and connection.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
