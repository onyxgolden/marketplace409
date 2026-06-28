import { execSync } from "child_process";

export class GrepScanner {
  async run(context, rules) {
    const results = [];

    for (const rule of rules) {
      const output = execSync("grep -R . src || true").toString();

      if (output.includes("supabase") || output.includes("BusinessRepository.update")) {
        results.push({
          rule: rule.id,
          severity: "BLOCK"
        });
      }
    }

    return results;
  }
}
