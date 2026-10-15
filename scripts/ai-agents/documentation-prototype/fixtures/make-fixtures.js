#!/usr/bin/env node
/**
 * make-fixtures.js — AUTHORING TOOL (not part of the scored path).
 * Generates fixtures/store.json deterministically from fixtures/gen.js.
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtures } from "./gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { sources } = buildFixtures();
writeFileSync(join(ROOT, "fixtures", "store.json"), JSON.stringify({ sources }, null, 2) + "\n");
console.log(`wrote fixtures/store.json (${Object.keys(sources).length} sources)`);
