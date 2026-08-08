function displayPropertyIdentity(
  propertyId,
) {
  return String(
    propertyId || "",
  )
    .replace(
      /[-_]+/g,
      " ",
    )
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase(),
    );
}

export function buildPropertyPortfolioProperties(
  payload,
) {
  const properties =
    payload?.data?.business
      ?.reports?.properties ??
    [];

  return properties
    .filter(
      (property) =>
        typeof property
          ?.propertyId ===
          "string" &&
        property.propertyId
          .trim() !== "" &&
        property.propertyId !==
          "unassigned",
    )
    .map((property) =>
      Object.freeze({
        id:
          property.propertyId,
        name:
          property.propertyName ||
          displayPropertyIdentity(
            property.propertyId,
          ),
      }),
    );
}
