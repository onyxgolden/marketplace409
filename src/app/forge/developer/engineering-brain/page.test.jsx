import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ loadProgrammerAuthorization: vi.fn() }));
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({ loadProgrammerAuthorization: mocks.loadProgrammerAuthorization }));
vi.mock("@/components/forge/developer/EngineeringBrainPanel", () => ({
  default: function MockEngineeringBrainPanel() {
    return <section data-engineering-brain-panel-mounted />;
  },
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));

import ForgeEngineeringBrainPage from "./page.jsx";

describe("/forge/developer/engineering-brain", () => {
  it("renders the panel for an authorized programmer", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: true, user: { email: "jasonmorgan99@gmail.com" } });
    const markup = renderToStaticMarkup(await ForgeEngineeringBrainPage());
    expect(markup).toContain("data-engineering-brain-panel-mounted");
  });

  it("calls notFound() for an unauthorized caller -- same gate as the main developer page", async () => {
    mocks.loadProgrammerAuthorization.mockResolvedValue({ ok: true, authorized: false, user: null });
    await expect(ForgeEngineeringBrainPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
