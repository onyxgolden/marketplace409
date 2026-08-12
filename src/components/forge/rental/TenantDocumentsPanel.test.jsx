import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TenantDocumentsPanel from "./TenantDocumentsPanel.jsx";
describe("TenantDocumentsPanel",()=>{it("renders an empty secure document surface before loading",()=>{
  const markup=renderToStaticMarkup(<TenantDocumentsPanel/>);expect(markup).toContain("Lease files and notices");expect(markup).toContain("No documents have been published");
});});
