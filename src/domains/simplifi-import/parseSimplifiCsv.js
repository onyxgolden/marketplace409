import { createHash } from "node:crypto";

const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_MAX_ROWS = 50_000;

const HEADER_ALIASES = Object.freeze({
  account_name: ["account", "account name"],
  date: ["date", "transaction date"],
  payee: ["payee", "merchant", "description"],
  amount_cents: ["amount", "transaction amount"],
  category: ["category"],
  tags: ["tags", "tag"],
  notes: ["notes", "note", "memo"],
  check_number: ["check number", "check #", "check no"],
  status: ["status", "cleared", "state"],
  split_identity: ["split", "split id", "split identifier", "split number"],
});

const REQUIRED_FIELDS = Object.freeze([
  "account_name",
  "date",
  "payee",
  "amount_cents",
]);

function normalizedHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function parseCells(csv) {
  const records = [];
  let record = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      record.push(cell);
      cell = "";
    } else if (character === "\n") {
      record.push(cell.replace(/\r$/, ""));
      records.push(record);
      record = [];
      cell = "";
    } else cell += character;
  }

  if (quoted) throw new Error("Simplifi CSV contains an unterminated quoted field.");
  if (cell.length > 0 || record.length > 0) {
    record.push(cell.replace(/\r$/, ""));
    records.push(record);
  }
  return records.filter((row) => row.some((value) => value.trim() !== ""));
}

function parseCalendarDate(value, rowNumber) {
  const raw = String(value ?? "").trim();
  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, year, month, day] = match;
  else {
    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) [, month, day, year] = match;
    else {
      match = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
      if (match) {
        const monthIndex = [
          "jan", "feb", "mar", "apr", "may", "jun",
          "jul", "aug", "sep", "oct", "nov", "dec",
        ].indexOf(match[1].toLowerCase());
        if (monthIndex >= 0) {
          month = String(monthIndex + 1);
          [, , day, year] = match;
        } else match = null;
      }
    }
  }
  if (!match) throw new Error(`Simplifi CSV row ${rowNumber} has an invalid date.`);

  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth - 1, numericDay));
  if (
    date.getUTCFullYear() !== numericYear ||
    date.getUTCMonth() !== numericMonth - 1 ||
    date.getUTCDate() !== numericDay
  ) {
    throw new Error(`Simplifi CSV row ${rowNumber} has an invalid date.`);
  }
  return `${numericYear.toString().padStart(4, "0")}-${numericMonth
    .toString()
    .padStart(2, "0")}-${numericDay.toString().padStart(2, "0")}`;
}

function parseAmountCents(value, rowNumber) {
  const raw = String(value ?? "").trim();
  const parenthesized = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,\$\s()]/g, "");
  if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Simplifi CSV row ${rowNumber} has an invalid amount.`);
  }
  const sign = cleaned.startsWith("-") || parenthesized ? -1 : 1;
  const unsigned = cleaned.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Simplifi CSV row ${rowNumber} has an invalid amount.`);
  }
  return sign * cents;
}

function bounded(value, maximum, label, rowNumber) {
  const result = String(value ?? "").trim();
  if (result.length > maximum) {
    throw new Error(`Simplifi CSV row ${rowNumber} ${label} is too long.`);
  }
  return result;
}

function normalizeTags(value) {
  return Object.freeze(
    String(value ?? "")
      .split(/[;|]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
}

export function parseSimplifiCsv(csv, options = {}) {
  if (typeof csv !== "string" || csv.length === 0) {
    throw new Error("Simplifi CSV is required.");
  }
  if (csv.includes("\0")) throw new Error("Simplifi CSV must be a text file.");

  const byteLength = Buffer.byteLength(csv, "utf8");
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAX_BYTES;
  if (byteLength > maximumBytes) {
    throw new Error(`Simplifi CSV must be ${maximumBytes} bytes or smaller.`);
  }

  const parsed = parseCells(csv);
  if (parsed.length < 2) {
    throw new Error("Simplifi CSV must contain a header and at least one data row.");
  }

  const rawHeaders = parsed[0].map((header) => String(header).replace(/^\uFEFF/, "").trim());
  const normalizedHeaders = rawHeaders.map(normalizedHeader);
  if (normalizedHeaders.some((header) => !header)) {
    throw new Error("Simplifi CSV headers cannot be blank.");
  }
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new Error("Simplifi CSV headers must be unique.");
  }

  const aliasToField = new Map(
    Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) =>
      aliases.map((alias) => [normalizedHeader(alias), field]),
    ),
  );
  const fieldIndexes = {};
  normalizedHeaders.forEach((header, index) => {
    const field = aliasToField.get(header);
    if (field) fieldIndexes[field] = index;
  });
  const missing = REQUIRED_FIELDS.filter((field) => fieldIndexes[field] === undefined);
  if (missing.length > 0) {
    throw new Error(`Simplifi CSV is missing required headers: ${missing.join(", ")}.`);
  }

  const maximumRows = options.maximumRows ?? DEFAULT_MAX_ROWS;
  const dataRows = parsed.slice(1);
  if (dataRows.length > maximumRows) {
    throw new Error(`Simplifi CSV must contain ${maximumRows} rows or fewer.`);
  }

  const at = (row, field) => row[fieldIndexes[field]] ?? "";
  const rows = dataRows.map((row, index) => {
    const rowNumber = index + 2;
    if (row.length > rawHeaders.length) {
      throw new Error(`Simplifi CSV row ${rowNumber} contains more values than headers.`);
    }
    const accountName = bounded(at(row, "account_name"), 200, "account name", rowNumber);
    const payee = bounded(at(row, "payee"), 500, "payee", rowNumber);
    if (!accountName) throw new Error(`Simplifi CSV row ${rowNumber} has no account name.`);
    if (!payee) throw new Error(`Simplifi CSV row ${rowNumber} has no payee.`);

    const statusRaw = bounded(at(row, "status"), 50, "status", rowNumber).toLowerCase();
    const status = ["pending", "uncleared"].includes(statusRaw) ? "pending" : "cleared";
    return Object.freeze({
      row_number: rowNumber,
      account_name: accountName,
      date: parseCalendarDate(at(row, "date"), rowNumber),
      payee,
      amount_cents: parseAmountCents(at(row, "amount_cents"), rowNumber),
      category: bounded(at(row, "category"), 200, "category", rowNumber),
      tags: normalizeTags(at(row, "tags")),
      notes: bounded(at(row, "notes"), 2_000, "notes", rowNumber),
      check_number: bounded(at(row, "check_number"), 100, "check number", rowNumber),
      status,
      split_identity: bounded(at(row, "split_identity"), 100, "split identity", rowNumber),
    });
  });

  const unknownHeaders = rawHeaders.filter((_, index) => !aliasToField.has(normalizedHeaders[index]));
  return Object.freeze({
    batch_hash: createHash("sha256").update(csv, "utf8").digest("hex"),
    byte_length: byteLength,
    row_count: rows.length,
    unknown_headers: Object.freeze(unknownHeaders),
    rows: Object.freeze(rows),
  });
}
