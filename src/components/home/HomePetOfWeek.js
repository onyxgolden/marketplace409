export default function HomePetOfWeek({ petOfTheWeek }) {
  return (
    <section className="bg-white py-14 px-6">
      <div className="max-w-5xl mx-auto rounded-3xl shadow-lg overflow-hidden">
        <div className="bg-orange-500 text-white p-6">
          <h3 className="text-3xl font-bold">🐾 Pet of the Week</h3>
        </div>

        {petOfTheWeek ? (
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            {petOfTheWeek.image_url ? (
              <img
                src={petOfTheWeek.image_url}
                alt={petOfTheWeek.pet_name}
                className="h-72 w-full object-cover rounded-2xl"
              />
            ) : (
              <div className="h-72 bg-gray-300 flex items-center justify-center text-7xl rounded-2xl">
                🐾
              </div>
            )}

            <div>
              <h4 className="text-2xl font-bold mb-2">
                Meet {petOfTheWeek.pet_name}
              </h4>

              <p className="text-lg text-gray-700 mb-4">
                {petOfTheWeek.description}
              </p>

              <p className="font-bold mb-4">
                Votes: {petOfTheWeek.votes || 0}
              </p>

              <a
                href="/pets"
                className="inline-block bg-blue-900 text-white px-5 py-3 rounded-xl hover:bg-blue-800"
              >
                Vote for Pet of the Week 🐾 Browse Shelters & Rescues
              </a>
            </div>
          </div>
        ) : (
          <div className="p-8">
            <h4 className="text-2xl font-bold mb-2">No pets entered yet</h4>

            <p className="text-lg text-gray-700 mb-4">
              Add a pet and enter them for Pet of the Week.
            </p>

            <a
              href="/pets/add"
              className="inline-block bg-blue-900 text-white px-5 py-3 rounded-xl hover:bg-blue-800"
            >
              Add Pet Entry
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
