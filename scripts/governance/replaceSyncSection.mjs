import fs from "node:fs";

const markerPattern =
  /<!-- FORGE:SYNC:([^:]+):(START|END) -->/g;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSectionPattern(sectionId) {
  const escaped = escapeRegExp(sectionId);

  return new RegExp(
    `<!-- FORGE:SYNC:${escaped}:START -->([\\s\\S]*?)<!-- FORGE:SYNC:${escaped}:END -->`,
    "m",
  );
}

export function replaceSyncSectionContent(
  documentContent,
  sectionId,
  replacementContent,
) {
  if (typeof documentContent !== "string") {
    throw new TypeError("documentContent must be a string");
  }

  if (
    typeof sectionId !== "string" ||
    sectionId.trim().length === 0
  ) {
    throw new TypeError("sectionId must be a non-empty string");
  }

  if (typeof replacementContent !== "string") {
    throw new TypeError("replacementContent must be a string");
  }

  const pattern = buildSectionPattern(sectionId);

  if (!pattern.test(documentContent)) {
    throw new Error(
      `SYNC section "${sectionId}" was not found.`,
    );
  }

  return documentContent.replace(
    pattern,
    [
      `<!-- FORGE:SYNC:${sectionId}:START -->`,
      "",
      replacementContent.trimEnd(),
      "",
      `<!-- FORGE:SYNC:${sectionId}:END -->`,
    ].join("\n"),
  );
}

export function replaceSyncSectionInFile(
  filePath,
  sectionId,
  replacementContent,
) {
  const original = fs.readFileSync(filePath, "utf8");

  const updated = replaceSyncSectionContent(
    original,
    sectionId,
    replacementContent,
  );

  fs.writeFileSync(filePath, updated, "utf8");
}

export function listSyncSections(documentContent) {
  const sections = [];

  let match;

  while ((match = markerPattern.exec(documentContent)) !== null) {
    if (match[2] === "START") {
      sections.push(match[1]);
    }
  }

  return sections;
}
