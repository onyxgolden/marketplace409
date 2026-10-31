// Team Brain P5 — citation oracle/scorer (fix round 1, TBP5-007).
//
// The scorer compares a result's FULL citation identity against
// independently supplied expected source data — the labeled fixture —
// never against a second call to the same renderer. A renderer that
// returns the same invented pins on every lookup passes a
// self-consistency check; it fails here, because the expected commit
// and blob come from the fixture, not from the runtime.
//
// Pure functions, no database, no model, no service.

// Full citation identity: every field the runtime reports for a hit.
export function citationMatches(actual, expected) {
  return (
    actual?.episodeId === expected.episodeId &&
    actual?.source?.repo === expected.source.repo &&
    actual?.source?.path === expected.source.path &&
    actual?.source?.commit === expected.source.commit &&
    actual?.source?.blob === expected.source.blob &&
    actual?.revision === expected.revision &&
    actual?.watermark === expected.watermark
  );
}

// Expected source identity for one fixture episode: sourceDefaults
// plus per-episode overrides, exactly as the seeder captures it. This
// is the oracle: it reads the fixture file, never runtime output.
export function fixtureSourceFor(fixture, episode) {
  return {
    repo: fixture.sourceDefaults.repo,
    path: episode.source.path,
    commit:
      "commit" in episode.source
        ? episode.source.commit
        : fixture.sourceDefaults.commit,
    blob:
      "blob" in episode.source
        ? episode.source.blob
        : fixture.sourceDefaults.blob,
  };
}

export function expectedCitationFor(fixture, episode, episodeId, revision) {
  return {
    episodeId,
    source: fixtureSourceFor(fixture, episode),
    revision,
    watermark: fixture.sourceDefaults.watermark,
  };
}
