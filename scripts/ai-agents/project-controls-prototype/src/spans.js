// spans.js — position-tracking JSON parser for verified citations.
// parseWithSpans(text) returns {value, spans} where spans maps a JSONPath
// (e.g. "$.actual_cost_lines[0].amount_minor") to half-open UTF-8 byte
// offsets {start, end} of the VALUE in the source text. The parser rejects
// anything JSON.parse rejects; offsets are byte-exact for verification.

export function parseWithSpans(text) {
  const bytes = Buffer.from(text, 'utf8');
  const spans = new Map();
  let pos = 0; // byte offset

  function fail(msg) {
    throw new SyntaxError(`spans: ${msg} at byte ${pos}`);
  }

  function skipWs() {
    while (pos < bytes.length) {
      const c = bytes[pos];
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) pos++;
      else break;
    }
  }

  function peek() {
    return pos < bytes.length ? bytes[pos] : -1;
  }

  function parseValue(path) {
    skipWs();
    const c = peek();
    if (c === 0x7b) return parseObject(path); // {
    if (c === 0x5b) return parseArray(path); // [
    if (c === 0x22) return parseString(path); // "
    if (c === 0x74) return parseLiteral(path, 'true', true); // t
    if (c === 0x66) return parseLiteral(path, 'false', false); // f
    if (c === 0x6e) return parseLiteral(path, 'null', null); // n
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return parseNumber(path); // - or digit
    fail('unexpected character');
  }

  function recordSpan(path, start, end) {
    spans.set(path, { start, end });
  }

  function parseObject(path) {
    const start = pos;
    pos++; // {
    const obj = {};
    skipWs();
    if (peek() === 0x7d) { pos++; recordSpan(path, start, pos); return obj; } // }
    while (true) {
      skipWs();
      if (peek() !== 0x22) fail('object key must be a string');
      const keyStart = pos;
      const key = parseStringRaw();
      const keyPath = `${path}.${key}`;
      void keyStart;
      skipWs();
      if (peek() !== 0x3a) fail('expected colon'); // :
      pos++;
      obj[key] = parseValue(keyPath);
      skipWs();
      const ch = peek();
      if (ch === 0x2c) { pos++; continue; } // ,
      if (ch === 0x7d) { pos++; break; } // }
      fail('expected comma or closing brace');
    }
    recordSpan(path, start, pos);
    return obj;
  }

  function parseArray(path) {
    const start = pos;
    pos++; // [
    const arr = [];
    skipWs();
    if (peek() === 0x5d) { pos++; recordSpan(path, start, pos); return arr; } // ]
    let i = 0;
    while (true) {
      arr.push(parseValue(`${path}[${i}]`));
      i++;
      skipWs();
      const ch = peek();
      if (ch === 0x2c) { pos++; continue; }
      if (ch === 0x5d) { pos++; break; }
      fail('expected comma or closing bracket');
    }
    recordSpan(path, start, pos);
    return arr;
  }

  // Parses a JSON string starting at the quote; returns the decoded value.
  // Records the span of the full quoted token (including quotes).
  function parseString(path) {
    const start = pos;
    const val = parseStringRaw();
    recordSpan(path, start, pos);
    return val;
  }

  function parseStringRaw() {
    // assumes bytes[pos] === '"'
    pos++; // opening quote
    let out = '';
    while (true) {
      if (pos >= bytes.length) fail('unterminated string');
      const c = bytes[pos];
      if (c === 0x22) { pos++; break; } // closing quote
      if (c === 0x5c) { // backslash escape
        pos++;
        if (pos >= bytes.length) fail('unterminated escape');
        const e = bytes[pos];
        if (e === 0x22) { out += '"'; pos++; }
        else if (e === 0x5c) { out += '\\'; pos++; }
        else if (e === 0x2f) { out += '/'; pos++; }
        else if (e === 0x62) { out += '\b'; pos++; }
        else if (e === 0x66) { out += '\f'; pos++; }
        else if (e === 0x6e) { out += '\n'; pos++; }
        else if (e === 0x72) { out += '\r'; pos++; }
        else if (e === 0x74) { out += '\t'; pos++; }
        else if (e === 0x75) { // \uXXXX
          if (pos + 4 >= bytes.length) fail('truncated unicode escape');
          const hex = bytes.toString('utf8', pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape');
          let cp = parseInt(hex, 16);
          pos += 5;
          // surrogate pair
          if (cp >= 0xd800 && cp <= 0xdbff && bytes[pos] === 0x5c && bytes[pos + 1] === 0x75) {
            const hex2 = bytes.toString('utf8', pos + 2, pos + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hex2)) {
              const lo = parseInt(hex2, 16);
              if (lo >= 0xdc00 && lo <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                pos += 6;
              }
            }
          }
          out += String.fromCodePoint(cp);
        } else fail('bad escape');
      } else if (c < 0x20) {
        fail('unescaped control character');
      } else {
        // consume one UTF-8 code point
        const b = bytes[pos];
        let len = 1;
        if ((b & 0x80) === 0) len = 1;
        else if ((b & 0xe0) === 0xc0) len = 2;
        else if ((b & 0xf0) === 0xe0) len = 3;
        else if ((b & 0xf8) === 0xf0) len = 4;
        else fail('invalid UTF-8');
        out += bytes.toString('utf8', pos, pos + len);
        pos += len;
      }
    }
    return out;
  }

  function parseNumber(path) {
    const start = pos;
    if (peek() === 0x2d) pos++; // -
    if (peek() === 0x30) { pos++; } // 0
    else if (peek() >= 0x31 && peek() <= 0x39) { while (peek() >= 0x30 && peek() <= 0x39) pos++; }
    else fail('bad number');
    if (peek() === 0x2e) { // .
      pos++;
      if (!(peek() >= 0x30 && peek() <= 0x39)) fail('bad fraction');
      while (peek() >= 0x30 && peek() <= 0x39) pos++;
    }
    if (peek() === 0x65 || peek() === 0x45) { // e/E
      pos++;
      if (peek() === 0x2b || peek() === 0x2d) pos++;
      if (!(peek() >= 0x30 && peek() <= 0x39)) fail('bad exponent');
      while (peek() >= 0x30 && peek() <= 0x39) pos++;
    }
    const raw = bytes.toString('utf8', start, pos);
    const num = Number(raw);
    if (!Number.isFinite(num)) fail('non-finite number');
    recordSpan(path, start, pos);
    return num;
  }

  function parseLiteral(path, word, value) {
    const start = pos;
    for (let i = 0; i < word.length; i++) {
      if (bytes[pos] !== word.charCodeAt(i)) fail(`bad literal, expected ${word}`);
      pos++;
    }
    recordSpan(path, start, pos);
    return value;
  }

  const value = parseValue('$');
  skipWs();
  if (pos !== bytes.length) fail('trailing characters');
  return { value, spans };
}

/**
 * Verify a cited span against source bytes under a span budget.
 * Returns {ok, reason}. Charges the budget BEFORE checking.
 */
export function verifySpan(bytes, citation, chargeSpan) {
  chargeSpan();
  if (!citation || typeof citation.byte_start !== 'number' || typeof citation.byte_end !== 'number') {
    return { ok: false, reason: 'citation missing byte offsets' };
  }
  const { byte_start: s, byte_end: e, quote } = citation;
  if (!Number.isSafeInteger(s) || !Number.isSafeInteger(e) || s < 0 || e <= s || e > bytes.length) {
    return { ok: false, reason: 'citation byte range out of bounds' };
  }
  const actual = bytes.toString('utf8', s, e);
  if (actual !== quote) {
    return { ok: false, reason: `citation quote mismatch: expected ${JSON.stringify(quote)}, found ${JSON.stringify(actual)}` };
  }
  return { ok: true };
}
