import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassificationCache } from "../src/classify/cache.js";
import type { ClassifyBatchInput, LlmProvider } from "../src/classify/llm.js";
import { Engine, type LibraryReader } from "../src/engine/engine.js";
import type { AnalysisProvider } from "../src/profile/analyze.js";
import type { Track } from "../src/spotify/types.js";

let backupDir: string;
beforeEach(async () => {
  backupDir = await mkdtemp(join(tmpdir(), "svs-engine-"));
});

function track(id: string): Track {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `song-${id}`,
    artists: [{ id: `ar-${id}`, name: "Artist" }],
    albumName: "Album",
    releaseDate: "2020-05-01",
    popularity: 60,
  };
}

const fakeLibrary: LibraryReader = {
  currentUserId: async () => "user-1",
  listPlaylists: async () => [
    { id: "p1", name: "Mix", description: "", ownerId: "user-1", snapshotId: "s", trackCount: 2 },
  ],
  listPlaylistTracks: async () => [track("t1"), track("t2")],
  listLikedTracks: async () => [track("t3")],
};

const everythingRock: LlmProvider = {
  classifyBatch: async (input: ClassifyBatchInput) =>
    Object.fromEntries(input.tracks.map((t) => [t.id, "rock"])),
};

const fakeAnalysis: AnalysisProvider = {
  analyze: async (agg) => ({
    archetype: "Vibe Lord",
    summary: "You contain multitudes.",
    correlations: [`leans ${agg.bucketDistribution[0]?.bucket ?? "n/a"}`],
  }),
};

function makeEngine(writer: {
  create: ReturnType<typeof vi.fn>;
  addTracks: ReturnType<typeof vi.fn>;
  unfollow: ReturnType<typeof vi.fn>;
}): Engine {
  return new Engine({
    library: fakeLibrary,
    writer,
    classifyProvider: everythingRock,
    analysisProvider: fakeAnalysis,
    loadConfig: async () => ({ buckets: [{ name: "rock" }] }),
    isConnected: async () => true,
    classificationCache: new ClassificationCache(),
    backupDir,
  });
}

describe("U8 engine integration (mocked externals)", () => {
  it("sort: reads the whole library, classifies, and creates one vibe playlist", async () => {
    const create = vi.fn(
      async (_userId: string, _opts: { name: string; description?: string }) => ({
        id: "new-rock",
      }),
    );
    const addTracks = vi.fn(async (_playlistId: string, _uris: string[]) => {});
    const unfollow = vi.fn(async (_playlistId: string) => {});

    const result = await makeEngine({ create, addTracks, unfollow }).sort();

    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]?.[1]).toMatchObject({ name: "rock" });
    // t1 + t2 (from the playlist) + t3 (liked) all flow into the one bucket.
    expect(addTracks.mock.calls[0]?.[1]).toHaveLength(3);
    expect(result.created).toEqual([{ bucket: "rock", id: "new-rock" }]);
  });

  it("profile: aggregates the whole library and returns a personality", async () => {
    const engine = makeEngine({
      create: vi.fn(async () => ({ id: "x" })),
      addTracks: vi.fn(async () => {}),
      unfollow: vi.fn(async () => {}),
    });

    const { aggregate, profile, complete } = await engine.profile();

    expect(complete).toBe(true);
    expect(aggregate.sortedTracks).toBe(3);
    expect(profile.archetype).toBe("Vibe Lord");
    expect(profile.correlations[0]).toContain("rock");
  });

  it("reads only the user's own playlists and skips a 403 on one of them", async () => {
    const requested: string[] = [];
    const library: LibraryReader = {
      currentUserId: async () => "user-1",
      listPlaylists: async () => [
        { id: "p1", name: "Mine", description: "", ownerId: "user-1", snapshotId: "s", trackCount: 2 },
        // owned but unreadable (403) -> skipped defensively
        { id: "p2", name: "Mine too", description: "", ownerId: "user-1", snapshotId: "s", trackCount: 30 },
        // followed (not mine) -> filtered out before any read
        { id: "p3", name: "Someone else's", description: "", ownerId: "other", snapshotId: "s", trackCount: 99 },
        // empty -> filtered out
        { id: "p4", name: "Empty", description: "", ownerId: "user-1", snapshotId: "s", trackCount: 0 },
      ],
      listPlaylistTracks: async (id) => {
        requested.push(id);
        if (id === "p2") throw new Error("Spotify GET /playlists/p2/items failed (403): Forbidden");
        return [track("t1"), track("t2")];
      },
      listLikedTracks: async () => [],
    };
    const engine = new Engine({
      library,
      writer: { create: async () => ({ id: "x" }), addTracks: async () => {}, unfollow: async () => {} },
      classifyProvider: everythingRock,
      analysisProvider: fakeAnalysis,
      loadConfig: async () => ({ buckets: [{ name: "rock" }] }),
      isConnected: async () => true,
      classificationCache: new ClassificationCache(),
      backupDir,
    });

    const { aggregate, complete } = await engine.profile();
    expect(complete).toBe(true);
    expect(aggregate.sortedTracks).toBe(2); // only p1's tracks counted
    // p3 (not owned) and p4 (empty) are never even requested; p2 is requested but 403s.
    expect(requested.sort()).toEqual(["p1", "p2"]);
  });

  it("degrades to Liked Songs when the playlist listing is rate-limited", async () => {
    const library: LibraryReader = {
      currentUserId: async () => "user-1",
      listPlaylists: async () => {
        throw new Error("Spotify GET /me/playlists rate limited (429); retry after 82529s");
      },
      listPlaylistTracks: async () => {
        throw new Error("should not be called");
      },
      listLikedTracks: async () => [track("t1"), track("t2"), track("t3")],
    };
    const engine = new Engine({
      library,
      writer: { create: async () => ({ id: "x" }), addTracks: async () => {}, unfollow: async () => {} },
      classifyProvider: everythingRock,
      analysisProvider: fakeAnalysis,
      loadConfig: async () => ({ buckets: [{ name: "rock" }] }),
      isConnected: async () => true,
      classificationCache: new ClassificationCache(),
      backupDir,
    });

    const { aggregate, complete } = await engine.profile();
    expect(complete).toBe(true);
    expect(aggregate.sortedTracks).toBe(3); // the 3 liked songs still classified
  });
});
