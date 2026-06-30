import { forgeTheme } from "@/components/forge/theme";

export default function ForgeDashboardCard({ label, value, detail }) {
  return (
    <div className={forgeTheme.cardCompact}>
      <div className={forgeTheme.labelSmall}>{label}</div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      {detail && <div className={`mt-2 ${forgeTheme.textSmall}`}>{detail}</div>}
    </div>
  );
}
