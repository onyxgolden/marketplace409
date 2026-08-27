import { describe, expect, it } from "vitest";
import { buildIndexRecords } from "../buildIndexRecords.mjs";
import { buildManifest } from "../buildManifest.mjs";

function sampleFiles() {
  return [
    { path: "src/lib/foo.js", blobSha: "sha-foo", content: "export function foo() { return 1; }\nexport const BAR = 2;" },
    { path: "src/app/api/widgets/route.js", blobSha: "sha-route", content: "export async function GET() { return new Response('ok'); }" },
    { path: "src/lib/foo.test.js", blobSha: "sha-test", content: "import { foo } from './foo.js';\nit('works', () => {});" },
    { path: "supabase/migrations/0001_init.sql", blobSha: "sha-mig", content: "create table if not exists widgets (id text primary key);" },
    { path: "docs/architecture/synchronized/FORGE_SYNC_STATUS.md", blobSha: "sha-sync", content: "<!-- FORGE:SYNC:s:START -->hello<!-- FORGE:SYNC:s:END -->" },
    { path: "package.json", blobSha: "sha-pkg", content: JSON.stringify({ dependencies: { react: "19.0.0" } }) },
  ];
}

function runOnce(files, commitSha) {
  const { records, excluded, outOfScope } = buildIndexRecords({ commitSha, files });
  return buildManifest({
    commitSha,
    generatedAt: new Date().toISOString(),
    trackedFiles: files,
    records,
    excluded,
    outOfScope,
    deletedPaths: [],
  });
}

describe("determinism", () => {
  it("two independent runs over identical repository content at the same commit produce the same index content hash", async () => {
    const files = sampleFiles();
    const manifestA = runOnce(files, "commit-sha-1");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const manifestB = runOnce(files, "commit-sha-1");

    expect(manifestA.generated_at).not.toBe(manifestB.generated_at);
    expect(manifestA.index_content_hash).toBe(manifestB.index_content_hash);
  });

  it("changing a single file's content changes the index content hash", () => {
    const files = sampleFiles();
    const manifestA = runOnce(files, "commit-sha-1");

    const mutatedFiles = files.map((file) => (
      file.path === "src/lib/foo.js" ? { ...file, content: file.content + "\n// changed" } : file
    ));
    const manifestB = runOnce(mutatedFiles, "commit-sha-2");

    expect(manifestA.index_content_hash).not.toBe(manifestB.index_content_hash);
  });

  it("record ordering is stable regardless of input file order", () => {
    const files = sampleFiles();
    const reversedFiles = [...files].reverse();
    const manifestA = runOnce(files, "commit-sha-1");
    const manifestB = runOnce(reversedFiles, "commit-sha-1");
    expect(manifestA.records.map((r) => `${r.source_path}#${r.symbol_or_section}`))
      .toEqual(manifestB.records.map((r) => `${r.source_path}#${r.symbol_or_section}`));
  });
});
