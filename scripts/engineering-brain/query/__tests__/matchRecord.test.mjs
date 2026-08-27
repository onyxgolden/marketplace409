import { describe, expect, it } from "vitest";
import { matchRecord, buildQuerySignature, buildMetadataText } from "../matchRecord.mjs";

describe("matchRecord (exact symbol/path/SQL-object and phrase/keyword matching)", () => {
  it("exact-matches a symbol name query against symbol_or_section", () => {
    const record = { source_path: "src/lib/foo.js", symbol_or_section: "resolveEffectiveOwnerId", source_type: "application_source_symbol" };
    const signals = matchRecord(record, buildQuerySignature("resolveEffectiveOwnerId"));
    expect(signals.exactSymbolMatch).toBe(true);
  });

  it("exact-matches a bare function name against a SQL object key that carries an argument-type signature", () => {
    const record = { source_path: "supabase/migrations/x.sql", symbol_or_section: "has_workspace_access(text)", source_type: "sql_rpc_function" };
    const signals = matchRecord(record, buildQuerySignature("has_workspace_access"));
    expect(signals.exactSymbolMatch).toBe(true);
  });

  it("exact-matches a full source path", () => {
    const record = { source_path: "src/lib/foo.js", symbol_or_section: null, source_type: "application_source_file" };
    const signals = matchRecord(record, buildQuerySignature("src/lib/foo.js"));
    expect(signals.exactPathMatch).toBe(true);
  });

  it("exact-matches a bare filename against the end of a longer path", () => {
    const record = { source_path: "src/lib/foo.js", symbol_or_section: null, source_type: "application_source_file" };
    const signals = matchRecord(record, buildQuerySignature("foo.js"));
    expect(signals.exactPathMatch).toBe(true);
  });

  it("does not report an exact match for an unrelated symbol", () => {
    const record = { source_path: "src/lib/foo.js", symbol_or_section: "foo", source_type: "application_source_symbol" };
    const signals = matchRecord(record, buildQuerySignature("bar"));
    expect(signals.exactSymbolMatch).toBe(false);
    expect(signals.exactPathMatch).toBe(false);
  });

  it("phrase-matches a multi-word query against content text", () => {
    const record = { source_path: "docs/x.md", symbol_or_section: null, source_type: "reviewed_decision" };
    const signals = matchRecord(record, buildQuerySignature("primary owner authorization"), "This document explains primary owner authorization rules.");
    expect(signals.exactPhraseMatch).toBe(true);
  });

  it("counts keyword token overlap across metadata and content", () => {
    const record = { source_path: "src/lib/foo.js", symbol_or_section: "foo", source_type: "application_source_symbol" };
    const signals = matchRecord(record, buildQuerySignature("owner workspace access"), "checks owner and workspace state");
    expect(signals.tokenOverlapCount).toBe(2);
  });

  it("buildMetadataText includes structured details so a table-name or route-path filter target is itself searchable", () => {
    const record = { source_path: "supabase/migrations/x.sql", symbol_or_section: "widgets.widgets_owner_all", source_type: "sql_rls_policy", details: { table: "widgets" } };
    expect(buildMetadataText(record)).toContain("widgets");
  });
});
