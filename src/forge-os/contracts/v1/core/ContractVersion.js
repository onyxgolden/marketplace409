export function createContractVersion({
  major,
  minor,
  patch,
}) {
  return Object.freeze({
    major,
    minor,
    patch,
    identifier: `${major}.${minor}.${patch}`,
  });
}
