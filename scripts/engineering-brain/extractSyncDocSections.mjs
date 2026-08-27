// FORGE_SYNC_*.md documents are split into synchronizer-owned sections (`<!-- FORGE:SYNC:x:START/END -->`)
// and human-protected sections (`<!-- FORGE:HUMAN:x:START/END -->` -- see
// governance/policies/editable-sections.json / immutable-sections.json). Indexing at section
// granularity, not whole-document, means a change to one section doesn't invalidate the content hash
// of every other section in the same file.
const SECTION_PATTERN = /<!--\s*FORGE:(SYNC|HUMAN):([a-z0-9_]+):START\s*-->([\s\S]*?)<!--\s*FORGE:\1:\2:END\s*-->/gi;

export function extractSyncDocSections(content) {
  const sections = [];
  let match;
  const pattern = new RegExp(SECTION_PATTERN.source, "gi");
  while ((match = pattern.exec(content)) !== null) {
    const [, owner, sectionId, body] = match;
    sections.push({
      sectionId,
      owner: owner.toLowerCase(),
      body: body.trim(),
    });
  }
  return sections;
}
