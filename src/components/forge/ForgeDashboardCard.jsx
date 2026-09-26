import Link from "next/link";
import { forgeTheme } from "@/components/forge/theme";

// Dashboard KPI tile. When `href` is provided, the number itself is a deep
// link into the detail view/report behind it -- dashboard numbers are never
// dead static text.
export default function ForgeDashboardCard({ label, value, detail, href = null }) {
  const number = (
    <div className="mt-3 text-3xl font-black text-slate-950 dark:text-white">
      {value}
    </div>
  );

  return (
    <div className={forgeTheme.cardCompact}>
      <div className={forgeTheme.labelSmall}>{label}</div>
      {href ? (
        <Link
          href={href}
          aria-label={`${label} — view details`}
          data-dashboard-card-link={href}
          className="block rounded-lg transition hover:opacity-70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
        >
          {number}
        </Link>
      ) : (
        number
      )}
      {detail && <div className={`mt-2 ${forgeTheme.textSmall}`}>{detail}</div>}
    </div>
  );
}
