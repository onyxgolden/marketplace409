import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // no-undef catches a reference to a name that resolves nowhere in scope -- e.g. a variable
  // declared in one component and used, unpassed, inside a sibling component's own function
  // scope (a real production crash this caught in an audit: see the scheduling drawer incident).
  // Scoped to JS/JSX only: TypeScript files already get this from tsc itself, and no-undef has
  // known false positives against TS-only syntax (ambient types, global augmentation, etc.) --
  // see typescript-eslint's own recommendation to disable it for .ts/.tsx.
  {
    files: ["**/*.js", "**/*.jsx"],
    rules: {
      "no-undef": "error",
    },
  },
  // vitest.config.js sets globals: true (describe/it/expect/vi/etc. are injected at test-run
  // time without an import) -- ESLint has no way to know that on its own, so without this every
  // test file would fail the no-undef rule just added above on every one of those names. Vitest's
  // API is jest-compatible for everything except its mocking utility (vi instead of jest), so
  // globals.jest already covers the rest.
  {
    files: ["**/*.test.js", "**/*.test.jsx"],
    languageOptions: {
      globals: {
        ...globals.jest,
        vi: "readonly",
      },
    },
  },
]);

export default eslintConfig;
