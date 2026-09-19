// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import StatusTimeline from "./StatusTimeline.jsx";

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmount({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}

const STEPS = [
  { label: "Requested", state: "complete", detail: "Sep 1, 2026" },
  { label: "Confirmed", state: "current" },
  { label: "Checked in", state: "upcoming" },
];

describe("StatusTimeline", () => {
  let mounted;
  afterEach(() => { if (mounted) { unmount(mounted); mounted = null; } });

  it("renders every step label with its detail", () => {
    mounted = mount(<StatusTimeline heading="Reservation progress" steps={STEPS} />);
    expect(mounted.container.textContent).toContain("Reservation progress");
    expect(mounted.container.textContent).toContain("Requested");
    expect(mounted.container.textContent).toContain("Sep 1, 2026");
    expect(mounted.container.textContent).toContain("Confirmed");
    expect(mounted.container.textContent).toContain("Checked in");
  });

  it("marks the current step with aria-current", () => {
    mounted = mount(<StatusTimeline heading="Progress" steps={STEPS} />);
    const current = mounted.container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current.textContent).toContain("Confirmed");
  });

  it("renders nothing when no steps are given", () => {
    mounted = mount(<StatusTimeline heading="Progress" steps={[]} />);
    expect(mounted.container.innerHTML).toBe("");
  });
});
