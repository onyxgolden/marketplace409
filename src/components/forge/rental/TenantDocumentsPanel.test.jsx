import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import TenantDocumentsPanel from "./TenantDocumentsPanel.jsx";
describe("TenantDocumentsPanel",()=>{
afterEach(()=>{clearSWRCache();});
it("renders an empty secure document surface before loading",async()=>{
  // Seed the SWR cache with an empty library: the converted panel shows the
  // shared loading skeleton on a true cold start, and the empty state once
  // the (empty) library has loaded.
  await fetchWithDedupe("rental:tenant-documents", () => Promise.resolve({ documents: [], preparations: [] }));
  const markup=renderToStaticMarkup(<TenantDocumentsPanel/>);expect(markup).toContain("Lease files and notices");expect(markup).toContain("No documents have been published");
  expect(markup).toContain("not an electronic signature");
});it("states that tenant review is distinct from signing",()=>{const markup=renderToStaticMarkup(<TenantDocumentsPanel/>);expect(markup).toContain("not an electronic signature");});});
