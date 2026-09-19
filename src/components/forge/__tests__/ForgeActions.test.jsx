// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ForgeActionButton,
  ForgeActionLink,
  ForgeActionStack,
} from "../ForgeActions.jsx";

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

describe("ForgeActions", () => {
  let mounted = null;
  afterEach(() => {
    if (mounted) {
      unmount(mounted);
      mounted = null;
    }
  });

  describe("ForgeActionButton", () => {
    it("meets the 44px minimum touch target (min-h-11)", () => {
      mounted = mount(<ForgeActionButton>Apply</ForgeActionButton>);
      const button = mounted.container.querySelector("button");
      expect(button.className).toMatch(/min-h-11/);
    });

    it("goes full width on mobile and auto width on sm+", () => {
      mounted = mount(<ForgeActionButton>Apply</ForgeActionButton>);
      const button = mounted.container.querySelector("button");
      expect(button.className).toMatch(/w-full/);
      expect(button.className).toMatch(/sm:w-auto/);
    });

    it("centers its label so the whole target is tappable", () => {
      mounted = mount(<ForgeActionButton>Apply</ForgeActionButton>);
      const button = mounted.container.querySelector("button");
      expect(button.className).toMatch(/justify-center/);
    });

    it("applies variant styles and keeps a visible focus ring", () => {
      mounted = mount(<ForgeActionButton variant="accent">Use</ForgeActionButton>);
      const button = mounted.container.querySelector("button");
      expect(button.className).toMatch(/bg-amber-500/);
      expect(button.className).toMatch(/focus-visible:outline/);
    });

    it("defaults to a button type and forwards handlers and disabled state", () => {
      const onClick = vi.fn();
      mounted = mount(
        <ForgeActionButton onClick={onClick} disabled>
          Apply
        </ForgeActionButton>,
      );
      const button = mounted.container.querySelector("button");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.disabled).toBe(true);
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe("ForgeActionLink", () => {
    it("renders a link with the same thumb-friendly sizing as the button", () => {
      mounted = mount(
        <ForgeActionLink href="/forge/connections">Review</ForgeActionLink>,
      );
      const link = mounted.container.querySelector("a");
      expect(link).not.toBeNull();
      expect(link.getAttribute("href")).toBe("/forge/connections");
      expect(link.className).toMatch(/min-h-11/);
      expect(link.className).toMatch(/w-full/);
      expect(link.className).toMatch(/sm:w-auto/);
      expect(link.className).toMatch(/justify-center/);
    });

    it("supports an inline variant for links inside a row of text", () => {
      mounted = mount(
        <ForgeActionLink href="/forge/inbox" inline>
          Open
        </ForgeActionLink>,
      );
      const link = mounted.container.querySelector("a");
      expect(link.className).toMatch(/inline-flex/);
      expect(link.className).toMatch(/min-h-11/);
      expect(link.className).not.toMatch(/w-full/);
    });
  });

  describe("ForgeActionStack", () => {
    it("stacks actions vertically, full width on mobile", () => {
      mounted = mount(
        <ForgeActionStack>
          <ForgeActionButton>Apply</ForgeActionButton>
          <ForgeActionButton>Dismiss</ForgeActionButton>
        </ForgeActionStack>,
      );
      const stack = mounted.container.firstElementChild;
      expect(stack.className).toMatch(/flex-col/);
      expect(stack.className).toMatch(/gap-2/);
      expect(stack.className).toMatch(/w-full/);
      expect(stack.className).toMatch(/sm:items-end/);
    });
  });
});
