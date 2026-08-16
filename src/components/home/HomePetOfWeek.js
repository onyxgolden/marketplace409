import { PawPrint } from "lucide-react";

export default function HomePetOfWeek({ petOfTheWeek }) {
  return (
    <section className="bg-white py-14 px-6">
      <div className="max-w-5xl mx-auto rounded-3xl shadow-lg overflow-hidden">
        <div className="bg-slate-950 text-white p-6 flex items-center gap-3">
          <PawPrint aria-hidden="true" className="h-7 w-7 text-amber-400" />
          <h3 className="text-3xl font-bold">Pet of the Week</h3>
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
              <div className="h-72 bg-slate-100 flex items-center justify-center rounded-2xl">
                <PawPrint aria-hidden="true" className="h-16 w-16 text-slate-400" />
              </div>
            )}

            <div>
              <h4 className="text-2xl font-bold mb-2">
                Meet {petOfTheWeek.pet_name}
              </h4>

              <p className="text-lg text-slate-700 mb-4">
                {petOfTheWeek.description}
              </p>

              <p className="font-bold mb-4">
                Votes: {petOfTheWeek.votes || 0}
              </p>

              <a
                href="/pets"
                className="inline-flex items-center gap-2 bg-slate-950 text-white px-5 py-3 rounded-xl hover:bg-slate-800"
              >
                <PawPrint aria-hidden="true" className="h-4 w-4" />
                Vote for Pet of the Week · Browse Shelters & Rescues
              </a>
            </div>
          </div>
        ) : (
          <div className="p-8">
            <h4 className="text-2xl font-bold mb-2">No pets entered yet</h4>

            <p className="text-lg text-slate-700 mb-4">
              Add a pet and enter them for Pet of the Week.
            </p>

            <a
              href="/pets/add"
              className="inline-block bg-slate-950 text-white px-5 py-3 rounded-xl hover:bg-slate-800"
            >
              Add Pet Entry
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
