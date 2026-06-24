import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LibraryCache, type LoadedLibrary } from "../src/engine/libraryCache.js";

let file: string;
beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "svs-libcache-"));
  file = join(dir, "library-cache.json");
});

function lib(overrides: Partial<LoadedLibrary> = {}): LoadedLibrary {
  return {
    userId: "user-1",
    classifiable: [{ id: "t1", name: "Song", artists: [{ id: "a", name: "A" }], genres: [], popularity: 50 }],
    aggregateTracks: [
      { id: "t1", name: "Song", artists: [{ id: "a", name: "A" }], genres: [], popularity: 50, releaseDate: "2020" },
    ],
    uriById: new Map([["t1", "spotify:track:t1"]]),
    memberships: [{ playlistId: "liked", playlistName: "Liked Songs", trackIds: ["t1"] }],
    degraded: false,
    ...overrides,
  };
}

describe("LibraryCache", () => {
  it("round-trips a complete library (Map preserved) within TTL", async () => {
    const cache = new LibraryCache(file, 60_000);
    await cache.set(lib(), 1_000);
    const hit = await cache.get("user-1", 5_000);
    expect(hit).not.toBeNull();
    expect(hit?.uriById.get("t1")).toBe("spotify:track:t1");
    expect(hit?.classifiable).toHaveLength(1);
  });

  it("never caches a degraded (partial) read", async () => {
    const cache = new LibraryCache(file, 60_000);
    await cache.set(lib({ degraded: true }), 1_000);
    expect(await cache.get("user-1", 2_000)).toBeNull();
  });

  it("misses once the TTL has elapsed", async () => {
    const cache = new LibraryCache(file, 60_000);
    await cache.set(lib(), 1_000);
    expect(await cache.get("user-1", 1_000 + 60_001)).toBeNull();
  });

  it("misses for a different user", async () => {
    const cache = new LibraryCache(file, 60_000);
    await cache.set(lib(), 1_000);
    expect(await cache.get("someone-else", 2_000)).toBeNull();
  });

  it("clear() drops the cache", async () => {
    const cache = new LibraryCache(file, 60_000);
    await cache.set(lib(), 1_000);
    await cache.clear();
    expect(await cache.get("user-1", 2_000)).toBeNull();
  });

  it("is a no-op without a file path", async () => {
    const cache = new LibraryCache(undefined);
    await cache.set(lib(), 1_000);
    expect(await cache.get("user-1", 2_000)).toBeNull();
  });
});
