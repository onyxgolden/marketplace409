// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalTeamPanel from "./RentalTeamPanel.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const response = (body) => ({ ok: true, json: async () => body });
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }
function click(button) { return act(async () => { button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); }

describe("RentalTeamPanel follow-up G25 (O-21)", () => {
  let root;
  afterEach(() => { if (root) act(() => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); clearSWRCache(); });

  async function renderPanel(members) {
    const calls = [];
    const live = [...members];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/api/rental/team/audit")) return response({ audit: [] });
      if (options?.method === "PATCH") {
        const body = JSON.parse(options.body);
        const member = live.find((m) => m.id === body.memberId);
        if (body.statusAction === "remove" || body.statusAction === "cancel") {
          const index = live.findIndex((m) => m.id === body.memberId);
          if (index >= 0) live.splice(index, 1);
        }
        if (body.statusAction === "resend" && member) member.invitedAt = "2026-11-01T00:00:00Z";
        return response({ success: true, member: member || null });
      }
      return response({ members: live, viewerId: "viewer_1", permissionCatalog: [] });
    }));
    const container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<RentalTeamPanel />)); await flush();
    return { container, calls };
  }

  it("invited members get resend and cancel; active members get two-step remove", async () => {
    const { container, calls } = await renderPanel([
      { id: "m_inv", memberUserId: "u_inv", email: "invited@example.test", role: "manager", status: "invited", invitedAt: "2026-10-20T00:00:00Z", permissionOverrides: {} },
      { id: "m_act", memberUserId: "u_act", email: "active@example.test", role: "manager", status: "active", permissionOverrides: {} },
    ]);
    const invited = container.querySelector("[data-team-member='m_inv']");
    expect(invited.textContent).toContain("Resend invite");
    expect(invited.textContent).toContain("Cancel invite");
    await click([...invited.querySelectorAll("button")].find((b) => b.textContent === "Resend invite"));
    const resend = calls.find((c) => c.options?.method === "PATCH" && JSON.parse(c.options.body).statusAction === "resend");
    expect(resend).toBeDefined();
    expect(container.textContent).toContain("Invite resent");

    const invitedFresh = container.querySelector("[data-team-member='m_inv']");
    await click([...invitedFresh.querySelectorAll("button")].find((b) => b.textContent === "Cancel invite"));
    const cancel = calls.find((c) => c.options?.method === "PATCH" && JSON.parse(c.options.body).statusAction === "cancel");
    expect(cancel).toBeDefined();
    expect(container.querySelector("[data-team-member='m_inv']")).toBeNull();

    const active = container.querySelector("[data-team-member='m_act']");
    await click([...active.querySelectorAll("button")].find((b) => b.textContent === "Remove"));
    const activeConfirm = container.querySelector("[data-team-member='m_act']");
    await click([...activeConfirm.querySelectorAll("button")].find((b) => b.textContent === "Remove this member?"));
    const remove = calls.find((c) => c.options?.method === "PATCH" && JSON.parse(c.options.body).statusAction === "remove");
    expect(remove).toBeDefined();
    expect(container.querySelector("[data-team-member='m_act']")).toBeNull();
  });

  it("suspended members show the reactivate note instead of role or permission controls", async () => {
    const { container } = await renderPanel([
      { id: "m_sus", memberUserId: "u_sus", email: "suspended@example.test", role: "manager", status: "suspended", permissionOverrides: {} },
    ]);
    const suspended = container.querySelector("[data-team-member='m_sus']");
    expect(suspended.textContent).toContain("Role and permissions can be changed after reactivating this member.");
    expect(suspended.textContent).toContain("Reactivate");
    expect(suspended.querySelector("select")).toBeNull();
  });
});
