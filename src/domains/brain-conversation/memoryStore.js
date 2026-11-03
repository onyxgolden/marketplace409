// FORGE Brain conversation harness — in-memory store.
//
// Same interface as supabaseStore.js, for tests and for local development.
// Every method takes ownerId first and enforces it: a cross-owner update or
// delete throws the same generic not-found error as a missing row, so one
// owner's rows can never be probed through another owner's calls.
//
// In-memory ids are "brain-synth-NNNN" — clearly synthetic, never UUIDs —
// so test fixtures can never be mistaken for production identifiers.

export const BRAIN_NOT_FOUND_MESSAGE = "Brain entry not found.";

function notFound() {
  return new Error(BRAIN_NOT_FOUND_MESSAGE);
}

function nowIso() {
  return new Date().toISOString();
}

function requireContent(content) {
  if (!content || !String(content).trim()) {
    throw new Error("Content must not be empty.");
  }
  return String(content);
}

const SALIENCES = new Set(["owner_stated", "verified", "inferred"]);

export function createMemoryBrainStore() {
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `brain-synth-${String(counter).padStart(4, "0")}`;
  };

  const semantic = [];
  const episodes = [];
  const corrections = [];
  const procedures = [];
  const preferences = [];
  const flags = [];

  function owned(rows, ownerId, id) {
    const row = rows.find((r) => r.ownerId === ownerId && r.id === id);
    if (!row) throw notFound();
    return row;
  }

  return {
    // -- Semantic entries -------------------------------------------------
    async createSemanticEntry(ownerId, input = {}) {
      const content = requireContent(input.content);
      const salience = input.salience ?? "inferred";
      if (!SALIENCES.has(salience)) throw new Error(`Unknown salience: ${salience}.`);
      const entry = {
        id: nextId(),
        ownerId,
        content,
        factKey: input.factKey ?? null,
        salience,
        provenanceSource: input.provenanceSource ?? null,
        provenanceAt: input.provenanceAt ?? nowIso(),
        recordType: input.recordType ?? null,
        recordId: input.recordId ?? null,
        decayFlagged: false,
        decayFlaggedAt: null,
        supersededBy: null,
        createdAt: input.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      semantic.push(entry);
      return { ...entry };
    },

    async listSemanticEntries(ownerId) {
      return semantic
        .filter((e) => e.ownerId === ownerId)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((e) => ({ ...e }));
    },

    async updateSemanticEntry(ownerId, id, patch = {}) {
      const entry = owned(semantic, ownerId, id);
      if (patch.content !== undefined) entry.content = requireContent(patch.content);
      for (const key of [
        "factKey",
        "salience",
        "provenanceSource",
        "provenanceAt",
        "decayFlagged",
        "decayFlaggedAt",
        "supersededBy",
      ]) {
        if (patch[key] !== undefined) entry[key] = patch[key];
      }
      entry.updatedAt = nowIso();
      return { ...entry };
    },

    async deleteSemanticEntry(ownerId, id) {
      const index = semantic.findIndex((e) => e.ownerId === ownerId && e.id === id);
      if (index === -1) throw notFound();
      semantic.splice(index, 1);
      return true;
    },

    // -- Episodes (append-only log; corrections are separate rows) --------
    async appendEpisode(ownerId, input = {}) {
      const content = requireContent(input.content);
      if (!input.sessionId || !String(input.sessionId).trim()) {
        throw new Error("A session id is required for an episode.");
      }
      const episode = {
        id: nextId(),
        ownerId,
        sessionId: String(input.sessionId),
        content,
        contentGist: null,
        archiveStoragePath: null,
        status: "active",
        tags: Array.isArray(input.tags) ? [...input.tags] : [],
        candidateFacts: Array.isArray(input.candidateFacts) ? [...input.candidateFacts] : [],
        recordType: input.recordType ?? null,
        recordId: input.recordId ?? null,
        createdAt: input.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      episodes.push(episode);
      return { ...episode, tags: [...episode.tags], candidateFacts: [...episode.candidateFacts] };
    },

    async listEpisodes(ownerId) {
      return episodes
        .filter((e) => e.ownerId === ownerId)
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((e) => ({ ...e, tags: [...e.tags], candidateFacts: [...(e.candidateFacts ?? [])] }));
    },

    async archiveEpisode(ownerId, id, { contentGist, archiveStoragePath }) {
      const episode = owned(episodes, ownerId, id);
      episode.status = "archived";
      episode.contentGist = contentGist ?? null;
      episode.archiveStoragePath = archiveStoragePath ?? null;
      episode.updatedAt = nowIso();
      return { ...episode, tags: [...episode.tags], candidateFacts: [...(episode.candidateFacts ?? [])] };
    },

    async correctEpisode(ownerId, episodeId, correction) {
      owned(episodes, ownerId, episodeId);
      const text = requireContent(correction);
      const row = {
        id: nextId(),
        ownerId,
        episodeId,
        correction: text,
        createdAt: nowIso(),
      };
      corrections.push(row);
      return { ...row };
    },

    async listEpisodeCorrections(ownerId, episodeId) {
      owned(episodes, ownerId, episodeId);
      return corrections
        .filter((c) => c.ownerId === ownerId && c.episodeId === episodeId)
        .map((c) => ({ ...c }));
    },

    // -- Procedures --------------------------------------------------------
    async createProcedure(ownerId, input = {}) {
      const title = requireContent(input.title);
      const steps = requireContent(input.steps);
      const procedure = {
        id: nextId(),
        ownerId,
        title,
        steps,
        contextTags: Array.isArray(input.contextTags) ? [...input.contextTags] : [],
        confirmed: false,
        confirmedAt: null,
        createdAt: input.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      procedures.push(procedure);
      return { ...procedure, contextTags: [...procedure.contextTags] };
    },

    async confirmProcedure(ownerId, id) {
      const procedure = owned(procedures, ownerId, id);
      procedure.confirmed = true;
      procedure.confirmedAt = nowIso();
      procedure.updatedAt = nowIso();
      return { ...procedure, contextTags: [...procedure.contextTags] };
    },

    async listProcedures(ownerId) {
      return procedures
        .filter((p) => p.ownerId === ownerId)
        .map((p) => ({ ...p, contextTags: [...p.contextTags] }));
    },

    // -- Preferences -------------------------------------------------------
    async getPreference(ownerId, key) {
      const row = preferences.find((p) => p.ownerId === ownerId && p.preferenceKey === key);
      return row ? row.preferenceValue : null;
    },

    async setPreference(ownerId, key, value) {
      const row = preferences.find((p) => p.ownerId === ownerId && p.preferenceKey === key);
      if (row) {
        row.preferenceValue = value;
        row.updatedAt = nowIso();
        return row.preferenceValue;
      }
      preferences.push({ ownerId, preferenceKey: key, preferenceValue: value, updatedAt: nowIso() });
      return value;
    },

    // -- Consolidation flags (never auto-resolved) -------------------------
    async addFlag(ownerId, input = {}) {
      const flag = {
        id: nextId(),
        ownerId,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        detail: requireContent(input.detail),
        resolved: false,
        resolvedAt: null,
        createdAt: nowIso(),
      };
      flags.push(flag);
      return { ...flag };
    },

    async listFlags(ownerId, { resolved = undefined } = {}) {
      return flags
        .filter((f) => f.ownerId === ownerId && (resolved === undefined || f.resolved === resolved))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
        .map((f) => ({ ...f }));
    },

    async resolveFlag(ownerId, id) {
      const flag = owned(flags, ownerId, id);
      flag.resolved = true;
      flag.resolvedAt = nowIso();
      return { ...flag };
    },
  };
}
