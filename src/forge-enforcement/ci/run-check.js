import { ForgeEngine } from "../core/engine.js";
import { GrepScanner } from "../scanners/grepScanner.js";
import { AstScanner } from "../scanners/astScanner.js";
import { businessRules } from "../rules/business.rules.js";

const engine = new ForgeEngine(
  businessRules,
  [new GrepScanner(), new AstScanner()]
);

const results = await engine.run({
  files: ["src"]
});

if (results.length > 0) {
  console.error("❌ FORGE VIOLATION DETECTED");
  console.table(results);
  process.exit(1);
}

console.log("✅ FORGE CLEAN");
