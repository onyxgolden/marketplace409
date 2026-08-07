function normalizeHeader(value) {
  return String(value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCells(csv) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (
    let index = 0;
    index < csv.length;
    index += 1
  ) {
    const character =
      csv[index];

    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }

      continue;
    }

    if (character === '"') {
      quoted = true;
      continue;
    }

    if (character === ",") {
      row.push(value);
      value = "";
      continue;
    }

    if (
      character === "\n" ||
      character === "\r"
    ) {
      if (
        character === "\r" &&
        csv[index + 1] === "\n"
      ) {
        index += 1;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += character;
  }

  if (quoted) {
    throw new Error(
      "Property valuation CSV contains an unterminated quoted field.",
    );
  }

  if (
    value !== "" ||
    row.length > 0
  ) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((cells) =>
    cells.some(
      (cell) =>
        String(cell).trim() !== "",
    ),
  );
}

export function parsePropertyValuationCsv(csv) {
  if (
    typeof csv !== "string" ||
    csv.trim() === ""
  ) {
    throw new Error(
      "Property valuation CSV is required.",
    );
  }

  const parsedRows =
    parseCells(csv);

  if (parsedRows.length < 2) {
    throw new Error(
      "Property valuation CSV must contain a header and at least one data row.",
    );
  }

  const headers =
    parsedRows[0].map(
      normalizeHeader,
    );

  if (
    headers.some(
      (header) =>
        header === "",
    )
  ) {
    throw new Error(
      "Property valuation CSV headers cannot be blank.",
    );
  }

  if (
    new Set(headers).size !==
    headers.length
  ) {
    throw new Error(
      "Property valuation CSV headers must be unique.",
    );
  }

  const requiredHeaders = [
    "property_id",
    "current_value",
  ];

  const missingHeaders =
    requiredHeaders.filter(
      (header) =>
        !headers.includes(header),
    );

  if (missingHeaders.length > 0) {
    throw new Error(
      `Property valuation CSV is missing required headers: ${missingHeaders.join(", ")}.`,
    );
  }

  const rows =
    parsedRows
      .slice(1)
      .map((cells, index) => {
        if (
          cells.length >
          headers.length
        ) {
          throw new Error(
            `Property valuation CSV row ${index + 2} contains more values than headers.`,
          );
        }

        return Object.freeze(
          Object.fromEntries(
            headers.map(
              (header, columnIndex) => [
                header,
                String(
                  cells[columnIndex] ?? "",
                ).trim(),
              ],
            ),
          ),
        );
      });

  return Object.freeze({
    headers:
      Object.freeze([...headers]),
    rows:
      Object.freeze(rows),
  });
}
