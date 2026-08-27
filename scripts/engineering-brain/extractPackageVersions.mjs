export function extractPackageVersions(packageJsonContent) {
  const parsed = JSON.parse(packageJsonContent);
  const entries = [];
  for (const [group, key] of [["dependency", "dependencies"], ["dev_dependency", "devDependencies"]]) {
    for (const [name, version] of Object.entries(parsed[key] || {})) {
      entries.push({ name, version, group });
    }
  }
  entries.push({ name: "node", version: parsed.engines?.node || null, group: "engine" });
  return entries.filter((entry) => entry.version !== null).sort((a, b) => a.name.localeCompare(b.name));
}
