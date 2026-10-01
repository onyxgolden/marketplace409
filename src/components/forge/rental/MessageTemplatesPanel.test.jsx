import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MessageTemplatesPanel from "./MessageTemplatesPanel";

describe("message templates panel", () => {
  it("renders the library shell with filters and the new-template action", () => {
    const markup = renderToStaticMarkup(<MessageTemplatesPanel />);
    expect(markup).toContain("Message templates");
    expect(markup).toContain("New template");
    expect(markup).toContain("All kinds");
    expect(markup).toContain("All audiences");
    expect(markup).toContain("System templates are read-only");
    expect(markup).toContain("Loading templates…");
  });

  it("documents the merge-field syntax next to the library", () => {
    const markup = renderToStaticMarkup(<MessageTemplatesPanel />);
    expect(markup).toContain("{{field}}");
  });
});
