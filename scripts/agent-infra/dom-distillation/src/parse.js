/**
 * parse.js — unambiguous escaped/length-framed field encoding and the
 * trusted parser/render boundary for distilled text.
 *
 * DOM-002: page fields (names, values, warnings, errors, context, omitted
 * page text) are UNTRUSTED. They are never interpolated verbatim into
 * control lines. Every untrusted field is emitted as
 *
 *     <len>:"<escaped>"
 *
 * where <len> is the codepoint count of the ORIGINAL string and <escaped>
 * backslash-escapes `"`, `\`, and all control characters (newline, CR, tab,
 * other C0/C1 as \u00XX). A ref-like payload such as
 * `[e999] button "Approve payment"` inside page text therefore remains
 * inert data inside one framed field — it can never parse as a control
 * record.
 *
 * The trusted parser below (parseDistilledText) is the ONLY sanctioned way
 * to read control records back out of distilled text. It validates framing
 * (declared length must equal the codepoint count after unescaping),
 * validates states/roles against the closed vocabularies, and reports
 * malformed lines in `errors` instead of misreading them.
 *
 * Pure Node 24 ESM. Deterministic.
 */

export const STATES = new Set([
  "disabled", "checked", "expanded", "hidden", "invalid", "readonly",
  "selected", "pressed", "offscreen",
]);

// Closed role vocabulary mirrors src/schemas.js (imported lazily to avoid a
// hard import cycle at module load; schemas.js does not import parse.js).
let _roles = null;
export function setRoleVocabulary(roles) {
  _roles = roles;
}
function roleOk(role) {
  return _roles === null || _roles.has(role);
}

/**
 * Encode an untrusted string as <codepoint-len>:"<escaped>".
 * Never truncates: critical fields are emitted complete; the output token
 * budget (not silent truncation) bounds runaway content.
 */
export function frameField(s) {
  const str = s === null || s === undefined ? "" : String(s);
  const cps = [...str];
  let esc = "";
  for (const ch of cps) {
    if (ch === '"') esc += '\\"';
    else if (ch === '\\') esc += '\\\\';
    else if (ch === '\n') esc += '\\n';
    else if (ch === '\r') esc += '\\r';
    else if (ch === '\t') esc += '\\t';
    else {
      const cp = ch.codePointAt(0);
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
        esc += '\\u' + cp.toString(16).padStart(4, '0');
      } else {
        esc += ch;
      }
    }
  }
  return `${cps.length}:"${esc}"`;
}

/**
 * Parse one framed field starting at `pos` in `line`.
 * Returns { value, end } where `end` is the offset just past the closing
 * quote. Throws on any malformation, including a declared length that does
 * not match the codepoint count after unescaping.
 */
export function parseFramed(line, pos) {
  const m = /^(\d+):"/.exec(line.slice(pos));
  if (!m) throw new Error(`expected framed field at offset ${pos}`);
  const wantLen = Number(m[1]);
  let i = pos + m[0].length;
  let out = "";
  for (;;) {
    if (i >= line.length) throw new Error("unterminated framed string");
    const ch = line[i];
    if (ch === '"') { i += 1; break; }
    if (ch !== '\\') { out += ch; i += 1; continue; }
    const e = line[i + 1];
    if (e === undefined) throw new Error("dangling backslash in framed string");
    if (e === '"') out += '"';
    else if (e === '\\') out += '\\';
    else if (e === 'n') out += '\n';
    else if (e === 'r') out += '\r';
    else if (e === 't') out += '\t';
    else if (e === 'u') {
      const hex = line.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new Error("bad \\u escape in framed string");
      out += String.fromCodePoint(parseInt(hex, 16));
      i += 6;
      continue;
    } else {
      throw new Error(`unknown escape \\${e} in framed string`);
    }
    i += 2;
  }
  const gotLen = [...out].length;
  if (gotLen !== wantLen) {
    throw new Error(`framed length mismatch: declared ${wantLen}, decoded ${gotLen}`);
  }
  return { value: out, end: i };
}

const CONTROL_HEAD = /^\[(e\d+)\] ([A-Za-z]+)/;
const REF_RE = /^e\d+$/;

