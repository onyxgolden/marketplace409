// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalHelpModal from "./RentalHelpModal";
import { RENTAL_COMMON_WORKFLOWS, RENTAL_DAILY_WORKFLOW, RENTAL_HELP_GROUPS } from "./rentalHelpContent";

describe("RentalHelpModal", () => {
  let mounted;
  afterEach(() => {
    if (mounted) {
      act(() => mounted.root.unmount());
      mounted.container.remove();
      mounted = null;
    }
  });

  it("leads with contextual help for the active Rental Manager section", () => {
    const markup = renderToStaticMarkup(<RentalHelpModal activeFunctionId="charges" onClose={() => {}} />);
    expect(markup).toContain("data-rental-help");
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("You are viewing");
    expect(markup).toContain("Rent &amp; Payments");
    expect(markup.indexOf("Rent &amp; Payments")).toBeLessThan(markup.indexOf("Daily operating routine"));
  });

  it("renders the daily routine, every common workflow, and every help group", () => {
    const markup = renderToStaticMarkup(<RentalHelpModal activeFunctionId="overview" onClose={() => {}} />);
    for (const step of RENTAL_DAILY_WORKFLOW) expect(markup).toContain(step);
    for (const workflow of RENTAL_COMMON_WORKFLOWS) expect(markup).toContain(workflow.title);
    for (const group of RENTAL_HELP_GROUPS) expect(markup).toContain(group.title);
  });

  it("closes when Escape is pressed", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted = { container, root };
    act(() => root.render(<RentalHelpModal activeFunctionId="maintenance" onClose={onClose} />));
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
