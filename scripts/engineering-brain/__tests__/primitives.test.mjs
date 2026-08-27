import { describe, expect, it } from "vitest";
import { classifyDenylist } from "../denylist.mjs";
import { classifySourceFile } from "../classifySourceFile.mjs";
import { deriveApiRoutePath } from "../deriveApiRoutePath.mjs";
import { extractSyncDocSections } from "../extractSyncDocSections.mjs";
import { splitSqlStatements } from "../splitSqlStatements.mjs";
import { deriveAssociatedSourcePaths } from "../pairTestWithSource.mjs";
import { extractPackageVersions } from "../extractPackageVersions.mjs";
import { buildManifest } from "../buildManifest.mjs";

describe("denylist", () => {
  it("excludes .env files with a specific reason", () => {
    expect(classifyDenylist(".env.local")).toBe("env_file");
  });
  it("excludes node_modules as a dependency", () => {
    expect(classifyDenylist("node_modules/react/index.js")).toBe("dependency");
  });
  it("does not exclude ordinary application source", () => {
    expect(classifyDenylist("src/lib/foo.js")).toBeNull();
  });
});

describe("classifySourceFile", () => {
  it("classifies an API route file distinctly from generic application source", () => {
    expect(classifySourceFile("src/app/api/workspace/members/route.js")).toBe("api_route");
  });
  it("classifies a migration file", () => {
    expect(classifySourceFile("supabase/migrations/0001_init.sql")).toBe("sql_migration");
  });
  it("returns null for a file outside every indexed category", () => {
    expect(classifySourceFile("public/favicon.ico")).toBeNull();
  });
});

describe("deriveApiRoutePath", () => {
  it("derives the URL path from the App Router file path", () => {
    expect(deriveApiRoutePath("src/app/api/workspace/members/route.js")).toBe("/api/workspace/members");
  });
  it("returns null for a non-route file", () => {
    expect(deriveApiRoutePath("src/app/api/workspace/members/page.js")).toBeNull();
  });
});

describe("extractSyncDocSections", () => {
  it("splits a FORGE_SYNC document into its individually addressable sections", () => {
    const content = [
      "<!-- FORGE:SYNC:active_phase:START -->\nPhase text\n<!-- FORGE:SYNC:active_phase:END -->",
      "<!-- FORGE:HUMAN:protected_rules:START -->\nRule text\n<!-- FORGE:HUMAN:protected_rules:END -->",
    ].join("\n\n");
    const sections = extractSyncDocSections(content);
    expect(sections.map((s) => s.sectionId)).toEqual(["active_phase", "protected_rules"]);
    expect(sections[0].owner).toBe("sync");
    expect(sections[1].owner).toBe("human");
  });
});

describe("splitSqlStatements", () => {
  it("does not split on a semicolon inside a dollar-quoted body", () => {
    const statements = splitSqlStatements("create function f() returns void language plpgsql as $$ begin raise notice 'x'; end; $$;");
    expect(statements).toHaveLength(1);
  });
  it("splits multiple simple statements", () => {
    const statements = splitSqlStatements("create table a (id text); create table b (id text);");
    expect(statements).toHaveLength(2);
  });
  it("does not treat an apostrophe inside a -- line comment as opening a string literal", () => {
    const statements = splitSqlStatements("-- a comment that's got an apostrophe in it\ncreate table a (id text);\ncreate table b (id text);");
    expect(statements).toHaveLength(2);
    expect(statements[1].trim()).toBe("create table b (id text);");
  });
});

describe("deriveAssociatedSourcePaths", () => {
  it("pairs a test file with its same-directory source file by naming convention", () => {
    const tracked = new Set(["src/lib/foo.js", "src/lib/foo.test.js"]);
    expect(deriveAssociatedSourcePaths("src/lib/foo.test.js", tracked)).toEqual(["src/lib/foo.js"]);
  });
  it("returns an empty list when no convention-matching source file exists", () => {
    const tracked = new Set(["src/lib/foo.integration.test.js"]);
    expect(deriveAssociatedSourcePaths("src/lib/foo.integration.test.js", tracked)).toEqual([]);
  });
});

describe("extractPackageVersions", () => {
  it("extracts dependencies and devDependencies with a group label", () => {
    const entries = extractPackageVersions(JSON.stringify({
      dependencies: { react: "19.0.0" },
      devDependencies: { vitest: "4.1.9" },
    }));
    expect(entries).toEqual([
      { name: "react", version: "19.0.0", group: "dependency" },
      { name: "vitest", version: "4.1.9", group: "dev_dependency" },
    ]);
  });
});

describe("deleted-source handling in the manifest", () => {
  it("reports a deleted path in counts without including it among current records", () => {
    const manifest = buildManifest({
      commitSha: "sha",
      generatedAt: "2026-01-01T00:00:00.000Z",
      trackedFiles: [{ path: "a.js", blobSha: "sha-a" }],
      records: [{ source_path: "a.js", source_type: "application_source_file", symbol_or_section: null, commit_sha: "sha", content_hash: "h", authority_level: "current", version: null }],
      excluded: [],
      outOfScope: [],
      deletedPaths: ["removed.js"],
    });
    expect(manifest.counts.deleted_total).toBe(1);
    expect(manifest.deleted_paths).toEqual(["removed.js"]);
    expect(manifest.records.some((r) => r.source_path === "removed.js")).toBe(false);
  });
});
