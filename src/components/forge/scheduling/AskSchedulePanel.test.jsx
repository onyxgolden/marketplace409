// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskSchedulePanel } from "./AskSchedulePanel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ANSWER = {
  success: true,
  question: "What is the critical path?",
  questionType: "critical_path",
  summary: "2 critical activities; project finishes 2026-01-26.",
  items: [
    { taskCode: "A1010", label: "Mobilize", detail: "2026-01-05 → 2026-01-09" },
    { taskCode: "A1020", label: "Framing", detail: "2026-01-12 → 2026-01-23" },
  ],
  supportedQuestions: [],
};

function jsonResponse(body, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

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
    await Promise.resolve();
  });
}

function typeInto(container, value) {
  const input = container.querySelector('input[aria-label="Ask a question about the schedule"]');
  // Bypass React's value tracker so the native input event actually fires onChange.
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

function submitForm(container) {
  const form = container.querySelector("form");
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function clickButton(container, name) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === name);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return button;
}

describe("AskSchedulePanel", () => {
  let mounted;

  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => {
    if (mounted) unmount(mounted);
    mounted = null;
    vi.restoreAllMocks();
  });

  it("renders preset question chips and the read-only explainer", () => {
    mounted = mount(<AskSchedulePanel projectId="p1" />);
    expect(mounted.container.textContent).toContain("Ask the Schedule");
    expect(mounted.container.textContent).toContain("Read-only — nothing here changes the schedule.");
    expect(mounted.container.textContent).toContain("What is the critical path?");
    expect(mounted.container.textContent).toContain("Which milestones are late?");
  });

  it("asks a typed question and renders the deterministic answer", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(ANSWER));
    mounted = mount(<AskSchedulePanel projectId="p1" />);
    typeInto(mounted.container, "What is the critical path?");
    submitForm(mounted.container);
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/forge/scheduling/p1/ask",
      expect.objectContaining({ method: "POST" }),
    );
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).question).toBe("What is the critical path?");
    expect(mounted.container.textContent).toContain(ANSWER.summary);
    expect(mounted.container.textContent).toContain("A1010 — Mobilize");
    expect(mounted.container.textContent).toContain("A1020 — Framing");
  });

  it("asks immediately when a preset chip is tapped", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse(ANSWER));
    mounted = mount(<AskSchedulePanel projectId="p1" />);
    clickButton(mounted.container, "Which milestones are late?");
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, options] = global.fetch.mock.calls[0];
    expect(JSON.parse(options.body).question).toBe("Which milestones are late?");
  });

  it("shows an error when the API fails", async () => {
    global.fetch.mockReturnValueOnce(jsonResponse({ error: "Nope." }, false));
    mounted = mount(<AskSchedulePanel projectId="p1" />);
    typeInto(mounted.container, "What is the critical path?");
    submitForm(mounted.container);
    await flush();

    expect(mounted.container.querySelector('[role="alert"]').textContent).toBe("Nope.");
  });
});
