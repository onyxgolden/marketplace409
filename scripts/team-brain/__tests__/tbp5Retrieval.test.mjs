// Team Brain P5 — immutable episode capture + deterministic retrieval.
// Offline: one in-memory PGlite per file (real PostgreSQL FTS semantics,
// no network, no live database, no credentials). Every timestamp is a
// fixed literal; no wall-clock reads in assertions.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  FORBIDDEN_SCOPES,
  MAX_RESULTS,
  computeEpisodeId,
  createRetrievalRepository,
  migrate,
} from "../retrieval/repository.mjs";
import { P5_CODES } from "../retrieval/errors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const it30 = (name, fn) => it(name, fn, 30000);

const SRC = {
  repo: "onyxgolden/marketplace409",
  path: "scripts/team-brain/retrieval/repository.mjs",
  commit: "9313e75d48976b0b08e436af49cf0e5f369f5b71",
  blob: "fixture-blob-p5",
  watermark: "main@9313e75d",
};

function episode(overrides = {}) {
  return {
    scope: "queue",
    title: "Queue ordering",
    body: "The executive queue orders open asks by filed-at time, oldest unanswered first.",
    source: { ...SRC },
    capturedAt: "2026-10-14T16:00:00Z",
    ...overrides,
  };
}

async function truncateAll(db) {
  await db.query(
    "TRUNCATE tb_working_set, tb_episode_grants, tb_pins, tb_episodes",
  );
  await db.query("UPDATE tb_retrieval_revisions SET revision = 0 WHERE id = 1");
}

function loadFixture() {
  return JSON.parse(
    readFileSync(join(HERE, "..", "retrieval", "fixtures", "labeled-queries.json"), "utf8"),
  );
}

// Seeds the labeled fixture in order. Returns { keyToId, keyToRevision }.
// Pins resolve to the revision after their afterIndex-th capture.
async function seedFixture(repo) {
  const fixture = loadFixture();
  const keyToId = {};
  const keyToRevision = {};
  for (const ep of fixture.episodes) {
    const src = {
      repo: fixture.sourceDefaults.repo,
      path: ep.source.path,
      commit: "commit" in ep.source ? ep.source.commit : fixture.sourceDefaults.commit,
      blob: "blob" in ep.source ? ep.source.blob : fixture.sourceDefaults.blob,
      watermark: fixture.sourceDefaults.watermark,
    };
    const captured = await repo.captureEpisode({
      scope: ep.scope,
      title: ep.title,
      body: ep.body,
      source: src,
      capturedAt: ep.capturedAt,
      visibility: ep.visibility ?? "public",
      grants: ep.grants ?? [],
      conflictGroup: ep.conflictGroup ?? null,
      provenanceStatus: ep.provenanceStatus ?? "COMPLETE",
      state: ep.state ?? "ACTIVE",
    });
    keyToId[ep.key] = captured.episodeId;
    keyToRevision[ep.key] = captured.revision;
  }
  for (const pin of fixture.pins) {
    await repo.pinRevision(pin.name, pin.afterIndex);
  }
  return { keyToId, keyToRevision, fixture };
}

