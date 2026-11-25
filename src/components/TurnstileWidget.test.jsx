/** @vitest-environment jsdom */
// Tests for src/components/TurnstileWidget.jsx. Synthetic fixtures only;
// Cloudflare is never loaded — window.turnstile is a local mock.
import { describe, expect, it, vi } from "vitest";

import React, { act } from "react";
import { createRoot } from "react-dom/client";

import TurnstileWidget from "./TurnstileWidget.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function mockTurnstile() {
  const callbacks = {};
  return {
    callbacks,
    render: vi.fn((element, options) => {
      callbacks.lastOptions = options;
      return 7;
    }),
    remove: vi.fn(),
  };
}

function renderWidget(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onToken = vi.fn();
  const onExpired = vi.fn();
  const onError = vi.fn();
  act(() => {
    root.render(
      React.createElement(TurnstileWidget, {
        siteKey: "1x00000000000000000000AA",
        action: "auth",
        onToken,
        onExpired,
        onError,
        ...props,
      })
    );
  });
  return { container, root, onToken, onExpired, onError };
}

async function flush() {
  await act(async () => {});
}

describe("TurnstileWidget", () => {
  it("renders the widget with the site key and action, and reports the token", async () => {
    const turnstile = mockTurnstile();
    window.turnstile = turnstile;
    try {
      const { container, root, onToken } = renderWidget();
      await flush();
      expect(turnstile.render).toHaveBeenCalledOnce();
      const [element, options] = turnstile.render.mock.calls[0];
      expect(element).toBe(container.querySelector('[aria-label="Human verification"]'));
      expect(options.sitekey).toBe("1x00000000000000000000AA");
      expect(options.action).toBe("auth");

      act(() => options.callback("0.AQFakeToken"));
      expect(onToken).toHaveBeenCalledWith("0.AQFakeToken");
      act(() => root.unmount());
      expect(turnstile.remove).toHaveBeenCalledWith(7);
    } finally {
      delete window.turnstile;
    }
  });

  it("reports expiry so the parent can clear the spent token", async () => {
    const turnstile = mockTurnstile();
    window.turnstile = turnstile;
    try {
      const { root, onExpired } = renderWidget();
      await flush();
      const [, options] = turnstile.render.mock.calls[0];
      act(() => options["expired-callback"]());
      expect(onExpired).toHaveBeenCalledOnce();
      act(() => root.unmount());
    } finally {
      delete window.turnstile;
    }
  });

  it("shows a plain-words failure with a working Try again button when the widget errors", async () => {
    const turnstile = mockTurnstile();
    window.turnstile = turnstile;
    try {
      const { container, root, onError } = renderWidget();
      await flush();
      const [, options] = turnstile.render.mock.calls[0];
      act(() => options["error-callback"]());
      expect(onError).toHaveBeenCalledOnce();
      const retry = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Try again"
      );
      expect(retry).not.toBeUndefined();
      expect(container.textContent).toMatch(/didn't load/i);

      await act(async () => retry.click());
      expect(turnstile.render).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toMatch(/didn't load/i);
      act(() => root.unmount());
    } finally {
      delete window.turnstile;
    }
  });

  it("fails closed with the retry UI when no site key is configured", async () => {
    const turnstile = mockTurnstile();
    window.turnstile = turnstile;
    try {
      const { container, root } = renderWidget({ siteKey: null });
      await flush();
      expect(turnstile.render).not.toHaveBeenCalled();
      expect(container.textContent).toMatch(/didn't load/i);
      expect(
        [...container.querySelectorAll("button")].some((b) => b.textContent === "Try again")
      ).toBe(true);
      act(() => root.unmount());
    } finally {
      delete window.turnstile;
    }
  });
});
