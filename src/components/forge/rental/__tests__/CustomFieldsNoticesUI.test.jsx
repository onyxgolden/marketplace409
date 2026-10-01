import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CustomFieldsSettingsPanel from "../CustomFieldsSettingsPanel.jsx";
import CustomFieldsEditor from "../CustomFieldsEditor.jsx";
import NoticeFormsPanel from "../NoticeFormsPanel.jsx";
import NoticeLogList from "../NoticeLogList.jsx";

// Rentec parity R15 — static-markup presence tests for the new UI shells.
// Data loads through fetch in useEffect, which does not run under
// renderToStaticMarkup, so these assert the stable headings, tabs, and
// loading states (behavioral detail is covered by the API/domain tests).

describe("CustomFieldsSettingsPanel", () => {
  it("renders the plain-English shell with the four entity tabs", () => {
    const markup = renderToStaticMarkup(<CustomFieldsSettingsPanel />);
    expect(markup).toContain("Custom fields");
    expect(markup).toContain("Tenants");
    expect(markup).toContain("Leases");
    expect(markup).toContain("Units");
    expect(markup).toContain("Properties");
    expect(markup).toContain("Loading fields…");
  });
});

describe("CustomFieldsEditor", () => {
  it("renders the custom fields shell in its loading state", () => {
    const markup = renderToStaticMarkup(<CustomFieldsEditor groups={[{ entity: "tenant", recordId: "t1" }]} />);
    expect(markup).toContain("Custom fields");
    expect(markup).toContain("Loading fields…");
  });
});

describe("NoticeLogList", () => {
  it("renders the loading state", () => {
    const markup = renderToStaticMarkup(<NoticeLogList tenantId="t1" />);
    expect(markup).toContain("Loading notice log…");
  });
});

describe("NoticeFormsPanel", () => {
  it("renders the three builder tabs and the legal caution", () => {
    const markup = renderToStaticMarkup(<NoticeFormsPanel />);
    expect(markup).toContain("Notices &amp; forms");
    expect(markup).toContain("Library");
    expect(markup).toContain("Builder");
    expect(markup).toContain("Generate &amp; log");
    expect(markup).toContain("confirm notice language");
  });

  it("mentions the standard notice family in its copy", () => {
    const markup = renderToStaticMarkup(<NoticeFormsPanel />);
    expect(markup).toContain("pay-or-quit");
  });
});
