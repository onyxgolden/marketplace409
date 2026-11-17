// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Wiring tests for the P1 fix round: each promoted-workspace layout must
// consult the server-checked programmer boolean and hand it to
// WorkspaceShell, so a non-programmer never sees the Dev tile on Rental,
// Scheduling, Marketplace (or any other promoted route) — desktop or
// mobile — while an authorized programmer keeps it, including inside the
// developer subtree itself. The loader is mocked here; the real
// per-request memoization lives in loadProgrammerAuthorization.js and the
// boolean logic is covered by the helper's own tests.
const { getUser, signOut, signOutSafely, isProgrammerAuthorized } = vi.hoisted(() => {
  const state = { user: { email: "jason@example.com" } };
  return {
    getUser: vi.fn(() => Promise.resolve({ data: { user: state.user } })),
    signOut: vi.fn(() => Promise.resolve({})),
    signOutSafely: vi.fn(() => Promise.resolve({ success: true, error: null })),
    isProgrammerAuthorized: vi.fn(() => Promise.resolve(false)),
    __state: state,
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/forge/rental",
  // PlannerNavBar (Work / Work Packages layouts) reads search params;
  // PlannerProjectScopeBar (Work layout) navigates.
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/theme/ThemeProvider", () => ({
  useTheme: () => ({ resolvedTheme: "dark", setThemePreference: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser, signOut } }),
}));
// Mocked so this file tests "did the layout call the server check and pass
// its result through" in isolation — the helper's own cache-clearing and
// failure behavior is tested directly against the loader module.
vi.mock("@/lib/auth/signOutSafely.js", () => ({
  signOutSafely,
  friendlySignOutError: (error) => error?.message ?? "Sign-out didn't complete. Please try again.",
}));
vi.mock("@/lib/supabase/loadProgrammerAuthorization", () => ({
  isProgrammerAuthorized,
}));

import RentalWorkspaceLayout from "@/app/forge/rental/layout.jsx";
import SchedulingWorkspaceLayout from "@/app/forge/scheduling/layout.jsx";
import MarketLayout from "@/app/market/layout.jsx";
import DevWorkspaceLayout from "@/app/forge/developer/layout.jsx";
import ChartsWorkspaceLayout from "@/app/forge/charts/layout.jsx";
import DesignerWorkspaceLayout from "@/app/forge/designer/layout.jsx";
import PrivateFinancingWorkspaceLayout from "@/app/forge/private-financing/layout.jsx";
import ReservationsWorkspaceLayout from "@/app/forge/reservations/layout.jsx";
import WorkPackagePlannerLayout from "@/app/forge/work/layout.jsx";
import WorkPackagesPlannerLayout from "@/app/forge/work-packages/layout.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted = null;

async function mountLayout(Layout) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const element = await Layout({ children: <main>layout content</main> });
  act(() => {
    root.render(element);
  });
  await act(async () => {});
  mounted = { container, root };
  return container;
}

beforeEach(() => {
  isProgrammerAuthorized.mockClear();
  isProgrammerAuthorized.mockResolvedValue(false);
  getUser.mockClear();
  signOut.mockClear();
  signOutSafely.mockClear();
  signOutSafely.mockResolvedValue({ success: true, error: null });
});

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
    mounted = null;
  }
});

describe("promoted-workspace layout wiring", () => {
  // Every promoted-workspace layout, not just the three the verdict names:
  // they all share the same one-line wiring, and a dropped call in any of
  // them would silently re-advertise the 404 from that subtree.
  const promoted = [
    ["Rental", RentalWorkspaceLayout],
    ["Scheduling", SchedulingWorkspaceLayout],
    ["Marketplace", MarketLayout],
    ["Charts", ChartsWorkspaceLayout],
    ["Designer", DesignerWorkspaceLayout],
    ["Private Financing", PrivateFinancingWorkspaceLayout],
    ["Reservations", ReservationsWorkspaceLayout],
    ["Work", WorkPackagePlannerLayout],
    ["Work Packages", WorkPackagesPlannerLayout],
  ];

  it.each(promoted)(
    "%s hides the Dev link for a non-programmer and consults the server check",
    async (_name, Layout) => {
      const container = await mountLayout(Layout);
      // The layout must ask the server — a dropped call would still hide Dev
      // through the shell's fail-closed default, but silently; this pins the
      // wiring itself.
      expect(isProgrammerAuthorized).toHaveBeenCalled();
      expect(container.querySelector('a[href="/forge/developer"]')).toBeNull();
      expect(container.querySelector('a[href="/forge/rental"]')).not.toBeNull();
    },
  );

  it.each(promoted)(
    "%s shows the Dev link for an authorized programmer",
    async (_name, Layout) => {
      isProgrammerAuthorized.mockResolvedValue(true);
      const container = await mountLayout(Layout);
      expect(isProgrammerAuthorized).toHaveBeenCalled();
      expect(container.querySelector('a[href="/forge/developer"]')).not.toBeNull();
    },
  );

  it("Developer layout keeps the Dev link for an authorized programmer — the subtree's own gate", async () => {
    isProgrammerAuthorized.mockResolvedValue(true);
    const container = await mountLayout(DevWorkspaceLayout);
    expect(isProgrammerAuthorized).toHaveBeenCalled();
    expect(container.querySelector('a[href="/forge/developer"]')).not.toBeNull();
  });

  it("Developer layout fails closed when authorization is denied", async () => {
    const container = await mountLayout(DevWorkspaceLayout);
    expect(isProgrammerAuthorized).toHaveBeenCalled();
    expect(container.querySelector('a[href="/forge/developer"]')).toBeNull();
  });
});
