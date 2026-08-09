import ForgeApplicationRail from "@/components/forge/ForgeApplicationRail";

export default function ForgeLayout({
  children,
}) {
  return (
    <ForgeApplicationRail>
      {children}
    </ForgeApplicationRail>
  );
}
