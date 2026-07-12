import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();

const synchronizedDirectory = path.join(
  repositoryRoot,
  "docs",
  "architecture",
  "synchronized",
);

const policyDirectory = path.join(repositoryRoot, "governance", "policies");

const editableSectionsPath = path.join(
  policyDirectory,
  "editable-sections.json",
);

const requiredPolicyFiles = [
  "capabilities.json",
  "editable-sections.json",
  "immutable-sections.json",
  "promotion-policy.json",
  "validation-rules.json",
];

const requiredShadowDocuments = [
  "FORGE_SYNC_CONTROL_CENTER.md",
  "FORGE_SYNC_STATUS.md",
  "FORGE_SYNC_SESSION.md",
  "FORGE_SYNC_ROADMAP.md",
  "FORGE_SYNC_EVALUATION.md",
];

const shadowWarning = "EXPERIMENTAL SHADOW GOVERNANCE DOCUMENT";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${path.relative(repositoryRoot, filePath)} is not valid JSON`);
    return null;
  }
}

function extractMarkers(content) {
  const markerPattern =
    /<!-- FORGE:(SYNC|HUMAN):([^:]+):(START|END) -->/g;

  const markers = [];
  let match;

  while ((match = markerPattern.exec(content)) !== null) {
    markers.push({
      authority: match[1],
      sectionId: match[2],
      boundary: match[3],
    });
  }

  return markers;
}

function verifyMarkerPairs(documentName, content, documentPolicy) {
  const markers = extractMarkers(content);
  const markerState = new Map();

  for (const marker of markers) {
    const key = `${marker.authority}:${marker.sectionId}`;

    if (!markerState.has(key)) {
      markerState.set(key, {
        starts: 0,
        ends: 0,
      });
    }

    const state = markerState.get(key);

    if (marker.boundary === "START") {
      state.starts += 1;
    } else {
      state.ends += 1;
    }
  }

  for (const [key, state] of markerState.entries()) {
    if (state.starts !== 1 || state.ends !== 1) {
      fail(
        `${documentName} marker ${key} must have exactly one START and one END`,
      );
    }
  }

  const syncSections = new Set(
    markers
      .filter((marker) => marker.authority === "SYNC")
      .map((marker) => marker.sectionId),
  );

  const humanSections = new Set(
    markers
      .filter((marker) => marker.authority === "HUMAN")
      .map((marker) => marker.sectionId),
  );

  const expectedEditableSections = new Set(
    documentPolicy.editableSections,
  );

  const expectedHumanSections = new Set(
    documentPolicy.humanControlledSections,
  );

  for (const sectionId of expectedEditableSections) {
    if (!syncSections.has(sectionId)) {
      fail(`${documentName} is missing SYNC section ${sectionId}`);
    }
  }

  for (const sectionId of syncSections) {
    if (!expectedEditableSections.has(sectionId)) {
      fail(`${documentName} has unauthorized SYNC section ${sectionId}`);
    }
  }

  for (const sectionId of expectedHumanSections) {
    if (!humanSections.has(sectionId)) {
      fail(`${documentName} is missing HUMAN section ${sectionId}`);
    }
  }

  for (const sectionId of humanSections) {
    if (!expectedHumanSections.has(sectionId)) {
      fail(`${documentName} has unrecognized HUMAN section ${sectionId}`);
    }
  }

  const expectedMarkerPairs =
    expectedEditableSections.size + expectedHumanSections.size;

  if (markerState.size !== expectedMarkerPairs) {
    fail(
      `${documentName} has ${markerState.size} marker pairs; expected ${expectedMarkerPairs}`,
    );
    return;
  }

  pass(`${documentName} marker structure matches policy`);
}

for (const policyFile of requiredPolicyFiles) {
  const policyPath = path.join(policyDirectory, policyFile);
  const policy = readJson(policyPath);

  if (policy) {
    pass(`${policyFile} is valid JSON`);
  }
}

const editableSectionsPolicy = readJson(editableSectionsPath);

if (!editableSectionsPolicy) {
  process.exit(1);
}

for (const documentName of requiredShadowDocuments) {
  const documentPath = path.join(synchronizedDirectory, documentName);

  if (!fs.existsSync(documentPath)) {
    fail(`${documentName} does not exist`);
    continue;
  }

  const content = fs.readFileSync(documentPath, "utf8");

  if (!content.includes(shadowWarning)) {
    fail(`${documentName} is missing the experimental shadow warning`);
  } else {
    pass(`${documentName} contains the experimental warning`);
  }

  const documentPolicy =
    editableSectionsPolicy.documents[documentName];

  if (!documentPolicy) {
    fail(`${documentName} has no editable-sections policy`);
    continue;
  }

  verifyMarkerPairs(documentName, content, documentPolicy);
}

const configuredDocuments = Object.keys(
  editableSectionsPolicy.documents,
);

for (const configuredDocument of configuredDocuments) {
  if (!requiredShadowDocuments.includes(configuredDocument)) {
    fail(
      `${configuredDocument} is configured but not registered as a required shadow document`,
    );
  }
}

if (process.exitCode) {
  console.error("\nShadow governance verification failed.");
  process.exit(process.exitCode);
}

console.log("\nShadow governance verification passed.");
