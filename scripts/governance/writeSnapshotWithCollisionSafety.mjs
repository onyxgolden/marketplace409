import fs from "node:fs";
import path from "node:path";

/**
 * Allocates a snapshot path with a collision-safe, sortable session ID.
 * Millisecond-precision session IDs (forge-session-YYYYMMDD-HHMMSSmmm)
 * make same-timestamp collisions rare, but not impossible -- two
 * collections spawned within the same millisecond, or any caller that
 * happens to reuse a session ID, must still both succeed without either
 * one overwriting the other.
 *
 * The exclusive ("wx") write flag makes each attempt atomic: the
 * filesystem itself is the single source of truth for "does this name
 * already exist", not a separate existsSync check that could race with
 * another writer. On a genuine collision the loop retries with a
 * zero-padded numeric suffix, which sorts immediately after its base name
 * (e.g. forge-session-20260811-153000123-01.json).
 */
export function writeSnapshotWithCollisionSafety({
  snapshotDirectory,
  baseSessionId,
  buildContent,
}) {
  fs.mkdirSync(snapshotDirectory, {
    recursive: true,
  });

  for (let suffix = 0; ; suffix += 1) {
    const candidateSessionId =
      suffix === 0
        ? baseSessionId
        : `${baseSessionId}-${String(suffix).padStart(2, "0")}`;

    const candidatePath = path.join(
      snapshotDirectory,
      `${candidateSessionId}.json`,
    );

    try {
      fs.writeFileSync(
        candidatePath,
        buildContent(candidateSessionId),
        {
          encoding: "utf8",
          flag: "wx",
        },
      );

      return {
        sessionId: candidateSessionId,
        snapshotPath: candidatePath,
      };
    } catch (error) {
      if (error.code === "EEXIST") {
        continue;
      }

      throw error;
    }
  }
}
