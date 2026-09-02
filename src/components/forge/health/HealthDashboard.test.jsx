import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import HealthDashboard from "./HealthDashboard";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: vi.fn(), rpc: vi.fn() }) }));

describe("HealthDashboard", () => {
  it("requires explicit private workspace setup", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={null} />);
    expect(markup).toContain("Create our private health workspace");
    expect(markup).toContain("Only the two explicitly added accounts");
  });

  it("renders the complete private health navigation", () => {
    const markup = renderToStaticMarkup(<HealthDashboard initialMembership={{ workspace_id: "health-1", role: "owner" }} />);
    for (const label of ["Overview", "Labs", "Regimen", "Peptides", "Workouts", "Timeline"]) expect(markup).toContain(label);
  });
});
