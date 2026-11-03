// FORGE Brain conversation harness — Supabase store.
//
// Same interface as memoryStore.js, over supabase-js. Every query carries
// .eq("owner_id", ownerId), and every update/delete checks the affected rows
// so a cross-owner id behaves exactly like a missing row (never leaks
// existence). RLS on the tables is the second layer; this scoping is the
// first, so a misconfigured policy alone cannot leak another owner's rows.
//
// camelCase in JS, snake_case in the database; mapping lives here only.

import { BRAIN_NOT_FOUND_MESSAGE } from "./memoryStore.js";

function notFound() {
  return new Error(BRAIN_NOT_FOUND_MESSAGE);
}

function mapSemantic(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    content: row.content,
    factKey: row.fact_key ?? null,
    salience: row.salience,
    provenanceSource: row.provenance_source ?? null,
    provenanceAt: row.provenance_at ?? null,
    recordType: row.record_type ?? null,
    recordId: row.record_id ?? null,
    decayFlagged: row.decay_flagged ?? false,
    decayFlaggedAt: row.decay_flagged_at ?? null,
    supersededBy: row.superseded_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEpisode(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    sessionId: row.session_id,
    content: row.content,
    contentGist: row.content_gist ?? null,
    archiveStoragePath: row.archive_storage_path ?? null,
    status: row.status,
    tags: row.tags ?? [],
    candidateFacts: row.candidate_facts ?? [],
    recordType: row.record_type ?? null,
    recordId: row.record_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProcedure(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    title: row.title,
    steps: row.steps,
    contextTags: row.context_tags ?? [],
    confirmed: row.confirmed ?? false,
    confirmedAt: row.confirmed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapFlag(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    detail: row.detail,
    resolved: row.resolved ?? false,
    resolvedAt: row.resolved_at ?? null,
    createdAt: row.created_at,
  };
}

async function singleRow(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  if (!data || (Array.isArray(data) && data.length === 0)) throw notFound();
  return Array.isArray(data) ? data[0] : data;
}

export function createSupabaseBrainStore(supabase) {
  return {
    async createSemanticEntry(ownerId, input = {}) {
      const row = await singleRow(
        supabase
          .from("brain_semantic_entries")
          .insert({
            owner_id: ownerId,
            content: input.content,
            fact_key: input.factKey ?? null,
            salience: input.salience ?? "inferred",
            provenance_source: input.provenanceSource ?? null,
            provenance_at: input.provenanceAt ?? null,
            record_type: input.recordType ?? null,
            record_id: input.recordId ?? null,
          })
          .select()
          .single(),
      );
      return mapSemantic(row);
    },

    async listSemanticEntries(ownerId) {
      const { data, error } = await supabase
        .from("brain_semantic_entries")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapSemantic);
    },

    async updateSemanticEntry(ownerId, id, patch = {}) {
      const updates = { updated_at: new Date().toISOString() };
      if (patch.content !== undefined) updates.content = patch.content;
      if (patch.factKey !== undefined) updates.fact_key = patch.factKey;
      if (patch.salience !== undefined) updates.salience = patch.salience;
      if (patch.provenanceSource !== undefined) updates.provenance_source = patch.provenanceSource;
      if (patch.provenanceAt !== undefined) updates.provenance_at = patch.provenanceAt;
      if (patch.decayFlagged !== undefined) updates.decay_flagged = patch.decayFlagged;
      if (patch.decayFlaggedAt !== undefined) updates.decay_flagged_at = patch.decayFlaggedAt;
      if (patch.supersededBy !== undefined) updates.superseded_by = patch.supersededBy;
      const row = await singleRow(
        supabase
          .from("brain_semantic_entries")
          .update(updates)
          .eq("owner_id", ownerId)
          .eq("id", id)
          .select(),
      );
      return mapSemantic(row);
    },

    async deleteSemanticEntry(ownerId, id) {
      await singleRow(
        supabase.from("brain_semantic_entries").delete().eq("owner_id", ownerId).eq("id", id).select(),
      );
      return true;
    },

    async appendEpisode(ownerId, input = {}) {
      const row = await singleRow(
        supabase
          .from("brain_episodes")
          .insert({
            owner_id: ownerId,
            session_id: input.sessionId,
            content: input.content,
            tags: input.tags ?? [],
            candidate_facts: input.candidateFacts ?? [],
            record_type: input.recordType ?? null,
            record_id: input.recordId ?? null,
          })
          .select()
          .single(),
      );
      return mapEpisode(row);
    },

    async listEpisodes(ownerId) {
      const { data, error } = await supabase
        .from("brain_episodes")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapEpisode);
    },

    async archiveEpisode(ownerId, id, { contentGist, archiveStoragePath }) {
      const row = await singleRow(
        supabase
          .from("brain_episodes")
          .update({
            status: "archived",
            content_gist: contentGist ?? null,
            archive_storage_path: archiveStoragePath ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("owner_id", ownerId)
          .eq("id", id)
          .select(),
      );
      return mapEpisode(row);
    },

    async correctEpisode(ownerId, episodeId, correction) {
      const { data, error } = await supabase
        .from("brain_episode_corrections")
        .insert({ owner_id: ownerId, episode_id: episodeId, correction })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return {
        id: data.id,
        ownerId: data.owner_id,
        episodeId: data.episode_id,
        correction: data.correction,
        createdAt: data.created_at,
      };
    },

    async listEpisodeCorrections(ownerId, episodeId) {
      const { data, error } = await supabase
        .from("brain_episode_corrections")
        .select("*")
        .eq("owner_id", ownerId)
        .eq("episode_id", episodeId);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => ({
        id: row.id,
        ownerId: row.owner_id,
        episodeId: row.episode_id,
        correction: row.correction,
        createdAt: row.created_at,
      }));
    },

    async createProcedure(ownerId, input = {}) {
      const row = await singleRow(
        supabase
          .from("brain_procedures")
          .insert({
            owner_id: ownerId,
            title: input.title,
            steps: input.steps,
            context_tags: input.contextTags ?? [],
          })
          .select()
          .single(),
      );
      return mapProcedure(row);
    },

    async confirmProcedure(ownerId, id) {
      const row = await singleRow(
        supabase
          .from("brain_procedures")
          .update({ confirmed: true, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("owner_id", ownerId)
          .eq("id", id)
          .select(),
      );
      return mapProcedure(row);
    },

    async listProcedures(ownerId) {
      const { data, error } = await supabase
        .from("brain_procedures")
        .select("*")
        .eq("owner_id", ownerId);
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapProcedure);
    },

    async getPreference(ownerId, key) {
      const { data, error } = await supabase
        .from("brain_preferences")
        .select("preference_value")
        .eq("owner_id", ownerId)
        .eq("preference_key", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.preference_value : null;
    },

    async setPreference(ownerId, key, value) {
      const { data, error } = await supabase
        .from("brain_preferences")
        .upsert(
          { owner_id: ownerId, preference_key: key, preference_value: value },
          { onConflict: "owner_id,preference_key" },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data.preference_value;
    },

    async addFlag(ownerId, input = {}) {
      const row = await singleRow(
        supabase
          .from("brain_consolidation_flags")
          .insert({
            owner_id: ownerId,
            kind: input.kind,
            subject_type: input.subjectType,
            subject_id: input.subjectId,
            detail: input.detail,
          })
          .select()
          .single(),
      );
      return mapFlag(row);
    },

    async listFlags(ownerId, { resolved = undefined } = {}) {
      let query = supabase
        .from("brain_consolidation_flags")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });
      if (resolved !== undefined) query = query.eq("resolved", resolved);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []).map(mapFlag);
    },

    async resolveFlag(ownerId, id) {
      const row = await singleRow(
        supabase
          .from("brain_consolidation_flags")
          .update({ resolved: true, resolved_at: new Date().toISOString() })
          .eq("owner_id", ownerId)
          .eq("id", id)
          .select(),
      );
      return mapFlag(row);
    },
  };
}
