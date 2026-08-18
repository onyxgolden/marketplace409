import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SchedulingHelpModal from "./SchedulingHelpModal";
import { HELP_SECTIONS, HELP_SHORTCUTS } from "./schedulingHelpContent";

describe("SchedulingHelpModal", () => {
  it("renders the title, a Close button, and every shortcut and section", () => {
    const markup = renderToStaticMarkup(<SchedulingHelpModal onClose={() => {}} />);
    expect(markup).toContain("data-scheduling-help");
    expect(markup).toContain("Gantt Chart guide");
    expect(markup).toContain(">Close<");
    for (const shortcut of HELP_SHORTCUTS) expect(markup).toContain(shortcut.label);
    // React escapes "&" to "&amp;" in the rendered HTML, and a couple of section titles
    // ("Blocks & bars", "Multi-select & linking") contain it.
    for (const section of HELP_SECTIONS) expect(markup).toContain(section.title.replaceAll("&", "&amp;"));
  });
});
