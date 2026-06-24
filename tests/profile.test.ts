import { describe, expect, it } from "vitest";
import { UNSORTED } from "../src/classify/buckets.js";
import {
  computeAggregate,
  type AggregateInput,
  type AggregateTrack,
} from "../src/profile/aggregate.js";
import { analyzePersonality, type AnalysisProvider } from "../src/profile/analyze.js";

function track(id: string, over: Partial<AggregateTrack> = {}): AggregateTrack {
  return {
    id,
    name: `song-${id}`,
    artists: [{ id: `a-${id}`, name: `Artist ${id}` }],
    genres: ["pop"],
    popularity: 50,
    ...over,
  };
}

describe("U7 aggregate", () => {
  it("bucket percentages sum to ~100 and exclude unsorted", () => {
    const input: AggregateInput = {
      tracks: [track("t1"), track("t2"), track("t3"), track("t4")],
      assignments: new Map([
        ["t1", "rock"],
        ["t2", "rock"],
        ["t3", "techno"],
        ["t4", UNSORTED],
      ]),
      playlists: [],
    };
    const agg = computeAggregate(input);
    expect(agg.sortedTracks).toBe(3); // unsorted excluded
    const sum = agg.bucketDistribution.reduce((s, b) => s + b.pct, 0);
    expect(sum).toBeGreaterThan(99.4);
    expect(sum).toBeLessThan(100.6);
  });

  it("surfaces a planted cross-playlist pattern in the matrix", () => {
    const input: AggregateInput = {
      tracks: [track("t1"), track("t2"), track("t3")],
      assignments: new Map([
        ["t1", "sad songs"],
        ["t2", "sad songs"],
        ["t3", "techno"],
      ]),
      playlists: [
        { playlistId: "p1", playlistName: "Workout", trackIds: ["t1", "t2"] },
        { playlistId: "p2", playlistName: "Chill", trackIds: ["t3"] },
      ],
    };
    const agg = computeAggregate(input);
    const workout = agg.playlistBucketMatrix.find((r) => r.playlist === "Workout");
    expect(workout?.buckets).toEqual([{ label: "sad songs", count: 2 }]);
  });

  it("bounds the matrix to the top-N playlists", () => {
    const input: AggregateInput = {
      tracks: [track("t1"), track("t2")],
      assignments: new Map([
        ["t1", "rock"],
        ["t2", "rock"],
      ]),
      playlists: [
        { playlistId: "big", playlistName: "Big", trackIds: ["t1", "t2"] },
        { playlistId: "small", playlistName: "Small", trackIds: ["t1"] },
      ],
    };
    const agg = computeAggregate(input, { topPlaylists: 1 });
    expect(agg.playlistBucketMatrix).toHaveLength(1);
    expect(agg.playlistBucketMatrix[0]?.playlist).toBe("Big");
  });

  it("handles an empty library without throwing", () => {
    const agg = computeAggregate({ tracks: [], assignments: new Map(), playlists: [] });
    expect(agg.totalTracks).toBe(0);
    expect(agg.sortedTracks).toBe(0);
    expect(agg.avgPopularity).toBe(0);
    expect(agg.bucketDistribution).toEqual([]);
  });
});

describe("U7 analyze", () => {
  const provider: AnalysisProvider = {
    analyze: async (agg) => ({
      archetype: "Test Archetype",
      summary: "A test summary.",
      correlations: [`leans ${agg.bucketDistribution[0]?.bucket ?? "n/a"}`],
    }),
  };

  it("returns an archetype and at least one correlation grounded in the aggregate", async () => {
    const input: AggregateInput = {
      tracks: [track("t1"), track("t2")],
      assignments: new Map([
        ["t1", "techno"],
        ["t2", "techno"],
      ]),
      playlists: [{ playlistId: "p", playlistName: "Mix", trackIds: ["t1", "t2"] }],
    };
    const profile = await analyzePersonality(computeAggregate(input), { provider });
    expect(profile.archetype).toBe("Test Archetype");
    expect(profile.correlations[0]).toContain("techno");
  });
});
