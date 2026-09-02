// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import WorkspaceHubGrid from "./WorkspaceHubGrid.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const WORKSPACES = [
  { id: "marketplace", name: "Marketplace", href: "/market", iconName: "Store", description: "Buy and sell." },
  { id: "forge", name: "Forge", href: "/forge", iconName: "Hammer", description: "Operations." },
];
const HEALTH_SHORTCUT = { id: "health", name: "Health", href: "/forge/health", iconName: "HeartPulse", description: "Private records." };
const STATS = { marketplace: "12 listings", forge: "3 accounts" };

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return { container, root };
}
function unmount({ container, root }) {
  act(() => root.unmount());
  container.remove();
}
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("WorkspaceHubGrid", () => {
  let mounted;

  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.unstubAllGlobals();
  });

  it("renders every workspace tile plus the health shortcut when supplied", () => {
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={HEALTH_SHORTCUT} initialFavoriteWorkspaceId={null} />);
    expect(mounted.container.textContent).toContain("Marketplace");
    expect(mounted.container.textContent).toContain("Forge");
    expect(mounted.container.textContent).toContain("Health");
  });

  it("omits the health tile entirely when no shortcut is supplied", () => {
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={null} initialFavoriteWorkspaceId={null} />);
    expect(mounted.container.textContent).not.toContain("Health");
  });

  it("marks the initial favorite's star as pressed and no others", () => {
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={HEALTH_SHORTCUT} initialFavoriteWorkspaceId="forge" />);
    const buttons = [...mounted.container.querySelectorAll("button")];
    const forgeStar = buttons.find((b) => b.closest("a").textContent.includes("Forge"));
    const marketplaceStar = buttons.find((b) => b.closest("a").textContent.includes("Marketplace"));
    expect(forgeStar.getAttribute("aria-pressed")).toBe("true");
    expect(marketplaceStar.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking a star sets that workspace as favorite and un-favorites the previous one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, favoriteWorkspaceId: "marketplace" }) });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={null} initialFavoriteWorkspaceId="forge" />);

    const buttons = [...mounted.container.querySelectorAll("button")];
    const marketplaceStar = buttons.find((b) => b.closest("a").textContent.includes("Marketplace"));
    await act(async () => {
      marketplaceStar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/preferences/favorite-workspace", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ favoriteWorkspaceId: "marketplace" }),
    }));

    const buttonsAfter = [...mounted.container.querySelectorAll("button")];
    const forgeStarAfter = buttonsAfter.find((b) => b.closest("a").textContent.includes("Forge"));
    const marketplaceStarAfter = buttonsAfter.find((b) => b.closest("a").textContent.includes("Marketplace"));
    expect(marketplaceStarAfter.getAttribute("aria-pressed")).toBe("true");
    expect(forgeStarAfter.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking the current favorite's star clears it (sends null)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, favoriteWorkspaceId: null }) });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={null} initialFavoriteWorkspaceId="forge" />);

    const forgeStar = [...mounted.container.querySelectorAll("button")].find((b) => b.closest("a").textContent.includes("Forge"));
    await act(async () => {
      forgeStar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/preferences/favorite-workspace", expect.objectContaining({
      body: JSON.stringify({ favoriteWorkspaceId: null }),
    }));
  });

  it("reverts the optimistic update if the save request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={null} initialFavoriteWorkspaceId={null} />);

    const marketplaceStar = [...mounted.container.querySelectorAll("button")].find((b) => b.closest("a").textContent.includes("Marketplace"));
    await act(async () => {
      marketplaceStar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await flush();
    });

    expect(marketplaceStar.getAttribute("aria-pressed")).toBe("false");
  });

  it("clicking a star does not navigate the enclosing link", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    mounted = mount(<WorkspaceHubGrid workspaces={WORKSPACES} stats={STATS} healthShortcut={null} initialFavoriteWorkspaceId={null} />);

    const marketplaceStar = [...mounted.container.querySelectorAll("button")].find((b) => b.closest("a").textContent.includes("Marketplace"));
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    await act(async () => {
      marketplaceStar.dispatchEvent(event);
      await flush();
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
