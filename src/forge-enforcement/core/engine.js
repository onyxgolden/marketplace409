import { FORGE_MODE } from "../config.js";

export class ForgeEngine {
  constructor(rules, scanners) {
    this.rules = rules;
    this.scanners = scanners;
  }

  async run(context) {
    const results = [];

    for (const scanner of this.scanners) {
      const scanResults = await scanner.run(context, this.rules);
      results.push(...scanResults);
    }

    return this.handleResults(results);
  }

  handleResults(results) {
    if (FORGE_MODE === "DEV") {
      console.log("🟡 FORGE DEV MODE - warnings only");
      console.table(results);
      return [];
    }

    if (FORGE_MODE === "SAFE") {
      const critical = results.filter(r => r.severity === "BLOCK");

      if (critical.length > 0) {
        console.error("❌ FORGE SAFE MODE BLOCK");
        console.table(critical);
        process.exit(1);
      }

      return results;
    }

    if (FORGE_MODE === "STRICT") {
      if (results.length > 0) {
        console.error("❌ FORGE STRICT MODE BLOCK");
        console.table(results);
        process.exit(1);
      }
    }

    return results;
  }
}
