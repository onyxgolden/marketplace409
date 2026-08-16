import { Briefcase, Car, Home, PawPrint, TrendingUp } from "lucide-react";

const CATEGORIES = [
  { href: "/browse?category=Vehicles", label: "Vehicles", Icon: Car },
  { href: "/browse?category=Rentals", label: "Rentals", Icon: Home },
  { href: "/jobs", label: "409 Jobs", Icon: Briefcase },
  { href: "/pets", label: "Pets & Shelters", Icon: PawPrint },
  { href: "/investors", label: "Real Estate Investors", Icon: TrendingUp },
];

export default function HomeCategories() {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <h3 className="text-3xl font-bold mb-8 dark:text-white">Popular Categories</h3>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {CATEGORIES.map(({ href, label, Icon }) => (
          <a
            key={href}
            href={href}
            className="bg-white p-6 rounded-2xl shadow-md text-center block hover:shadow-xl hover:-translate-y-0.5 transition"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Icon aria-hidden="true" className="h-6 w-6" />
            </div>
            <h4 className="text-xl font-bold">{label}</h4>
          </a>
        ))}
      </div>
    </section>
  );
}
