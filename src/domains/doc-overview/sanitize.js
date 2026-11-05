// FORGE Doc-to-Overview — slice A: sanitizing untrusted document text.
//
// Document text is untrusted data, never instructions and never markup to
// execute. This module therefore does three things, and nothing else:
//
// 1. Escapes text for HTML rendering (no markup from a source document
//    ever reaches a page unescaped).
// 2. Strips active content from SVG (scripts, event handlers, external
//    references, javascript:/data: URLs). The allowlist is deliberately
//    narrow: shape/text elements survive, everything capable of executing
//    or loading remote content is removed. This is a conservative
//    sanitizer for artifact previews, not a general HTML sanitizer —
//    anything it does not recognize is removed, not passed through.
// 3. Guards filesystem paths (owner-scoped draft storage): a resolved path
//    must stay inside its root, so a crafted document/owner ID cannot
//    escape the artifact directory.
//
// This module makes NO network calls and imports no network library: a
// URL string inside a document is inert text here, never fetched (no
// SSRF surface exists in slice A). Embedded model instructions in a
// document ("ignore previous instructions…") are likewise inert text:
// no function in this slice interprets document text as instructions,
// and the picker never changes an artifact's status on document text
// alone — status changes require an explicit curator action with an
// actor (see artifacts.js).

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ALLOWED_SVG_TAGS = new Set([
  "svg", "g", "defs", "title", "desc", "rect", "circle", "ellipse", "line",
  "polyline", "polygon", "path", "text", "tspan", "textpath", "use", "clipPath",
  "mask", "pattern", "lineargradient", "radialgradient", "stop",
]);

const ALLOWED_SVG_ATTRS = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width",
  "height", "viewBox", "fill", "stroke", "stroke-width", "stroke-linecap",
  "stroke-linejoin", "stroke-dasharray", "opacity", "fill-opacity",
  "stroke-opacity", "font-family", "font-size", "font-weight", "text-anchor",
  "transform", "d", "points", "id", "class", "offset", "stop-color",
  "stop-opacity", "gradientUnits", "gradientTransform", "href",
]);

/**
 * Sanitizes an SVG string. Removes: <script> blocks (including content),
 * <foreignObject> and <image> elements (both can load active/external
 * content), event-handler attributes (on*), style attributes carrying
 * url()/expression(), and hrefs that are not same-document fragments
 * (#...). Tags outside the allowlist are dropped with their content
 * only when they are known-active (script/foreignObject); other unknown
 * tags are unwrapped (tags removed, text kept) so benign content is not
 * silently destroyed.
 */
export function sanitizeSvg(svg) {
  if (typeof svg !== "string") return "";
  let out = svg;
  out = out.replace(/<\?[\s\S]*?\?>/g, "");
  out = out.replace(/<!DOCTYPE[^>]*>/gi, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, "");
  out = out.replace(/<image\b[^>]*\/?>/gi, "");
  // Strip event handlers and dangerous style values from all tags.
  out = out.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/\s+style\s*=\s*(?:"[^"]*(?:url\(|expression\()[^"]*"|'[^']*(?:url\(|expression\()[^']*')/gi, "");
  // Strip href/xlink:href that are not same-document fragments.
  out = out.replace(/\s+(?:xlink:)?href\s*=\s*"([^"]*)"/gi, (_m, url) => (url.startsWith("#") ? ` href="${url}"` : ""));
  out = out.replace(/\s+(?:xlink:)?href\s*=\s*'([^']*)'/gi, (_m, url) => (url.startsWith("#") ? ` href='${url}'` : ""));
  // Drop disallowed tags entirely (open, close, self-closing).
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\/?>/g, (match, tag) => {
    const lower = tag.toLowerCase();
    if (ALLOWED_SVG_TAGS.has(lower)) {
      // Rebuild the tag keeping only allowlisted attributes.
      if (match.startsWith("</")) return `</${lower}>`;
      const attrs = [];
      const attrPattern = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/g;
      let attrMatch;
      while ((attrMatch = attrPattern.exec(match)) !== null) {
        const name = attrMatch[1].toLowerCase();
        if (ALLOWED_SVG_ATTRS.has(name)) attrs.push(`${name}=${attrMatch[2]}`);
      }
      const selfClose = match.endsWith("/>") ? "/" : "";
      return `<${lower}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}${selfClose}>`;
    }
    return "";
  });
  return out;
}

/** Returns true when `name` is safe to use as a single path segment. */
export function isSafePathSegment(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 200 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith(".")
  );
}
