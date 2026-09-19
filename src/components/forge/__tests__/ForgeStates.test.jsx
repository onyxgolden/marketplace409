// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ForgeEmptyState,
  ForgeErrorState,
  ForgeLoadingState,
} from "../ForgeStates.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

function unmount(mounted) {
  act(() => {
    mounted.root.unmount();
  });
  mounted.container.remove();
}

describe("ForgeStates", () => {
  let mounted = null;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
  });

  describe("ForgeLoadingState", () => {
    it("announces the label through role=status", () => {
      mounted = mount(<ForgeLoadingState label="Loading your budget…" />);
      const status = mounted.container.querySelector('[role="status"]');
      expect(status).not.toBeNull();
      expect(status.textContent).toContain("Loading your budget…");
    });
  });

  describe("ForgeEmptyState", () => {
    it("renders the headline and guidance", () => {
      mounted = mount(
        <ForgeEmptyState
          headline="No budget categories yet."
          guidance="Add one from your spending history below."
        />,
      );
      const text = mounted.container.textContent;
      expect(text).toContain("No budget categories yet.");
      expect(text).toContain("Add one from your spending history below.");
    });

    it("renders an action button that fires onAction", () => {
      const onAction = vi.fn();
      mounted = mount(
        <ForgeEmptyState
          headline="Nothing here."
          actionLabel="Add one"
          onAction={onAction}
        />,
      );
      const button = mounted.container.querySelector("button");
      expect(button).not.toBeNull();
      expect(button.textContent).toBe("Add one");
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onAction).toHaveBeenCalledTimes(1);
    });

    it("renders no action when no label is given", () => {
      mounted = mount(<ForgeEmptyState headline="Nothing here." />);
      expect(mounted.container.querySelector("button")).toBeNull();
      expect(mounted.container.querySelector("a")).toBeNull();
    });
  });

  describe("ForgeErrorState", () => {
    it("alerts with the title and detail", () => {
      mounted = mount(
        <ForgeErrorState
          title="Financial data failed to load."
          detail="boom"
        />,
      );
      const alert = mounted.container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toBe("Financial data failed to load.");
      expect(mounted.container.textContent).toContain("boom");
    });

    it("renders a retry button only when onRetry is given", () => {
      const onRetry = vi.fn();
      mounted = mount(<ForgeErrorState title="Nope." onRetry={onRetry} />);
      const button = mounted.container.querySelector("button");
      expect(button).not.toBeNull();
      expect(button.textContent).toBe("Retry");
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("uses a custom retry label", () => {
      mounted = mount(
        <ForgeErrorState
          title="Nope."
          onRetry={() => {}}
          retryLabel="Reload"
        />,
      );
      expect(mounted.container.querySelector("button").textContent).toBe(
        "Reload",
      );
    });

    it("omits the retry slot without an onRetry handler", () => {
      mounted = mount(<ForgeErrorState title="Nope." />);
      expect(mounted.container.querySelector("button")).toBeNull();
    });
  });
});
