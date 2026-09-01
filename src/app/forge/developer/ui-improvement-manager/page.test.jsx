import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ loadProgrammerAuthorization: vi.fn() }));
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({ loadProgrammerAuthorization: mocks.loadProgrammerAuthorization }));
vi.mock("@/components/forge/developer/UiImprovementManagerPanel", () => ({
  default: function MockUiImprovementManagerPanel() {
    return <section data-ui-improvement-manager-panel-mounted />;
  },
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import UiImprovementManagerPage from "./page.jsx";

describe("/forge/developer/ui-improvement-manager", () => {
  it("renders the panel for an authorized programmer", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: true, user: { email: "jasonmorgan99@gmail.com" } });
    const markup = renderToStaticMarkup(await UiImprovementManagerPage());
    expect(markup).toContain("data-ui-improvement-manager-panel-mounted");
  });

  it("calls notFound() for an unauthorized caller -- same gate as the main developer page", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: null });
    await expect(UiImprovementManagerPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("calls notFound() when the authorization check itself failed", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: false, authorized: false, user: null });
    await expect(UiImprovementManagerPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
