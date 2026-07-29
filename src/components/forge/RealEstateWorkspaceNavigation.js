"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ForgeNavigationBar from "@/components/forge/ForgeNavigationBar";

const ITEMS = [
  {
    href: "/investors",
    label: "Dashboard",
    exact: true,
  },
  {
    href: "/investors/properties",
    label: "Properties",
  },
  {
    href: "/investors/add-property",
    label: "Add Property",
  },
  {
    href: "/investors/cash-buyers",
    label: "Cash Buyers",
  },
  {
    href: "/investors/wholesalers",
    label: "Wholesalers",
  },
  {
    href: "/investors/contractors",
    label: "Contractors",
  },
  {
    href: "/investors/documents",
    label: "Documents",
  },
  {
    href: "/investors/rehab-estimator",
    label: "Rehab Estimator",
  },
];

export default function RealEstateWorkspaceNavigation() {
  const pathname = usePathname();

  return (
    <section className="mx-auto max-w-7xl px-6 pt-6">
      <ForgeNavigationBar />

      <nav
        aria-label="Real Estate workspace"
        className="mb-6 rounded-3xl border border-green-200 bg-green-50 p-4 shadow-sm"
      >
        <div className="mb-3">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-green-800">
            Real Estate Workspace
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {ITEMS.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-bold transition",
                  active
                    ? "bg-green-800 text-white shadow-sm"
                    : "border border-green-300 bg-white text-green-900 hover:bg-green-100",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </section>
  );
}
