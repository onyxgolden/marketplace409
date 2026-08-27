import ts from "typescript";

// Uses the TypeScript compiler API (already an existing devDependency -- no new package added) in
// allowJs mode to extract exported symbol names from .js/.jsx/.ts/.tsx/.mjs source. AST-based rather
// than regex-based: precise about what's actually exported (handles `export { a, b as c }`,
// `export default function Foo()`, `export const x = ...`) without the false positives/negatives a
// hand-rolled regex would accumulate over 700+ source files.
export function extractExportedSymbols(sourceText, filePath) {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx")
    ? ts.ScriptKind.TSX
    : filePath.endsWith(".ts")
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;

  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols = [];

  function addSymbol(name, kind, node) {
    if (name) symbols.push({ name, kind, text: node.getFullText(sourceFile).trim() });
  }

  function visit(node) {
    const hasExportModifier = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;
    const hasDefaultModifier = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Default) !== 0;

    if (ts.isFunctionDeclaration(node) && hasExportModifier(node)) {
      addSymbol(node.name?.text || (hasDefaultModifier(node) ? "default" : undefined), "function", node);
    } else if (ts.isClassDeclaration(node) && hasExportModifier(node)) {
      addSymbol(node.name?.text || (hasDefaultModifier(node) ? "default" : undefined), "class", node);
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addSymbol(declaration.name.text, "const", declaration);
      }
    } else if (ts.isExportAssignment(node)) {
      addSymbol("default", "export_assignment", node);
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const specifier of node.exportClause.elements) {
        addSymbol(specifier.name.text, "named_export", specifier);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols.sort((a, b) => a.name.localeCompare(b.name));
}
