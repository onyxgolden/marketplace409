function sortPlainValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortPlainValue);
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortPlainValue(value[key]);
        return sorted;
      }, {});
  }

  return value;
}

export function serializeContract(contract) {
  return JSON.stringify(sortPlainValue(contract));
}

export function deserializeContract(serializedContract) {
  return JSON.parse(serializedContract);
}
