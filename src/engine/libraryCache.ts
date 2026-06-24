import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AggregateTrack, PlaylistMembership } from "../profile/aggregate.js";
import type { ClassifiableTrack } from "../classify/engine.js";

/** The library read the engine reuses across sort/profile/manage within a session. */
export interface LoadedLibrary {
  userId: string;
  classifiable: ClassifiableTrack[];
  aggregateTracks: AggregateTrack[];
  uriById: Map<string, string>;
  memberships: PlaylistMembership[];
  /** True when the playlist listing was unavailable (rate-limited) and we used Liked Songs only. */
  degraded: boolean;
}

interface StoredLibrary {
  userId: string;
  cachedAt: number;
  classifiable: ClassifiableTrack[];
  aggregateTracks: AggregateTrack[];
  uriEntries: [string, string][];
  memberships: PlaylistMembership[];
}

/**
 * File-backed cache of the whole library read. Reading a large library is the slow,
 * rate-limit-prone step, and sort/profile/manage all need the same data — so we read once
 * and reuse within a short window. Only COMPLETE (non-degraded) reads are cached, and any
 * playlist mutation clears it, so a stale or partial library is never reused.
 */
export class LibraryCache {
  constructor(
    private readonly file?: string,
    private readonly ttlMs: number = 15 * 60 * 1000,
  ) {}

  async get(userId: string, now: number = Date.now()): Promise<LoadedLibrary | null> {
    if (!this.file) return null;
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8")) as StoredLibrary;
      if (stored.userId !== userId) return null;
      if (now - stored.cachedAt > this.ttlMs) return null;
      return {
        userId: stored.userId,
        classifiable: stored.classifiable,
        aggregateTracks: stored.aggregateTracks,
        uriById: new Map(stored.uriEntries),
        memberships: stored.memberships,
        degraded: false,
      };
    } catch {
      return null;
    }
  }

  async set(library: LoadedLibrary, now: number = Date.now()): Promise<void> {
    if (!this.file || library.degraded) return; // never cache a partial/degraded read
    const stored: StoredLibrary = {
      userId: library.userId,
      cachedAt: now,
      classifiable: library.classifiable,
      aggregateTracks: library.aggregateTracks,
      uriEntries: [...library.uriById.entries()],
      memberships: library.memberships,
    };
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(stored));
  }

  /** Drop the cache after a mutation so the next read reflects the new playlist state. */
  async clear(): Promise<void> {
    if (!this.file) return;
    await rm(this.file, { force: true });
  }
}
