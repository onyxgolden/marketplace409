// Team Brain P5 — immutable episode capture + deterministic retrieval.
// Offline: one in-memory PGlite per file (real PostgreSQL FTS semantics,
// no network, no live database, no credentials). Every timestamp is a
// fixed literal; no wall-clock reads in assertions.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
import {
  citationMatches,
  expectedCitationFor,
} from "../retrieval/citation.mjs";
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
    "TRUNCATE tb_working_set, tb_episode_grants, tb_pins, tb_episode_events, tb_episodes",
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
      // Fix round 2 (TBP5-009): the fixture's ARCHIVED episode enters
      // through the authorized import path, with the same full audit
      // identity an archiveEpisode call would carry.
      ...(ep.state === "ARCHIVED"
        ? { archiveAudit: { note: "Fixture import: archived at capture.", actor: "fixture" } }
        : {}),
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
    // Fix round 1 (TBP5-007): commit/blob are asserted against the
    // independently supplied capture input, never against a refetch of
    // the same renderer — a renderer returning invented pins on every
    // lookup must fail here.
    expect(hit.citation.source.commit).toBe(SRC.commit);
    expect(hit.citation.source.blob).toBe(SRC.blob);
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
    await repo.archiveEpisode(captured.episodeId, { note: "Retired.", actor: "muse" });
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
    const { keyToId, keyToRevision, fixture } = await seedFixture(repo);
    const toIds = (keys) => keys.map((k) => keyToId[k]);
    const idToKey = Object.fromEntries(
      Object.entries(keyToId).map(([key, id]) => [id, key]),
    );
    const episodeByKey = Object.fromEntries(
      fixture.episodes.map((e) => [e.key, e]),
    );

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

      // Citation binding (fix round 1, TBP5-007): every result's FULL
      // citation identity — episode, repo, path, commit, blob,
      // revision, watermark — is compared against the independently
      // labeled fixture oracle, never against a second call to the
      // same renderer. An invented commit/blob fails here.
      for (const hit of res.results) {
        citationChecked += 1;
        const key = idToKey[hit.episodeId];
        const expected =
          key === undefined
            ? null
            : expectedCitationFor(
                fixture,
                episodeByKey[key],
                hit.episodeId,
                keyToRevision[key],
              );
        if (expected && citationMatches(hit.citation, expected)) {
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

// Fix round 1 (ChatGPT NEEDS CHANGES 2026-10-30, TBP5-001..007).
// Each test freezes one executed counterexample from
// results/chatgpt/probes/team-brain-p5-counterexamples-2026-10-30.mjs
// with the repaired expectation. No live database, no network.
describe("P5 fix round 1 — TBP5-001..007 regressions", () => {
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

  // Counterexample probe shape: one public engineering episode plus a
  // restricted alternative in the same conflict group.
  const synthSrc = {
    repo: "synthetic/engineering",
    path: "fixtures/decision.md",
    commit: "a".repeat(40),
    blob: "b".repeat(40),
    watermark: "synthetic@1",
  };
  const synth = (overrides = {}) => ({
    scope: "engineering",
    title: "Queue decision",
    body: "The synthetic queue rule orders tasks oldest first.",
    source: { ...synthSrc },
    capturedAt: "2026-10-14T16:00:00Z",
    ...overrides,
  });

  it30("TBP5-001: conflict metadata hides denied counterparts, shows authorized ones", async () => {
    const pub = await repo.captureEpisode(synth({ conflictGroup: "g" }));
    const restricted = await repo.captureEpisode(
      synth({
        title: "Restricted alternative",
        body: "Restricted synthetic alternative rule.",
        visibility: "restricted",
        grants: ["owner"],
        conflictGroup: "g",
      }),
    );
    const guest = await repo.searchMemory({ query: pub.episodeId, principal: "guest" });
    expect(guest.results.length).toBe(1);
    expect(guest.results[0].conflictWith).toEqual([]);
    expect(guest.results[0].hasConflict).toBe(false);
    expect(guest.results[0].uncertainty).toBe("NONE");
    expect(JSON.stringify(guest)).not.toContain(restricted.episodeId);
    const owner = await repo.searchMemory({ scope: "engineering", principal: "owner" });
    expect(owner.results.map((r) => r.episodeId).sort()).toEqual(
      [pub.episodeId, restricted.episodeId].sort(),
    );
    for (const hit of owner.results) {
      expect(hit.hasConflict).toBe(true);
      expect(hit.conflictWith.length).toBe(1);
    }
  });

  it30("TBP5-001: forbidden-domain counterparts never appear in conflict metadata", async () => {
    const pub = await repo.captureEpisode(synth({ conflictGroup: "g2" }));
    await db.query(
      `INSERT INTO tb_episodes (
        episode_id, scope, title, body, source_repo, source_path,
        source_commit, source_blob, source_watermark, captured_at,
        captured_at_ms, revision, state, visibility, provenance_status, conflict_group
      ) VALUES ('ep-direct-tenant-g2', 'tenant', 'Tenant record', 'Tenant body.', $1, $2, $3, $4, $5, $6, $7, 1, 'ACTIVE', 'public', 'COMPLETE', 'g2')`,
      [synthSrc.repo, synthSrc.path, synthSrc.commit, synthSrc.blob, synthSrc.watermark, "2026-10-14T16:00:00Z", 1728921600000],
    );
    for (const principal of ["guest", "muse"]) {
      const res = await repo.searchMemory({ query: pub.episodeId, principal });
      expect(res.results[0].conflictWith).toEqual([]);
      expect(res.results[0].hasConflict).toBe(false);
      expect(JSON.stringify(res)).not.toContain("ep-direct-tenant-g2");
    }
  });

  it30("TBP5-002: concurrent exact duplicates yield one durable episode + consistent replay", async () => {
    const outcomes = await Promise.allSettled([
      repo.captureEpisode(synth()),
      repo.captureEpisode(synth()),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
    const replayed = outcomes.map((o) => o.value.replayed).sort();
    expect(replayed).toEqual([false, true]);
    expect(outcomes[0].value.episodeId).toBe(outcomes[1].value.episodeId);
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(1);
    expect(await repo.latestRevision()).toBe(1);
  });

  it30("TBP5-002: the lock is shared by every adapter instance on one connection", async () => {
    const repo2 = createRetrievalRepository(db);
    const outcomes = await Promise.allSettled([
      repo.captureEpisode(synth()),
      repo2.captureEpisode(synth()),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(outcomes.map((o) => o.value.replayed).sort()).toEqual([false, true]);
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(1);
  });

  it30("TBP5-002: distinct concurrent captures both persist; a failing capture rolls back nothing acknowledged", async () => {
    const distinct = await Promise.allSettled([
      repo.captureEpisode(synth()),
      repo.captureEpisode(synth({ title: "Second decision", body: "A second synthetic rule." })),
    ]);
    expect(distinct.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await repo.latestRevision()).toBe(2);
    const mixed = await Promise.allSettled([
      repo.captureEpisode(synth({ title: "Third decision", body: "A third synthetic rule." })),
      repo.captureEpisode(synth({ body: "x".repeat(64 * 1024 + 1) })),
    ]);
    expect(mixed[0].status).toBe("fulfilled");
    expect(mixed[1].status).toBe("rejected");
    const { rows } = await db.query("SELECT COUNT(*) AS c FROM tb_episodes");
    expect(Number(rows[0].c)).toBe(3);
    expect(await repo.latestRevision()).toBe(3);
  });

  it30("TBP5-003: archive event projects ARCHIVED at latest, original state at the earlier pin", async () => {
    const captured = await repo.captureEpisode(synth());
    await repo.pinRevision("before-archive", 1);
    const before = await repo.searchMemory({ query: captured.episodeId, pin: "before-archive", principal: "guest" });
    expect(before.results[0].state).toBe("ACTIVE");
    const archived = await repo.archiveEpisode(captured.episodeId, { note: "Superseded by later rule.", actor: "muse" });
    expect(archived).toMatchObject({ episodeId: captured.episodeId, state: "ARCHIVED", revision: 2, replayed: false });
    expect(await repo.latestRevision()).toBe(2);
    const atPin = await repo.searchMemory({ query: captured.episodeId, pin: "before-archive", principal: "guest" });
    expect(atPin.results[0].state).toBe("ACTIVE");
    expect(atPin.dbRevision).toBe(1);
    const atLatest = await repo.searchMemory({ query: captured.episodeId, principal: "guest" });
    expect(atLatest.results[0].state).toBe("ARCHIVED");
    expect(atLatest.dbRevision).toBe(2);
  });

  it30("TBP5-009: exact archive replay returns replayed:true with no bump and no second event", async () => {
    const captured = await repo.captureEpisode(synth());
    const first = await repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse" });
    const second = await repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse" });
    expect(second).toMatchObject({ episodeId: captured.episodeId, state: "ARCHIVED", revision: first.revision, replayed: true });
    expect(await repo.latestRevision()).toBe(first.revision);
    const { rows } = await db.query(
      "SELECT event_type, revision, note, actor FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].event_type).toBe("ARCHIVED");
    expect(Number(rows[0].revision)).toBe(first.revision);
    expect(rows[0].note).toBe("n");
    expect(rows[0].actor).toBe("muse");
  });

  it30("TBP5-009: one-field-at-a-time audit mismatches fail with ARCHIVE_REPLAY_CONFLICT", async () => {
    const captured = await repo.captureEpisode(synth());
    const first = await repo.archiveEpisode(captured.episodeId, {
      note: "approved",
      actor: "muse",
      operationId: "op-1",
      timestamp: "2026-10-31T00:00:00Z",
    });
    // Changed note, changed actor, changed operation id, changed
    // claimed timestamp — each alone must fail, never replay.
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "different", actor: "muse", operationId: "op-1", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "other", operationId: "op-1", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "muse", operationId: "op-2", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "muse", operationId: "op-1", timestamp: "2026-10-31T00:00:01Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    // The failed replays changed nothing: same revision, one event,
    // and the exact replay still succeeds afterward.
    expect(await repo.latestRevision()).toBe(first.revision);
    const { rows } = await db.query(
      "SELECT COUNT(*) AS c FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(Number(rows[0].c)).toBe(1);
    const exact = await repo.archiveEpisode(captured.episodeId, {
      note: "approved",
      actor: "muse",
      operationId: "op-1",
      timestamp: "2026-10-31T00:00:00Z",
    });
    expect(exact.replayed).toBe(true);
    expect(exact.revision).toBe(first.revision);
  });

  it30("TBP5-009: omitted audit and typo/unknown fields are refused, never replayed", async () => {
    const captured = await repo.captureEpisode(synth());
    await repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse" });
    // The verdict's exact gap: a second call supplying no audit fields
    // was accepted as idempotent replay. Now it is refused.
    await expect(repo.archiveEpisode(captured.episodeId)).rejects.toMatchObject({
      code: "INVALID_FIELD",
    });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "n" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(
      repo.archiveEpisode(captured.episodeId, { actor: "muse" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    // A typo is silently discarded by no one: unknown fields fail.
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse", acotr: "muse" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse", reason: "extra" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    // Empty strings are not audit identity either.
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "", actor: "muse" }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    const { rows } = await db.query(
      "SELECT COUNT(*) AS c FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(Number(rows[0].c)).toBe(1);
  });

  it30("TBP5-009: import path — ARCHIVED capture writes the event; replay compares import audit", async () => {
    const imported = await repo.captureEpisode(
      synth({
        title: "Imported archived",
        body: "An imported archived synthetic rule.",
        state: "ARCHIVED",
        archiveAudit: { note: "imported", actor: "muse", operationId: "import-1" },
      }),
    );
    expect(imported.replayed).toBe(false);
    const { rows } = await db.query(
      "SELECT note, actor, operation_id, revision FROM tb_episode_events WHERE episode_id = $1",
      [imported.episodeId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].note).toBe("imported");
    expect(rows[0].actor).toBe("muse");
    expect(rows[0].operation_id).toBe("import-1");
    expect(Number(rows[0].revision)).toBe(imported.revision);
    // archiveEpisode against the import event: exact identity replays,
    // a different claim conflicts — the import does not bypass the
    // event/audit contract.
    const replay = await repo.archiveEpisode(imported.episodeId, {
      note: "imported",
      actor: "muse",
      operationId: "import-1",
    });
    expect(replay).toMatchObject({ state: "ARCHIVED", revision: imported.revision, replayed: true });
    await expect(
      repo.archiveEpisode(imported.episodeId, { note: "changed", actor: "muse", operationId: "import-1" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    // Capture-level replay of the import: same audit replays, a
    // different audit conflicts instead of silently reusing the id.
    const again = await repo.captureEpisode(
      synth({
        title: "Imported archived",
        body: "An imported archived synthetic rule.",
        state: "ARCHIVED",
        archiveAudit: { note: "imported", actor: "muse", operationId: "import-1" },
      }),
    );
    expect(again.episodeId).toBe(imported.episodeId);
    expect(again.replayed).toBe(true);
    await expect(
      repo.captureEpisode(
        synth({
          title: "Imported archived",
          body: "An imported archived synthetic rule.",
          state: "ARCHIVED",
          archiveAudit: { note: "different", actor: "muse", operationId: "import-1" },
        }),
      ),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
  });

  it30("TBP5-009: ARCHIVED capture without audit refused; ACTIVE capture with audit refused", async () => {
    await expect(
      repo.captureEpisode(synth({ state: "ARCHIVED" })),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_AUDIT_REQUIRED });
    await expect(
      repo.captureEpisode(synth({ archiveAudit: { note: "n", actor: "muse" } })),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
    expect(await repo.latestRevision()).toBe(0);
  });

  it30("TBP5-004: future pin refused with no side effect; future asOf refused", async () => {
    await expect(repo.pinRevision("future", 10)).rejects.toMatchObject({
      code: P5_CODES.FUTURE_REVISION,
    });
    expect(await repo.latestRevision()).toBe(0);
    await expect(
      repo.searchMemory({ query: "queue", pin: "future", principal: "guest" }),
    ).rejects.toMatchObject({ code: P5_CODES.UNKNOWN_PIN });
    await repo.captureEpisode(synth());
    await expect(
      repo.searchMemory({ scope: "engineering", asOf: 100, principal: "guest" }),
    ).rejects.toMatchObject({ code: P5_CODES.FUTURE_REVISION });
    expect(await repo.latestRevision()).toBe(1);
  });

  it30("TBP5-004: revision 0 and historical pins stay valid; historical queries are stable", async () => {
    const empty = await repo.pinRevision("empty", 0);
    expect(empty.replayed).toBe(false);
    const atEmpty = await repo.searchMemory({ scope: "engineering", pin: "empty", principal: "guest" });
    expect(atEmpty.asOfRevision).toBe(0);
    expect(atEmpty.results).toEqual([]);
    const first = await repo.captureEpisode(synth());
    await repo.pinRevision("after-first", 1);
    const a = await repo.searchMemory({ query: first.episodeId, pin: "after-first", principal: "guest" });
    await repo.captureEpisode(synth({ title: "Later decision", body: "A later synthetic rule." }));
    const b = await repo.searchMemory({ query: first.episodeId, pin: "after-first", principal: "guest" });
    // Pinned results are stable across later captures. (The envelope's
    // latestRevision/freshness legitimately track the store's current
    // head; stability binds the pinned as_of view, not the envelope.)
    expect(JSON.stringify(b.results)).toBe(JSON.stringify(a.results));
    expect(b.asOfRevision).toBe(a.asOfRevision);
    expect(b.dbRevision).toBe(a.dbRevision);
    expect(b.results[0].episodeId).toBe(first.episodeId);
  });

  it30("TBP5-005: denied displacement preserves the prior slot; wrong revision refused", async () => {
    const pub = await repo.captureEpisode(synth());
    const restricted = await repo.captureEpisode(
      synth({
        title: "Restricted decision",
        body: "A restricted synthetic rule.",
        visibility: "restricted",
        grants: ["owner"],
      }),
    );
    await repo.setWorkingSetSlot("guest", 1, pub.episodeId, pub.revision);
    await expect(
      repo.setWorkingSetSlot("guest", 1, restricted.episodeId, restricted.revision),
    ).rejects.toMatchObject({ code: P5_CODES.ACCESS_DENIED });
    expect((await repo.getWorkingSet("guest"))[1]).toEqual({
      episodeId: pub.episodeId,
      revision: pub.revision,
    });
    await expect(
      repo.setWorkingSetSlot("guest", 1, pub.episodeId, 999),
    ).rejects.toMatchObject({ code: P5_CODES.REVISION_MISMATCH });
    expect((await repo.getWorkingSet("guest"))[1]).toEqual({
      episodeId: pub.episodeId,
      revision: pub.revision,
    });
  });

  it30("TBP5-005: authorized displacement succeeds; read revalidation withholds ineligible references", async () => {
    const restricted = await repo.captureEpisode(
      synth({
        title: "Restricted decision",
        body: "A restricted synthetic rule.",
        visibility: "restricted",
        grants: ["owner"],
      }),
    );
    const set = await repo.setWorkingSetSlot("owner", 1, restricted.episodeId, restricted.revision);
    expect(set).toEqual({ principal: "owner", slot: 1, episodeId: restricted.episodeId, revision: restricted.revision });
    expect((await repo.getWorkingSet("owner"))[1]).toEqual({
      episodeId: restricted.episodeId,
      revision: restricted.revision,
    });
    // Grant removed directly: the slot must read back withheld, and the
    // forbidden identity must not appear in the returned working set.
    await db.query("DELETE FROM tb_episode_grants WHERE episode_id = $1", [restricted.episodeId]);
    const after = await repo.getWorkingSet("owner");
    expect(after[1]).toBeNull();
    expect(JSON.stringify(after)).not.toContain(restricted.episodeId);
  });

  it30("TBP5-006: changed visibility is a new episode, never a silent replay", async () => {
    const pub = await repo.captureEpisode(synth({ visibility: "public" }));
    const restricted = await repo.captureEpisode(
      synth({ visibility: "restricted", grants: ["owner"] }),
    );
    expect(restricted.episodeId).not.toBe(pub.episodeId);
    expect(restricted.replayed).toBe(false);
    const guest = await repo.searchMemory({ query: pub.episodeId, principal: "guest" });
    expect(guest.results.map((r) => r.episodeId)).toEqual([pub.episodeId]);
    const owner = await repo.searchMemory({ scope: "engineering", principal: "owner" });
    expect(owner.results.map((r) => r.episodeId).sort()).toEqual(
      [pub.episodeId, restricted.episodeId].sort(),
    );
  });

  it30("TBP5-006: grant order is a set; provenance and state partners differ; exact replay still replays", async () => {
    const ordered = await repo.captureEpisode(synth({ grants: ["b-principal", "a-principal"] }));
    const reordered = await repo.captureEpisode(synth({ grants: ["a-principal", "b-principal"] }));
    expect(reordered.episodeId).toBe(ordered.episodeId);
    expect(reordered.replayed).toBe(true);
    const complete = await repo.captureEpisode(
      synth({ title: "Provenance partner", body: "Provenance partner body." }),
    );
    const unavailable = await repo.captureEpisode(
      synth({ title: "Provenance partner", body: "Provenance partner body.", provenanceStatus: "UNAVAILABLE" }),
    );
    expect(unavailable.episodeId).not.toBe(complete.episodeId);
    expect(unavailable.replayed).toBe(false);
    const active = await repo.captureEpisode(
      synth({ title: "State partner", body: "State partner body." }),
    );
    // Fix round 2 (TBP5-009): an ARCHIVED capture enters only through
    // the authorized import path, with full archive audit identity.
    const archivedState = await repo.captureEpisode(
      synth({
        title: "State partner",
        body: "State partner body.",
        state: "ARCHIVED",
        archiveAudit: { note: "Imported archived.", actor: "muse" },
      }),
    );
    expect(archivedState.episodeId).not.toBe(active.episodeId);
    expect(archivedState.replayed).toBe(false);
    const exact = await repo.captureEpisode(synth());
    const exactReplay = await repo.captureEpisode(synth());
    expect(exactReplay.episodeId).toBe(exact.episodeId);
    expect(exactReplay.replayed).toBe(true);
  });

  it30("TBP5-007: corrupted citation pins fail the scorer", async () => {
    const { keyToId, keyToRevision, fixture } = await seedFixture(repo);
    const res = await repo.searchMemory({ query: "oldest unanswered queue ordering", principal: "muse" });
    expect(res.results.length).toBeGreaterThan(0);
    const hit = res.results[0];
    const key = Object.entries(keyToId).find(([, id]) => id === hit.episodeId)[0];
    const episode = fixture.episodes.find((e) => e.key === key);
    const expected = expectedCitationFor(fixture, episode, hit.episodeId, keyToRevision[key]);
    expect(citationMatches(hit.citation, expected)).toBe(true);
    // The verdict's exact mutation: invented commit/blob on the
    // returned citation. The oracle comparison must fail it.
    const corrupted = {
      ...hit.citation,
      source: { ...hit.citation.source, commit: "invented-commit", blob: "invented-blob" },
    };
    expect(citationMatches(corrupted, expected)).toBe(false);
  });

  it30("TBP5-007: fixture receipt authenticates the labeled fixture", async () => {
    const receipt = JSON.parse(
      readFileSync(join(HERE, "..", "retrieval", "fixtures", "labeled-queries.receipt.json"), "utf8"),
    );
    const fixtureBytes = readFileSync(
      join(HERE, "..", "retrieval", "fixtures", "labeled-queries.json"),
    );
    expect(receipt.fixtureSha256).toBe(
      createHash("sha256").update(fixtureBytes).digest("hex"),
    );
    const fixture = JSON.parse(fixtureBytes.toString("utf8"));
    expect(receipt.episodes).toBe(fixture.episodes.length);
    expect(receipt.queries).toBe(fixture.queries.length);
    expect(receipt.pins).toBe(fixture.pins.length);
  });
});

describe("P5 fix round 2 — TBP5-008..010", () => {
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

  const synthSrc = {
    repo: "synthetic/engineering",
    path: "fixtures/decision.md",
    commit: "a".repeat(40),
    blob: "b".repeat(40),
    watermark: "synthetic@1",
  };
  const synth = (overrides = {}) => ({
    scope: "engineering",
    title: "Queue decision",
    body: "The synthetic queue rule orders tasks oldest first.",
    source: { ...synthSrc },
    capturedAt: "2026-10-14T16:00:00Z",
    ...overrides,
  });

  // A deterministic stand-in for pg.Pool: N independent PGlite
  // databases. connect() round-robins checked-out clients; pool-level
  // query() round-robins per call. The pool markers (totalCount etc.)
  // are what classify it as pool-like. Because the underlying
  // databases share nothing, any transaction scattered across them is
  // observable: no single connection ends up with both the episode row
  // and the revision bump. On the pre-fix code this test's binding
  // assertions fail (BEGIN/INSERT/COMMIT scatter); on the fixed code
  // they pass.
  class FakePool {
    constructor(count) {
      this.connections = [];
      this.nextConnect = 0;
      this.nextQuery = 0;
      this.poolQueryCalls = 0;
      this.totalCount = count;
      this.idleCount = count;
      this.waitingCount = 0;
    }
    static async create(count) {
      const pool = new FakePool(count);
      for (let i = 0; i < count; i++) {
        const pg = new PGlite();
        await migrate(pg);
        pool.connections.push({ pg, statements: [] });
      }
      return pool;
    }
    async connect() {
      const entry = this.connections[this.nextConnect % this.connections.length];
      this.nextConnect += 1;
      return {
        query: async (sql, params) => {
          entry.statements.push(sql);
          return entry.pg.query(sql, params);
        },
        release: () => {},
      };
    }
    async query(sql, params) {
      this.poolQueryCalls += 1;
      const entry = this.connections[this.nextQuery % this.connections.length];
      this.nextQuery += 1;
      return entry.pg.query(sql, params);
    }
    async closeAll() {
      for (const entry of this.connections) await entry.pg.close();
    }
  }

  async function connectionState(entry) {
    const { rows: erows } = await entry.pg.query("SELECT COUNT(*) AS c FROM tb_episodes");
    const { rows: rrows } = await entry.pg.query(
      "SELECT revision FROM tb_retrieval_revisions WHERE id = 1",
    );
    return { episodes: Number(erows[0].c), revision: Number(rrows[0].revision) };
  }

  it30("TBP5-008: pool transactions bind BEGIN..COMMIT to one checked-out connection", async () => {
    const pool = await FakePool.create(2);
    try {
      const poolRepo = createRetrievalRepository(pool);
      const first = await poolRepo.captureEpisode(synth());
      expect(first).toMatchObject({ replayed: false, revision: 1 });
      // No pool-level query routing happened during the transaction.
      expect(pool.poolQueryCalls).toBe(0);
      // Exactly one underlying connection holds BOTH the episode row
      // and the revision bump; the other holds nothing.
      const states = [await connectionState(pool.connections[0]), await connectionState(pool.connections[1])];
      expect(states.filter((s) => s.episodes === 1 && s.revision === 1).length).toBe(1);
      expect(states.filter((s) => s.episodes === 0 && s.revision === 0).length).toBe(1);
      // The transaction's statements all hit that one connection.
      const txEntries = pool.connections.filter((e) => e.statements.includes("BEGIN"));
      expect(txEntries.length).toBe(1);
      expect(txEntries[0].statements).toContain("COMMIT");
      // A second, different capture checks out the OTHER connection
      // and is likewise whole there.
      const second = await poolRepo.captureEpisode(
        synth({ title: "Second decision", body: "A second synthetic rule." }),
      );
      expect(second).toMatchObject({ replayed: false, revision: 1 });
      const states2 = [await connectionState(pool.connections[0]), await connectionState(pool.connections[1])];
      expect(states2.filter((s) => s.episodes === 1 && s.revision === 1).length).toBe(2);
      expect(pool.connections.filter((e) => e.statements.includes("BEGIN")).length).toBe(2);
    } finally {
      await pool.closeAll();
    }
  });

  it30("TBP5-008: a checked-out client (even one with connect()) takes the dedicated-connection path", async () => {
    const pg = new PGlite();
    try {
      await migrate(pg);
      let connectCalls = 0;
      const client = {
        query: (sql, params) => pg.query(sql, params),
        release: () => {},
        connect: async () => {
          connectCalls += 1;
          throw new Error("client connect must not be called");
        },
      };
      const clientRepo = createRetrievalRepository(client);
      const first = await clientRepo.captureEpisode(synth());
      expect(first).toMatchObject({ replayed: false, revision: 1 });
      const again = await clientRepo.captureEpisode(synth());
      expect(again).toMatchObject({ replayed: true, revision: 1 });
      expect(connectCalls).toBe(0);
      const { rows } = await pg.query("SELECT COUNT(*) AS c FROM tb_episodes");
      expect(Number(rows[0].c)).toBe(1);
    } finally {
      await pg.close();
    }
  });

  it30("TBP5-008: unsupported handle shapes fail loudly, never silently", async () => {
    let thrown = null;
    try {
      createRetrievalRepository({});
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.code).toBe(P5_CODES.UNSUPPORTED_HANDLE);
    await expect(migrate({})).rejects.toMatchObject({ code: P5_CODES.UNSUPPORTED_HANDLE });
    // A pool whose connect() yields no usable client fails at the
    // transaction, and no statement ever runs on the pool facade.
    let poolQueryCalls = 0;
    const badPool = {
      totalCount: 1,
      idleCount: 1,
      waitingCount: 0,
      query: async () => {
        poolQueryCalls += 1;
        return { rows: [] };
      },
      connect: async () => ({ query: async () => ({ rows: [] }) }),
    };
    const badRepo = createRetrievalRepository(badPool);
    await expect(badRepo.captureEpisode(synth())).rejects.toMatchObject({
      code: P5_CODES.UNSUPPORTED_HANDLE,
    });
    expect(poolQueryCalls).toBe(0);
  });

  it30("TBP5-010: grants normalize as a set — duplicates and reordered duplicates share one id", async () => {
    expect(computeEpisodeId(synth({ grants: ["a"] }))).toBe(
      computeEpisodeId(synth({ grants: ["a", "a"] })),
    );
    expect(computeEpisodeId(synth({ grants: ["b", "a", "a"] }))).toBe(
      computeEpisodeId(synth({ grants: ["a", "b"] })),
    );
    expect(computeEpisodeId(synth({ grants: ["a", "b"] }))).not.toBe(
      computeEpisodeId(synth({ grants: ["a"] })),
    );
    const dup = await repo.captureEpisode(
      synth({ grants: ["b-principal", "a-principal", "a-principal"] }),
    );
    const exact = await repo.captureEpisode(synth({ grants: ["a-principal", "b-principal"] }));
    expect(exact.episodeId).toBe(dup.episodeId);
    expect(exact.replayed).toBe(true);
    const { rows } = await db.query(
      "SELECT principal FROM tb_episode_grants WHERE episode_id = $1 ORDER BY principal",
      [dup.episodeId],
    );
    expect(rows.map((r) => r.principal)).toEqual(["a-principal", "b-principal"]);
  });
});

describe("P5 fix round 3 — TBP5-011 omission/presence", () => {
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

  const synthSrc = {
    repo: "synthetic/engineering",
    path: "fixtures/decision.md",
    commit: "a".repeat(40),
    blob: "b".repeat(40),
    watermark: "synthetic@1",
  };
  const synth = (overrides = {}) => ({
    scope: "engineering",
    title: "Queue decision",
    body: "The synthetic queue rule orders tasks oldest first.",
    source: { ...synthSrc },
    capturedAt: "2026-10-14T16:00:00Z",
    ...overrides,
  });
  const FULL = {
    note: "approved",
    actor: "muse",
    operationId: "op-1",
    timestamp: "2026-10-31T00:00:00Z",
  };

  it30("TBP5-011: omitted optional bindings conflict on archiveEpisode replay", async () => {
    const captured = await repo.captureEpisode(synth());
    const first = await repo.archiveEpisode(captured.episodeId, FULL);
    // The round-2 gap: a weaker claim omitting a stored binding was
    // accepted as replay. Now omission is a difference, not a wildcard.
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "muse", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "muse", operationId: "op-1" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "approved", actor: "muse" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    // Failed replays changed nothing: same revision, one event, and
    // the exact replay still succeeds afterward.
    expect(await repo.latestRevision()).toBe(first.revision);
    const { rows } = await db.query(
      "SELECT COUNT(*) AS c FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(Number(rows[0].c)).toBe(1);
    const { rows: flagRows } = await db.query(
      "SELECT timestamp_claimed FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(flagRows[0].timestamp_claimed).toBe(true);
    const exact = await repo.archiveEpisode(captured.episodeId, FULL);
    expect(exact).toMatchObject({ episodeId: captured.episodeId, state: "ARCHIVED", revision: first.revision, replayed: true });
  });

  it30("TBP5-011: supplied-after-absent bindings conflict; exact without optionals replays", async () => {
    const captured = await repo.captureEpisode(synth());
    const first = await repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse" });
    // Stored with no optional bindings: a replay claiming one is a
    // different identity, not an enrichment of the same receipt.
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse", operationId: "op-9" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    expect(await repo.latestRevision()).toBe(first.revision);
    const { rows } = await db.query(
      "SELECT timestamp_claimed FROM tb_episode_events WHERE episode_id = $1",
      [captured.episodeId],
    );
    expect(rows[0].timestamp_claimed).toBe(false);
    const exact = await repo.archiveEpisode(captured.episodeId, { note: "n", actor: "muse" });
    expect(exact).toMatchObject({ episodeId: captured.episodeId, state: "ARCHIVED", revision: first.revision, replayed: true });
  });

  it30("TBP5-011: import path — omission/presence matrix through capture replay and archiveEpisode", async () => {
    const base = {
      title: "Imported archived",
      body: "An imported archived synthetic rule.",
      state: "ARCHIVED",
    };
    const imported = await repo.captureEpisode(
      synth({ ...base, archiveAudit: { note: "imported", actor: "muse", operationId: "import-1", timestamp: "2026-10-31T00:00:00Z" } }),
    );
    expect(imported.replayed).toBe(false);
    // Capture-level replay of the import: omitting a stored binding
    // conflicts on both paths, exact replays on both paths.
    await expect(
      repo.captureEpisode(
        synth({ ...base, archiveAudit: { note: "imported", actor: "muse", timestamp: "2026-10-31T00:00:00Z" } }),
      ),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.captureEpisode(
        synth({ ...base, archiveAudit: { note: "imported", actor: "muse", operationId: "import-1" } }),
      ),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(imported.episodeId, { note: "imported", actor: "muse", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    const again = await repo.captureEpisode(
      synth({ ...base, archiveAudit: { note: "imported", actor: "muse", operationId: "import-1", timestamp: "2026-10-31T00:00:00Z" } }),
    );
    expect(again).toMatchObject({ episodeId: imported.episodeId, replayed: true });
    const viaArchive = await repo.archiveEpisode(imported.episodeId, {
      note: "imported",
      actor: "muse",
      operationId: "import-1",
      timestamp: "2026-10-31T00:00:00Z",
    });
    expect(viaArchive).toMatchObject({ state: "ARCHIVED", revision: imported.revision, replayed: true });
    // Import without optionals: supplying one on replay conflicts.
    const bare = await repo.captureEpisode(
      synth({ title: "Bare import", body: "A bare imported archived rule.", state: "ARCHIVED", archiveAudit: { note: "bare", actor: "muse" } }),
    );
    await expect(
      repo.captureEpisode(
        synth({ title: "Bare import", body: "A bare imported archived rule.", state: "ARCHIVED", archiveAudit: { note: "bare", actor: "muse", operationId: "late-1" } }),
      ),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    await expect(
      repo.archiveEpisode(bare.episodeId, { note: "bare", actor: "muse", timestamp: "2026-10-31T00:00:00Z" }),
    ).rejects.toMatchObject({ code: P5_CODES.ARCHIVE_REPLAY_CONFLICT });
    const bareExact = await repo.captureEpisode(
      synth({ title: "Bare import", body: "A bare imported archived rule.", state: "ARCHIVED", archiveAudit: { note: "bare", actor: "muse" } }),
    );
    expect(bareExact).toMatchObject({ episodeId: bare.episodeId, replayed: true });
  });
});
