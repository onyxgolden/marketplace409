import { execFileSync } from "node:child_process";

// Every read in this module goes through `git`, never `fs`, for the tracked-file listing and file
// contents -- that's what makes the indexer deterministic per-commit rather than per-working-tree:
// two checkouts of the same commit (one with stray untracked files, one without) must produce byte-
// identical index output, and reading through git rather than the filesystem is what guarantees that.

export function runGit(args, { cwd = process.cwd() } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 64,
    }).replace(/\n$/, "");
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message || "Unknown Git command failure";
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export function resolveCommitSha(cwd = process.cwd()) {
  return runGit(["rev-parse", "HEAD"], { cwd });
}

// Lists every file tracked at `commitSha`, each with its git blob SHA -- git's own content address,
// which the incremental-hash pass (see incrementalReuse.mjs) reuses as a free, already-deterministic
// "did this file's bytes change" check with zero extra hashing.
export function listTrackedFiles(commitSha, cwd = process.cwd()) {
  const output = runGit(["ls-tree", "-r", "--full-tree", commitSha], { cwd });
  if (!output) return [];
  return output.split("\n").map((line) => {
    const [meta, filePath] = line.split("\t");
    const [mode, type, blobSha] = meta.split(" ");
    return { path: filePath, mode, type, blobSha };
  }).filter((entry) => entry.type === "blob");
}

// Reads file content at the exact commit, not from the working tree -- see the determinism note
// above. Returns null for binary blobs git can't decode as utf8 text (images, etc.) rather than
// throwing, since binary files are simply not indexable content.
export function readFileAtCommit(commitSha, filePath, cwd = process.cwd()) {
  try {
    return execFileSync("git", ["show", `${commitSha}:${filePath}`], {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch {
    return null;
  }
}

// Reads every migration file at a commit, sorted by path (this repo's forward-only,
// timestamp-prefixed convention -- the same order Postgres itself would apply them). Used by the
// Phase 2 query layer to re-derive a SQL object's current-effective definition on demand, reusing
// listTrackedFiles/readFileAtCommit rather than re-implementing tracked-file discovery.
export function readMigrationsAtCommit(commitSha, cwd = process.cwd()) {
  return listTrackedFiles(commitSha, cwd)
    .filter((entry) => /^supabase\/migrations\/.*\.sql$/.test(entry.path))
    .map((entry) => ({ path: entry.path, content: readFileAtCommit(commitSha, entry.path, cwd) }))
    .filter((file) => file.content !== null)
    .sort((a, b) => a.path.localeCompare(b.path));
}
