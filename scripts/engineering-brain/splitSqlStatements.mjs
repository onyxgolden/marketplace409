// Splits a SQL file into individual statements, respecting dollar-quoted function bodies (`$$...$$`
// or `$function$...$function$`), single-quoted string literals, and `--` line comments -- a naive
// split on `;` would break on the very first semicolon inside a plpgsql function body, which every
// RPC migration in this repo has dozens of. Line comments matter here specifically because this
// repo's migration headers are prose-heavy and routinely contain contractions ("they're", "doesn't",
// "wasn't") -- an apostrophe inside a `--` comment, if not recognized as being inside a comment,
// gets misread as opening a real string literal and corrupts every statement boundary after it.
export function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  let inSingleQuote = false;
  let inLineComment = false;
  let dollarTag = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (inLineComment) {
      current += ch;
      if (ch === "\n") inLineComment = false;
      i += 1;
      continue;
    }

    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += "'";
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      inLineComment = true;
      current += "--";
      i += 2;
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      current += ch;
      i += 1;
      continue;
    }

    if (ch === "$") {
      const tagMatch = sql.slice(i).match(/^\$[a-zA-Z_]*\$/);
      if (tagMatch) {
        dollarTag = tagMatch[0];
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }

    if (ch === ";") {
      current += ch;
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

// Comma-splitter that respects nested parens, for function argument lists like
// `p_amount numeric(10,2), p_label text`.
export function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
