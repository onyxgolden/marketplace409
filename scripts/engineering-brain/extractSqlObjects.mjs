import { splitSqlStatements, splitTopLevelCommas } from "./splitSqlStatements.mjs";

function normalizeFunctionArgTypes(argsString) {
  if (!argsString || !argsString.trim()) return "";
  return splitTopLevelCommas(argsString)
    .map((param) => {
      const withoutDefault = param.split(/\bdefault\b/i)[0].trim();
      const tokens = withoutDefault.split(/\s+/).filter(Boolean);
      const typeTokens = tokens.length > 1 ? tokens.slice(1) : tokens;
      return typeTokens.join(" ").toLowerCase();
    })
    .join(",");
}

const PATTERNS = Object.freeze({
  createTable: /^create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][\w]*)"?/i,
  createPolicy: /^create\s+policy\s+"([^"]+)"\s+on\s+"?([a-zA-Z_][\w]*)"?/i,
  dropPolicy: /^drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+"?([a-zA-Z_][\w]*)"?/i,
  createTrigger: /^create\s+trigger\s+"?([a-zA-Z_][\w]*)"?[\s\S]*?\son\s+"?([a-zA-Z_][\w]*)"?/i,
  dropTrigger: /^drop\s+trigger\s+(?:if\s+exists\s+)?"?([a-zA-Z_][\w]*)"?\s+on\s+"?([a-zA-Z_][\w]*)"?/i,
  createFunction: /^create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-zA-Z_][\w]*)"?\s*\(([^)]*)\)/i,
  dropFunction: /^drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][\w]*)"?\s*\(([^)]*)\)/i,
});

// splitSqlStatements() only splits on `;`, so a header comment block with no statement terminator of
// its own (the normal case -- comments don't end in semicolons) gets glued onto the *front* of
// whatever real statement follows it. Every PATTERNS.* regex is anchored with `^`, so without
// stripping that leading comment block first, the very first statement after any header comment
// would never classify as anything -- silently dropping the first function/table/policy/trigger
// defined in a file whenever it's preceded by explanatory comments, which is the norm in this repo.
function stripLeadingCommentLines(statement) {
  const lines = statement.split("\n");
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (line === "" || line.startsWith("--")) {
      start += 1;
    } else {
      break;
    }
  }
  return lines.slice(start).join("\n").trim();
}

function classifyStatement(rawStatement) {
  const statement = stripLeadingCommentLines(rawStatement);
  let match;
  if ((match = statement.match(PATTERNS.createFunction))) {
    return { objectType: "rpc_function", action: "create", key: `${match[1]}(${normalizeFunctionArgTypes(match[2])})`, name: match[1] };
  }
  if ((match = statement.match(PATTERNS.dropFunction))) {
    return { objectType: "rpc_function", action: "drop", key: `${match[1]}(${normalizeFunctionArgTypes(match[2])})`, name: match[1] };
  }
  if ((match = statement.match(PATTERNS.createPolicy))) {
    return { objectType: "rls_policy", action: "create", key: `${match[2]}.${match[1]}`, name: match[1], table: match[2] };
  }
  if ((match = statement.match(PATTERNS.dropPolicy))) {
    return { objectType: "rls_policy", action: "drop", key: `${match[2]}.${match[1]}`, name: match[1], table: match[2] };
  }
  if ((match = statement.match(PATTERNS.createTrigger))) {
    return { objectType: "trigger", action: "create", key: `${match[2]}.${match[1]}`, name: match[1], table: match[2] };
  }
  if ((match = statement.match(PATTERNS.dropTrigger))) {
    return { objectType: "trigger", action: "drop", key: `${match[2]}.${match[1]}`, name: match[1], table: match[2] };
  }
  if ((match = statement.match(PATTERNS.createTable))) {
    return { objectType: "table", action: "create", key: match[1], name: match[1] };
  }
  return null;
}

// Walks migrations in filename order (this repo's forward-only convention: a later migration's
// `drop policy` + `create policy` supersedes an earlier one under the same name, exactly like Postgres
// itself replaying the migration history) and returns the CURRENT effective definition of every named
// SQL object -- not a log of every historical mention. An object last touched by `drop` with no
// subsequent `create` is currently dropped and is excluded from the returned map (there is no current
// content to index), but is listed in `droppedObjectKeys` so the caller can report it.
//
// `migrations` must already be sorted in the order they'd actually be applied (filename order).
export function extractSqlObjects(migrations) {
  const currentByKey = new Map();

  for (const { path, content } of migrations) {
    const statements = splitSqlStatements(content);
    for (const statement of statements) {
      const classified = classifyStatement(statement);
      if (!classified) continue;

      if (classified.action === "create") {
        currentByKey.set(classified.key, {
          objectType: classified.objectType,
          key: classified.key,
          name: classified.name,
          table: classified.table,
          definition: statement,
          sourcePath: path,
        });
      } else if (classified.action === "drop") {
        currentByKey.delete(classified.key);
      }
    }
  }

  return Array.from(currentByKey.values());
}
