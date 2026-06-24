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
  fetchArtistGenres: async (ids) => new Map(ids.map((id) => [id, ["pop"]])),
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
});