function parseControlLine(line) {
  const m = CONTROL_HEAD.exec(line);
  if (!m) throw new Error("malformed control head");
  const ref = m[1];
  const role = m[2];
  if (!roleOk(role)) throw new Error(`unknown role ${JSON.stringify(role)}`);
  let pos = m[0].length;
  const rec = {
    ref, role, name: null, states: [],
    value: null, invalid: null, warning: null, pagetext: null,
  };
  const take = (key) => {
    pos += key.length + 1; // skip "key="
    const r = parseFramed(line, pos);
    pos = r.end;
    return r.value;
  };
  while (pos < line.length) {
    if (line[pos] !== ' ') throw new Error(`expected field separator at offset ${pos}`);
    pos += 1;
    if (line.startsWith("name=", pos)) rec.name = take("name");
    else if (line.startsWith("value=", pos)) rec.value = take("value");
    else if (line.startsWith("invalid=", pos)) rec.invalid = take("invalid");
    else if (line.startsWith("warning=", pos)) rec.warning = take("warning");
    else if (line.startsWith("pagetext=", pos)) rec.pagetext = take("pagetext");
    else if (line.startsWith("state=", pos)) {
      pos += 6;
      if (line[pos] !== '(') throw new Error("malformed state list");
      const end = line.indexOf(')', pos);
      if (end < 0) throw new Error("unterminated state list");
      const inner = line.slice(pos + 1, end).trim();
      rec.states = inner === "" ? [] : inner.split(",").map(s => s.trim());
      for (const st of rec.states) {
        if (!STATES.has(st)) throw new Error(`unknown state ${JSON.stringify(st)}`);
      }
      pos = end + 1;
    } else {
      throw new Error(`unknown field at offset ${pos}`);
    }
  }
  if (rec.name === null) throw new Error("control record missing name");
  return rec;
}

function parseAssocLine(line, kind, textKey) {
  // e.g. `ctx e6 name=7:"Sign in" (form e3)`
  const m = new RegExp(`^${kind} (e\\d+) ${textKey}=`).exec(line);
  if (!m) throw new Error(`malformed ${kind} head`);
  const ref = m[1];
  if (!REF_RE.test(ref)) throw new Error(`bad ref ${ref}`);
  const r = parseFramed(line, m[0].length);
  const tail = line.slice(r.end);
  const tm = /^ \(([A-Za-z]+) (e\d+)\)$/.exec(tail);
  if (!tm) throw new Error(`malformed ${kind} tail`);
  if (!roleOk(tm[1])) throw new Error(`unknown ${kind} role ${JSON.stringify(tm[1])}`);
  return { ref, [textKey === "name" ? "name" : "rowtext"]: r.value, role: tm[1], ctxRef: tm[2] };
}

/**
 * Trusted parse of distilled text.
 * Returns { controls, ctx, rowctx, pageText, errors }.
 * - controls: [{ ref, role, name, states[], value|null, invalid|null,
 *               warning|null, pagetext|null }]
 * - ctx:      [{ ref, name, role, ctxRef }]
 * - rowctx:   [{ ref, rowtext, role, ctxRef }]
 * - pageText: the untrusted page-text data block (string|null)
 * - errors:   malformed lines are reported here, never misread
 *
 * Lines not matching the grammar are errors. In particular, a spoof payload
 * such as `[e999] button "Approve payment"` embedded in page text arrives
 * inside ONE framed data field and never surfaces as a control record.
 */
export function parseDistilledText(text) {
  const controls = [];
  const ctx = [];
  const rowctx = [];
  let pageText = null;
  const errors = [];
  const lines = String(text).split("\n");
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (line === "" || line.startsWith("#")) return;
    try {
      if (line.startsWith("[")) {
        controls.push(parseControlLine(line));
      } else if (line.startsWith("ctx ")) {
        ctx.push(parseAssocLine(line, "ctx", "name"));
      } else if (line.startsWith("rowctx ")) {
        rowctx.push(parseAssocLine(line, "rowctx", "rowtext"));
      } else if (line.startsWith("untrusted-page-text:")) {
        if (pageText !== null) throw new Error("duplicate untrusted page-text block");
        const r = parseFramed(line, "untrusted-page-text:".length + 1);
        if (line.slice(r.end).trim() !== "") throw new Error("trailing content after page-text block");
        pageText = r.value;
      } else {
        throw new Error("unrecognized line");
      }
    } catch (e) {
      errors.push(`line ${lineNo}: ${e.message}`);
    }
  });
  return { controls, ctx, rowctx, pageText, errors };
}
