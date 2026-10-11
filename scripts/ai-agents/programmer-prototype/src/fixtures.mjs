/**
 * fixtures.mjs — synthetic fixture definitions (pure data).
 * All fixtures are invented, synthetic, and tiny. No real ledger, tenant,
 * scheduling, or production data appears anywhere in the corpus.
 */

export const FIXTURES = {
  lit: {
    id: "lit",
    family: "literal-correction",
    oracle_id: "lit-acceptance-v1",
    oracle_file: "lit.oracle.mjs",
    description: "statusLabel returns the wrong literal for one code",
    files: {
      "src/labels.mjs": `export function statusLabel(code) {
  const table = { active: "Active", paused: "Pause", archived: "Archived" };
  return table[code] ?? "Unknown";
}
`,
    },
  },
  lit2: {
    id: "lit2",
    family: "literal-correction",
    oracle_id: "lit2-acceptance-v1",
    oracle_file: "lit2.oracle.mjs",
    description: "greeting has a misspelled literal",
    files: {
      "src/greeting.mjs": `export function greeting(name) {
  return "Helo, " + name + "!";
}
`,
    },
  },
  bound: {
    id: "bound",
    family: "boundary-correction",
    oracle_id: "bound-acceptance-v1",
    oracle_file: "bound.oracle.mjs",
    description: "inRange uses strict instead of inclusive bounds",
    files: {
      "src/range.mjs": `export function inRange(v, lo, hi) {
  return v > lo && v < hi;
}
`,
    },
  },
  bound2: {
    id: "bound2",
    family: "boundary-correction",
    oracle_id: "bound2-acceptance-v1",
    oracle_file: "bound2.oracle.mjs",
    description: "clampIndex mishandles the upper boundary",
    files: {
      "src/clamp.mjs": `export function clampIndex(i, len) {
  if (i < 0) return 0;
  if (i > len) return len;
  return i;
}
`,
    },
  },
  ser: {
    id: "ser",
    family: "add-helper",
    oracle_id: "ser-acceptance-v1",
    oracle_file: "ser.oracle.mjs",
    description: "pure serializer helper for invented escrow audit events",
    files: {
      "lib/.keep": "safe parent marker for generated pure helpers\n",
    },
  },
  lit3: {
    id: "lit3",
    family: "literal-correction",
    oracle_id: "lit3-acceptance-v1",
    oracle_file: "lit3.oracle.mjs",
    description: "default timeout literal is wrong",
    files: {
      "src/timeout.mjs": `export const DEFAULT_TIMEOUT_MS = 300;
`,
    },
  },
  lit4: {
    id: "lit4",
    family: "literal-correction",
    oracle_id: "lit4-acceptance-v1",
    oracle_file: "lit4.oracle.mjs",
    description: "max retries literal is wrong",
    files: {
      "src/retries.mjs": `export const MAX_RETRIES = 2;
`,
    },
  },
  bound3: {
    id: "bound3",
    family: "boundary-correction",
    oracle_id: "bound3-acceptance-v1",
    oracle_file: "bound3.oracle.mjs",
    description: "pageCount rounds the wrong way at the boundary",
    files: {
      "src/paginate.mjs": `export function pageCount(total, perPage) {
  return Math.floor(total / perPage);
}
`,
    },
  },
  ser2: {
    id: "ser2",
    family: "add-helper",
    oracle_id: "ser2-acceptance-v1",
    oracle_file: "ser2.oracle.mjs",
    description: "pure filter helper for invented escrow audit events",
    files: {
      "lib/.keep": "safe parent marker for generated pure helpers\n",
    },
  },
};

export const FIXTURE_IDS = Object.keys(FIXTURES);
