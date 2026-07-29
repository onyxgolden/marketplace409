"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const ITEMS = [
  { href: "/", label: "🏠 Home" },
  { href: "/forge", label: "⚒ Dashboard" },
  { href: "/forge/financial", label: "📊 Executive KPI" },
  { href: "/investors", label: "🏘 Real Estate" },
  { href: "/forge/connections", label: "🔗 Connections" },
  { href: "/import", label: "📥 Import" },
  { href: "/forge/results", label: "📈 Results" },
];

export default function ForgeNavigationBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="mb-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap gap-3">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href + "/"));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "inline-flex items-center justify-center rounded-2xl px-5 py-3 text-sm font-black uppercase tracking-wide transition",
                active
                  ? "bg-slate-950 text-white shadow"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => router.back()}
          className="inline-flex items-center justify-center rounded-2xl border border-amber-300 bg-amber-50 px-5 py-3 text-sm font-black uppercase tracking-wide text-amber-900 transition hover:bg-amber-100"
        >
          ◀ Back
        </button>
      </div>
    </nav>
  );
}
