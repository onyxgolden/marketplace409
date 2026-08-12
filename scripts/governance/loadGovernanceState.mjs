import fs from "node:fs";
import path from "node:path";

const defaultStatePath =
  "governance/state/current-governance-state.json";

export function loadGovernanceState(
  suppliedPath = defaultStatePath,
  {
    repositoryRoot = process.cwd(),
  } = {},
) {
  if (
    typeof suppliedPath !== "string" ||
    suppliedPath.trim().length === 0
  ) {
    throw new TypeError(
      "suppliedPath must be a non-empty string",
    );
  }

  if (
    typeof repositoryRoot !== "string" ||
    repositoryRoot.trim().length === 0
  ) {
    throw new TypeError(
      "repositoryRoot must be a non-empty string",
    );
  }

  const absolutePath = path.resolve(
    /* turbopackIgnore: true */
    repositoryRoot,
    suppliedPath,
  );

  const relativePath = path.relative(
    /* turbopackIgnore: true */
    repositoryRoot,
    absolutePath,
  );

  if (
    !fs.existsSync(
      /* turbopackIgnore: true */
      absolutePath,
    )
  ) {
    throw new Error(
      `Governance state does not exist: ${relativePath}`,
    );
  }

  let content;

  try {
    content = fs.readFileSync(
      /* turbopackIgnore: true */
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `Governance state could not be read: ${relativePath}: ${error.message}`,
    );
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Governance state is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }
}
