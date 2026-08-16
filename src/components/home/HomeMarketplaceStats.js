import { Briefcase, PawPrint, Store, Tag } from "lucide-react";

export default function HomeMarketplaceStats({
  listingsCount,
  businessesCount,
  petsCount,
  jobsCount,
}) {
  const stats = [
    { Icon: Tag, value: listingsCount, label: "Live Listings" },
    { Icon: Store, value: businessesCount, label: "Local Businesses" },
    { Icon: PawPrint, value: petsCount, label: "Pet Posts" },
    { Icon: Briefcase, value: jobsCount, label: "Local Jobs" },
  ];

  return (
    <section className="max-w-6xl mx-auto py-10 px-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map(({ Icon, value, label }) => (
          <div key={label} className="bg-white rounded-2xl shadow-md p-6 text-center">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-600">
              <Icon aria-hidden="true" className="h-5 w-5" />
            </div>
            <h3 className="text-4xl font-extrabold text-slate-950">{value || 0}</h3>
            <p className="text-slate-600 mt-2">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