describe("P5 schema + capture", () => {
  let db;
  let repo;

  beforeAll(async () => {
    db = new PGlite();
    await migrate(db);
    repo = createRetrievalRepository(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("schema applies and re-applies idempotently", async () => {
    await migrate(db);
    await migrate(db);
    const { rows } = await db.query(
      "SELECT COUNT(*) AS c FROM tb_episodes",
    );
    expect(Number(rows[0].c)).toBe(0);
  });

  it30("capture stores an episode with a deterministic id and revision 1", async () => {
    const ep = episode();
    const first = await repo.captureEpisode(ep);
    expect(first.episodeId).toBe(computeEpisodeId(ep));
    expect(first.revision).toBe(1);
    expect(first.replayed).toBe(false);
    expect(await repo.latestRevision()).toBe(1);
  });

  it30("replayed capture returns the stored revision without bumping", async () => {
    const ep = episode();
    const first = await repo.captureEpisode(ep);
    const second = await repo.captureEpisode(ep);
    expect(second.episodeId).toBe(first.episodeId);
    expect(second.revision).toBe(1);
    expect(second.replayed).toBe(true);
    expect(await repo.latestRevision()).toBe(1);
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(1);
  });

  it30("capture refuses unknown fields", async () => {
    await expect(
      repo.captureEpisode(episode({ surprise: true })),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
  });

  it30("capture refuses every forbidden scope", async () => {
    for (const scope of FORBIDDEN_SCOPES) {
      await expect(
        repo.captureEpisode(episode({ scope })),
      ).rejects.toMatchObject({ code: P5_CODES.FORBIDDEN_DOMAIN });
    }
    expect(await repo.latestRevision()).toBe(0);
  });

  it30("capture refuses oversize body and title", async () => {
    await expect(
      repo.captureEpisode(episode({ body: "x".repeat(64 * 1024 + 1) })),
    ).rejects.toMatchObject({ code: P5_CODES.EPISODE_OVERSIZED });
    await expect(
      repo.captureEpisode(episode({ title: "t".repeat(501) })),
    ).rejects.toMatchObject({ code: P5_CODES.EPISODE_OVERSIZED });
  });

  it30("capture refuses COMPLETE provenance without commit/blob", async () => {
    const noCommit = episode();
    delete noCommit.source.commit;
    delete noCommit.source.blob;
    await expect(repo.captureEpisode(noCommit)).rejects.toMatchObject({
      code: "INCOMPLETE_PROVENANCE",
    });
  });

  it30("capture stores an UNAVAILABLE-provenance episode", async () => {
    const ep = episode({ provenanceStatus: "UNAVAILABLE" });
    delete ep.source.commit;
    delete ep.source.blob;
    const captured = await repo.captureEpisode(ep);
    expect(captured.revision).toBe(1);
    const { rows } = await db.query(
      "SELECT provenance_status FROM tb_episodes WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(rows[0].provenance_status).toBe("UNAVAILABLE");
  });

  it30("capture rolls back atomically on a mid-transaction failure", async () => {
    let calls = 0;
    const failing = {
      query: async (sql, params) => {
        calls += 1;
        if (calls === 3) throw new Error("boom mid-transaction");
        return db.query(sql, params);
      },
    };
    const failingRepo = createRetrievalRepository(failing);
    await expect(
      failingRepo.captureEpisode(episode({ grants: ["muse"] })),
    ).rejects.toThrow("boom mid-transaction");
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(0);
    expect(await repo.latestRevision()).toBe(0);
  });

  it30("capture rejects a non-UTC timestamp", async () => {
    await expect(
      repo.captureEpisode(episode({ capturedAt: "2026-10-14 16:00:00" })),
    ).rejects.toMatchObject({ code: "MALFORMED_TIMESTAMP" });
  });
});

describe("P5 search", () => {
  let db;
  let repo;

  beforeAll(async () => {
    db = new PGlite();
    await migrate(db);
    repo = createRetrievalRepository(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("FTS search is deterministic across runs", async () => {
    await repo.captureEpisode(episode());
    await repo.captureEpisode(
      episode({
        scope: "verdicts",
        title: "Verdict binding",
        body: "A verdict at head X never authorizes a merge at head Y.",
        capturedAt: "2026-10-14T16:05:00Z",
      }),
    );
    const a = await repo.searchMemory({ query: "queue oldest", principal: "muse" });
    const b = await repo.searchMemory({ query: "queue oldest", principal: "muse" });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.results[0].episodeId).toBe(computeEpisodeId(episode()));
    expect(a.totalAuthorized).toBe(1);
    expect(a.truncated).toBe(false);
    expect(a.uncertainty).toBe("NONE");
  });

  it30("exact-ID lookup returns the episode first", async () => {
    const first = await repo.captureEpisode(episode());
    await repo.captureEpisode(
      episode({
        title: "Queue ordering again",
        body: "The executive queue orders open asks by filed-at time, oldest unanswered first, again.",
        capturedAt: "2026-10-14T16:05:00Z",
      }),
    );
    const res = await repo.searchMemory({ query: first.episodeId, principal: "muse" });
    expect(res.results[0].episodeId).toBe(first.episodeId);
    expect(res.results[0].score).toBeGreaterThan(1000000);
  });

  it30("scope listing returns scope episodes in recency order", async () => {
    await repo.captureEpisode(episode({ capturedAt: "2026-10-14T16:00:00Z" }));
    await repo.captureEpisode(
      episode({
        title: "Later queue note",
        body: "Queue notes accumulate over time.",
        capturedAt: "2026-10-14T17:00:00Z",
      }),
    );
    await repo.captureEpisode(
      episode({ scope: "verdicts", title: "Verdict note", body: "Verdict notes.", capturedAt: "2026-10-14T18:00:00Z" }),
    );
    const res = await repo.searchMemory({ query: "", scope: "queue", principal: "muse" });
    expect(res.results.map((r) => r.title)).toEqual([
      "Later queue note",
      "Queue ordering",
    ]);
  });

  it30("empty query without scope is refused; unknown pin refused; asOf+pin refused", async () => {
    await expect(repo.searchMemory({ query: "", principal: "muse" })).rejects.toMatchObject({
      code: P5_CODES.INVALID_SEARCH,
    });
    await expect(
      repo.searchMemory({ query: "queue", pin: "no-such-pin", principal: "muse" }),
    ).rejects.toMatchObject({ code: P5_CODES.UNKNOWN_PIN });
    await expect(
      repo.searchMemory({ query: "queue", asOf: 1, pin: "p", principal: "muse" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
  });

  it30("as_of pin excludes later episodes", async () => {
    const { keyToId } = await seedFixture(repo);
    const atPin = await repo.searchMemory({ query: "verdict", scope: "verdicts", pin: "pin-after-queue", principal: "muse" });
    expect(atPin.asOfRevision).toBe(3);
    expect(atPin.results).toEqual([]);
    expect(atPin.uncertainty).toBe("NO_MATCH");
    const queueAtPin = await repo.searchMemory({ query: "queue", pin: "pin-after-queue", principal: "muse" });
    expect(queueAtPin.results.length).toBeGreaterThan(0);
    expect(
      queueAtPin.results.every((r) => r.revision <= 3),
    ).toBe(true);
    expect(keyToId["ep-queue-oldest"]).toBeDefined();
  });

  it30("authorization precedes ranking: restricted visible to grantee only", async () => {
    await repo.captureEpisode(
      episode({
        scope: "plans",
        title: "Restricted rollout plan",
        body: "The restricted rollout plan describes the gated cutover sequence.",
        visibility: "restricted",
        grants: ["muse"],
      }),
    );
    await repo.captureEpisode(
      episode({
        scope: "plans",
        title: "Public rollout note",
        body: "The rollout plan notes are public and mention the rollout sequence.",
        capturedAt: "2026-10-14T16:05:00Z",
      }),
    );
    const guest = await repo.searchMemory({ query: "rollout plan", principal: "guest" });
    expect(guest.results.map((r) => r.title)).toEqual(["Public rollout note"]);
    expect(guest.totalAuthorized).toBe(1);
    const owner = await repo.searchMemory({ query: "rollout plan", principal: "muse" });
    expect(owner.totalAuthorized).toBe(2);
    expect(owner.results.map((r) => r.title)).toContain("Restricted rollout plan");
  });

  it30("denied content never leaks through snippets or counts", async () => {
    const secret = "zebra-secret-cutover-token";
    await repo.captureEpisode(
      episode({
        scope: "plans",
        title: "Restricted plan",
        body: `The restricted plan holds ${secret} for grantees only.`,
        visibility: "restricted",
        grants: ["muse"],
      }),
    );
    const guest = await repo.searchMemory({ query: "restricted plan", principal: "guest" });
    expect(JSON.stringify(guest)).not.toContain(secret);
    expect(guest.totalAuthorized).toBe(0);
  });

  it30("at most 20 candidates with truncation reported", async () => {
    for (let i = 0; i < 25; i += 1) {
      await repo.captureEpisode(
        episode({
          title: `Zebra note ${i}`,
          body: "Zebra alpha notes repeat the same searchable terms every time.",
          capturedAt: `2026-10-14T16:${String(i).padStart(2, "0")}:00Z`,
        }),
      );
    }
    const res = await repo.searchMemory({ query: "zebra alpha", principal: "muse" });
    expect(res.results.length).toBe(MAX_RESULTS);
    expect(res.totalAuthorized).toBe(25);
    expect(res.truncated).toBe(true);
  });

  it30("stable ties break by episode id ascending", async () => {
    const shared = {
      title: "Shared tie text",
      body: "Tie-break probe body with identical searchable terms.",
      capturedAt: "2026-10-14T16:00:00Z",
    };
    const a = await repo.captureEpisode(episode({ ...shared, scope: "alpha" }));
    const b = await repo.captureEpisode(episode({ ...shared, scope: "beta" }));
    const res = await repo.searchMemory({ query: "tie-break probe", principal: "muse" });
    expect(res.results.map((r) => r.episodeId)).toEqual(
      [a.episodeId, b.episodeId].sort(),
    );
    expect(res.results[0].score).toBe(res.results[1].score);
  });

  it30("citation binding: every citation resolves to the cited episode", async () => {
    const captured = await repo.captureEpisode(episode());
    const res = await repo.searchMemory({ query: "queue oldest", principal: "muse" });
    expect(res.results.length).toBe(1);
    const [hit] = res.results;
    expect(hit.citation.episodeId).toBe(hit.episodeId);
    expect(hit.citation.revision).toBe(captured.revision);
    expect(hit.citation.source.repo).toBe(SRC.repo);
    expect(hit.citation.source.path).toBe(SRC.path);
    expect(hit.citation.watermark).toBe(SRC.watermark);
    expect(hit.dbRevision).toBe(res.asOfRevision);
    const refetch = await repo.searchMemory({ query: hit.episodeId, principal: "muse" });
    expect(refetch.results[0].citation).toEqual(hit.citation);
  });

  it30("missing provenance withholds snippet and body", async () => {
    const ep = episode({
      title: "Record with missing provenance",
      body: "This record arrived without a complete source identity, so its provenance is unknown.",
      provenanceStatus: "UNAVAILABLE",
    });
    delete ep.source.commit;
    delete ep.source.blob;
    await repo.captureEpisode(ep);
    const res = await repo.searchMemory({ query: "missing provenance unknown", principal: "muse" });
    expect(res.results.length).toBe(1);
    const [hit] = res.results;
    expect(hit.snippet).toBeNull();
    expect(hit.body).toBeNull();
    expect(hit.provenanceStatus).toBe("UNAVAILABLE");
    expect(hit.unavailableReason).toBe("MISSING_PROVENANCE");
    expect(hit.uncertainty).toBe("PROVENANCE_UNAVAILABLE");
    expect(JSON.stringify(hit)).not.toContain("without a complete source identity");
  });

  it30("conflict members list each other and stay unresolved", async () => {
    const first = await repo.captureEpisode(
      episode({
        scope: "working-set",
        title: "Four slots",
        body: "The working set holds four durable slots.",
        conflictGroup: "cg-test",
        capturedAt: "2026-10-14T16:00:00Z",
      }),
    );
    const second = await repo.captureEpisode(
      episode({
        scope: "working-set",
        title: "Six slots",
        body: "The working set holds six durable slots.",
        conflictGroup: "cg-test",
        capturedAt: "2026-10-14T16:05:00Z",
      }),
    );
    const res = await repo.searchMemory({ query: "working set durable slots", principal: "muse" });
    expect(res.results.length).toBe(2);
    for (const hit of res.results) {
      expect(hit.hasConflict).toBe(true);
      expect(hit.uncertainty).toBe("CONFLICT_UNRESOLVED");
      expect(hit.conflictWith.length).toBe(1);
    }
    expect(res.results[0].conflictWith).toEqual([first.episodeId]);
  });

  it30("archived episodes stay retrievable, flagged ARCHIVED", async () => {
    const captured = await repo.captureEpisode(episode());
    await repo.archiveEpisode(captured.episodeId);
    const res = await repo.searchMemory({ query: "queue oldest", principal: "muse" });
    expect(res.results.length).toBe(1);
    expect(res.results[0].state).toBe("ARCHIVED");
  });

  it30("freshness: latest revision is current, older is historical", async () => {
    await repo.captureEpisode(episode({ capturedAt: "2026-10-14T16:00:00Z" }));
    await repo.captureEpisode(
      episode({
        title: "Later note",
        body: "A later queue note about ordering.",
        capturedAt: "2026-10-14T17:00:00Z",
      }),
    );
    const res = await repo.searchMemory({ query: "queue", principal: "muse" });
    const byTitle = Object.fromEntries(res.results.map((r) => [r.title, r]));
    expect(byTitle["Later note"].freshness).toBe("current");
    expect(byTitle["Queue ordering"].freshness).toBe("historical");
    expect(res.latestRevision).toBe(2);
  });

  it30("injection-hostile query and body cannot break out of parameters", async () => {
    await repo.captureEpisode(
      episode({
        title: "Injection probe",
        body: "x'); DROP TABLE tb_episodes; -- and ' UNION SELECT * FROM tb_episodes --",
      }),
    );
    const res = await repo.searchMemory({ query: "' OR '1'='1", principal: "muse" });
    expect(res.totalAuthorized).toBe(0);
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(1);
  });

  it30("forbidden scope is excluded even on direct insert; forbidden scope search refused", async () => {
    await repo.captureEpisode(episode());
    await db.query(
      `INSERT INTO tb_episodes (
        episode_id, scope, title, body, source_repo, source_path,
        source_commit, source_blob, source_watermark, captured_at,
        captured_at_ms, revision, state, visibility, provenance_status, conflict_group
      ) VALUES ('ep-direct-tenant', 'tenant', 'Tenant record', 'Tenant ledger body mentions queue ordering.', $1, $2, $3, $4, $5, $6, $7, 1, 'ACTIVE', 'public', 'COMPLETE', NULL)`,
      [SRC.repo, SRC.path, SRC.commit, SRC.blob, SRC.watermark, "2026-10-14T16:00:00Z", 1728921600000],
    );
    const res = await repo.searchMemory({ query: "queue ordering", principal: "muse" });
    expect(res.results.map((r) => r.episodeId)).not.toContain("ep-direct-tenant");
    expect(res.totalAuthorized).toBe(1);
    await expect(
      repo.searchMemory({ query: "", scope: "tenant", principal: "muse" }),
    ).rejects.toMatchObject({ code: P5_CODES.FORBIDDEN_DOMAIN });
  });

  it30("anonymous retrieval is refused", async () => {
    await repo.captureEpisode(episode());
    await expect(repo.searchMemory({ query: "queue" })).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
  });
});

describe("P5 pins + working set", () => {
  let db;
  let repo;

  beforeAll(async () => {
    db = new PGlite();
    await migrate(db);
    repo = createRetrievalRepository(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("pins bind a revision, replay idempotently, refuse repointing", async () => {
    await repo.captureEpisode(episode());
    const first = await repo.pinRevision("release", 1);
    expect(first.replayed).toBe(false);
    const replay = await repo.pinRevision("release", 1);
    expect(replay.replayed).toBe(true);
    await expect(repo.pinRevision("release", 2)).rejects.toMatchObject({
      code: P5_CODES.PIN_CONFLICT,
    });
    const res = await repo.searchMemory({ query: "queue", pin: "release", principal: "muse" });
    expect(res.asOfRevision).toBe(1);
    expect(res.results.length).toBe(1);
  });

  it30("working set holds four slots per principal", async () => {
    const ids = [];
    for (let i = 0; i < 4; i += 1) {
      const captured = await repo.captureEpisode(
        episode({
          title: `Slot note ${i}`,
          body: `Working set slot note number ${i}.`,
          capturedAt: `2026-10-14T16:0${i}:00Z`,
        }),
      );
      ids.push(captured);
      await repo.setWorkingSetSlot("muse", i + 1, captured.episodeId, captured.revision);
    }
    const set = await repo.getWorkingSet("muse");
    for (let slot = 1; slot <= 4; slot += 1) {
      expect(set[slot].episodeId).toBe(ids[slot - 1].episodeId);
    }
    expect(await repo.getWorkingSet("guest")).toEqual({
      1: null,
      2: null,
      3: null,
      4: null,
    });
  });

  it30("working-set displacement writes through; failed write retains the slot", async () => {
    const first = await repo.captureEpisode(episode());
    const second = await repo.captureEpisode(
      episode({ title: "Second note", body: "A second queue note.", capturedAt: "2026-10-14T16:05:00Z" }),
    );
    await repo.setWorkingSetSlot("muse", 1, first.episodeId, first.revision);
    await repo.setWorkingSetSlot("muse", 1, second.episodeId, second.revision);
    expect((await repo.getWorkingSet("muse"))[1].episodeId).toBe(second.episodeId);

    let calls = 0;
    const failing = {
      query: async (sql, params) => {
        calls += 1;
        if (calls === 2) throw new Error("boom on upsert");
        return db.query(sql, params);
      },
    };
    const failingRepo = createRetrievalRepository(failing);
    await expect(
      failingRepo.setWorkingSetSlot("muse", 1, first.episodeId, first.revision),
    ).rejects.toThrow("boom on upsert");
    expect((await repo.getWorkingSet("muse"))[1].episodeId).toBe(second.episodeId);
  });

  it30("working-set slot and episode validation", async () => {
    const captured = await repo.captureEpisode(episode());
    await expect(
      repo.setWorkingSetSlot("muse", 0, captured.episodeId, 1),
    ).rejects.toMatchObject({ code: P5_CODES.INVALID_SLOT });
    await expect(
      repo.setWorkingSetSlot("muse", 5, captured.episodeId, 1),
    ).rejects.toMatchObject({ code: P5_CODES.INVALID_SLOT });
    await expect(
      repo.setWorkingSetSlot("muse", 1, "ep-does-not-exist", 1),
    ).rejects.toMatchObject({ code: P5_CODES.UNKNOWN_EPISODE });
    await expect(repo.archiveEpisode("ep-does-not-exist")).rejects.toMatchObject({
      code: P5_CODES.UNKNOWN_EPISODE,
    });
  });
});

describe("P5 labeled-fixture evaluation", () => {
  let db;
  let repo;

  beforeAll(async () => {
    db = new PGlite();
    await migrate(db);
    repo = createRetrievalRepository(db);
  }, 60000);
  afterAll(async () => {
    await db.close();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });

  it30("40 labeled queries: citation binding 100%, seeded-conflict recall 100%, honest precision/recall@5", async () => {
    const { keyToId, fixture } = await seedFixture(repo);
    const toIds = (keys) => keys.map((k) => keyToId[k]);

    let citationChecked = 0;
    let citationBound = 0;
    let conflictQueries = 0;
    let conflictRecalled = 0;
    let recallAt20Sum = 0;
    let precisionAt5Sum = 0;
    let recallAt5Sum = 0;
    let scoredQueries = 0;
    const perQuery = [];

    for (const q of fixture.queries) {
      const res = await repo.searchMemory({
        query: q.query,
        scope: q.scope ?? null,
        pin: q.pin ?? null,
        principal: q.principal ?? "muse",
      });
      const returnedIds = res.results.map((r) => r.episodeId);
      const expectedIds = toIds(q.expectedKeys);

      // Citation binding: every result's citation resolves by exact ID
      // to the same revision and source.
      for (const hit of res.results) {
        citationChecked += 1;
        const refetch = await repo.searchMemory({
          query: hit.episodeId,
          principal: q.principal ?? "muse",
        });
        const cited = refetch.results.find((r) => r.episodeId === hit.episodeId);
        if (
          cited &&
          cited.citation.episodeId === hit.citation.episodeId &&
          cited.citation.revision === hit.citation.revision &&
          cited.citation.source.repo === hit.citation.source.repo &&
          cited.citation.source.path === hit.citation.source.path &&
          cited.citation.watermark === hit.citation.watermark
        ) {
          citationBound += 1;
        }
      }

      if (expectedIds.length === 0) {
        expect(returnedIds).toEqual([]);
        continue;
      }
      // Full recall@20 on the labeled set.
      for (const id of expectedIds) {
        expect(returnedIds).toContain(id);
      }
      recallAt20Sum += expectedIds.filter((id) => returnedIds.includes(id)).length / expectedIds.length;

      // Seeded-conflict recall: queries whose expected set contains both
      // members of a conflict group must recall every member.
      const groups = new Set(
        fixture.episodes
          .filter((e) => e.conflictGroup && q.expectedKeys.includes(e.key))
          .map((e) => e.conflictGroup),
      );
      for (const group of groups) {
        const members = fixture.episodes
          .filter((e) => e.conflictGroup === group)
          .map((e) => keyToId[e.key]);
        if (members.every((m) => q.expectedKeys.map((k) => keyToId[k]).includes(m))) {
          conflictQueries += 1;
          if (members.every((m) => returnedIds.includes(m))) conflictRecalled += 1;
        }
      }

      const top5 = returnedIds.slice(0, 5);
      const hits5 = top5.filter((id) => expectedIds.includes(id)).length;
      const p5 = returnedIds.length === 0 ? 0 : hits5 / Math.min(5, returnedIds.length);
      const r5 = hits5 / expectedIds.length;
      precisionAt5Sum += p5;
      recallAt5Sum += r5;
      scoredQueries += 1;
      perQuery.push({ id: q.id, p5: Number(p5.toFixed(3)), r5: Number(r5.toFixed(3)) });
    }

    const citationRate = citationChecked ? citationBound / citationChecked : 1;
    const conflictRate = conflictQueries ? conflictRecalled / conflictQueries : 1;
    const meanP5 = scoredQueries ? precisionAt5Sum / scoredQueries : 0;
    const meanR5 = scoredQueries ? recallAt5Sum / scoredQueries : 0;
    const meanRecall20 = scoredQueries ? recallAt20Sum / scoredQueries : 0;
    // Honest report (printed by the runner, carried into the slice report).
    console.log(
      `P5 fixture: ${fixture.queries.length} queries, citation binding ${citationBound}/${citationChecked} (${citationRate}), ` +
        `seeded-conflict recall ${conflictRecalled}/${conflictQueries} (${conflictRate}), ` +
        `mean recall@20 ${meanRecall20}, mean precision@5 ${meanP5}, mean recall@5 ${meanR5}`,
    );
    console.log(`P5 per-query P@5/R@5: ${JSON.stringify(perQuery)}`);

    expect(citationRate).toBe(1);
    expect(conflictRate).toBe(1);
    expect(meanRecall20).toBe(1);
    expect(meanP5).toBeGreaterThanOrEqual(0);
    expect(meanP5).toBeLessThanOrEqual(1);
    expect(meanR5).toBeGreaterThanOrEqual(0);
    expect(meanR5).toBeLessThanOrEqual(1);
  });
});
