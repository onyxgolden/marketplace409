// canonical.js — deterministic canonical JSON (sorted keys, stable output).

export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function canonicalStringify(v) {
  return JSON.stringify(sortKeys(v));
}

export function utf8Length(s) {
  return Buffer.byteLength(s, 'utf8');
}
