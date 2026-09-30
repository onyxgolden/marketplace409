// @vitest-environment jsdom

// DesignerHelpModal: plain-language help panel for the room Designer.
// Contract: lists shortcuts and topics from designerHelpContent, and closes
// on Escape, backdrop click, or the X button — never on a click inside the
// card itself.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import DesignerHelpModal from "./DesignerHelpModal";
import { HELP_SECTIONS, HELP_SHORTCUTS } from "./designerHelpContent";

let root = null;
let container = null;

function renderModal(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(React.createElement(DesignerHelpModal, props));
  });
  return document.body;
}

afterEach(() => {
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  if (container) {
    container.remove();
    container = null;
  }
});

describe("DesignerHelpModal", () => {
  it("renders every shortcut and topic from designerHelpContent", () => {
    const body = renderModal({ onClose: () => {} });
    for (const s of HELP_SHORTCUTS) {
      expect(body.textContent).toContain(s.label);
      expect(body.textContent).toContain(s.description);
    }
    for (const s of HELP_SECTIONS) {
      expect(body.textContent).toContain(s.label);
      expect(body.textContent).toContain(s.description);
    }
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on a click inside the card", () => {
    const onClose = vi.fn();
    const body = renderModal({ onClose });
    const card = body.querySelector('[role="dialog"] > div');
    act(() => {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = body.querySelector('[role="dialog"]');
    act(() => {
      backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes via the X button", () => {
    const onClose = vi.fn();
    const body = renderModal({ onClose });
    const closeBtn = body.querySelector('button[aria-label="Close"]');
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
