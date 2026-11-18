import ForgeWorkspaceTile from "@/components/forge/workspace/ForgeWorkspaceTile";
import { WorkspaceModule } from "@/components/forge/workspace/composition/WorkspaceModule";

function renderExternalAccountsWorkspaceTile() {
  return (
    <ForgeWorkspaceTile
      eyebrow="Owner administration"
      title="External accounts"
      detail="Every outside account FORGE depends on — providers, logins, billing, and the work waiting on them. Visible only to you and your co-owner."
      href="/forge/platform/external-accounts"
      actionLabel="Open external accounts"
      status="Private"
    />
  );
}

// A bare link like the Health tile: no account data is ever fetched
// into the shared dashboard's read models. The register itself stays
// behind /forge/platform/external-accounts and its household gate.
export const ExternalAccountsWorkspaceModule = new WorkspaceModule({
  moduleIdentity: "external-accounts",
  displayName: "External accounts",
  category: "platform",
  priority: 16,
  renderTile: renderExternalAccountsWorkspaceTile,
  isVisible: (context) => context.isOwnerOrCoOwner === true,
});
