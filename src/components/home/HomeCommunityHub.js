import { Briefcase, PawPrint, Store } from "lucide-react";

const HUB_CARDS = [
  {
    href: "/jobs",
    Icon: Briefcase,
    title: "409 Jobs",
    description:
      "Find local jobs, side work, hiring opportunities, and Southeast Texas employers.",
    cta: "View Jobs →",
  },
  {
    href: "/businesses",
    Icon: Store,
    title: "Local Businesses",
    description:
      "Discover contractors, shops, vendors, service providers, and local professionals.",
    cta: "View Businesses →",
  },
  {
    href: "/pets",
    Icon: PawPrint,
    title: "Pets & Shelters",
    description:
      "Post lost pets, found pets, adoptable animals, browse local shelters and rescues, and vote for Pet of the Week.",
    cta: "View Pets →",
  },
];

export default function HomeCommunityHub() {
  return (
    <section className="max-w-6xl mx-auto py-12 px-6">
      <h3 className="text-3xl font-bold mb-8">Community Hub</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {HUB_CARDS.map(({ href, Icon, title, description, cta }) => (
          <a
            key={href}
            href={href}
            className="bg-white rounded-2xl shadow-md p-6 block hover:shadow-xl"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white">
              <Icon aria-hidden="true" className="h-6 w-6" />
            </div>
            <h4 className="text-xl font-bold mb-2">{title}</h4>
            <p className="text-slate-600 mb-4">{description}</p>
            <span className="text-amber-600 font-bold">{cta}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
