import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/forge/workspace/WorkspaceMembersPanel", () => ({
  default: function MockWorkspaceMembersPanel() {
    return <section data-workspace-members-panel />;
  },
}));

import ForgeWorkspacePage from "./page.jsx";

describe("/forge/workspace", () => {
  it("renders the Workspace Members panel", () => {
    const markup = renderToStaticMarkup(<ForgeWorkspacePage />);
    expect(markup).toContain("data-workspace-members-panel");
  });
});
