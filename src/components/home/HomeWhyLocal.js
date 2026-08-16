import { Handshake, PawPrint, Store } from "lucide-react";

const REASONS = [
  {
    Icon: Store,
    title: "Support Local Business",
    description: "Help small businesses, contractors, and local sellers grow.",
  },
  {
    flag: true,
    title: "Buy American",
    description: "Promote Made in USA products and regional manufacturing.",
  },
  {
    Icon: PawPrint,
    title: "Community First",
    description: "Support shelters, events, farms, and local causes.",
  },
  {
    Icon: Handshake,
    title: "Stronger Together",
    description: "Build a trusted local network for commerce and connection.",
  },
];

export default function HomeWhyLocal() {
  return (
    <section className="bg-slate-950 text-white py-16 px-6 mt-14">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h3 className="text-4xl font-extrabold mb-4">Why Local Matters</h3>

          <p className="text-slate-300 text-lg max-w-3xl mx-auto">
            Every dollar spent locally helps strengthen Southeast Texas
            businesses, families, jobs, shelters, farms, and communities.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {REASONS.map(({ Icon, flag, title, description }) => (
            <div key={title} className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 border border-white/15">
                {flag ? (
                  <span className="text-2xl" aria-hidden="true">
                    🇺🇸
                  </span>
                ) : (
                  <Icon aria-hidden="true" className="h-6 w-6 text-amber-400" />
                )}
              </div>
              <h4 className="text-2xl font-bold mb-2">{title}</h4>
              <p className="text-slate-300">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
