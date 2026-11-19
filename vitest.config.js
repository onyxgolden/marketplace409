import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    // Marks the shared SWR hydration boundary (src/hooks/swrHydration.js) so
    // component tests that mount consumers without the root layout see the
    // same post-hydration state the running app has. SSR/hydration regression
    // suites reset the store in their own beforeEach.
    setupFiles: ["./vitest.setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
