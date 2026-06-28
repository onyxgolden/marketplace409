import fs from "fs";

export class AstScanner {
  async run(context, rules) {
    const results = [];

    for (const file of context.files) {
      const code = fs.readFileSync(file, "utf8");

      for (const rule of rules) {
        if (rule.match({ file, code })) {
          results.push({
            rule: rule.id,
            severity: rule.severity,
            file
          });
        }
      }
    }

    return results;
  }
}
