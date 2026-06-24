import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSnapshot, type RestoreWriter } from "../src/backup/restore.js";
import {
  ensureBackup,
  takeSnapshot,
  withBackup,
  type LibrarySnapshot,
  type SnapshotReader,
} from "../src/backup/snapshot.js";
import type { PlaylistSummary, Track } from "../src/spotify/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "svs-backup-"));
});

function track(id: string): Track {
  return { id, uri: `spotify:track:${id}`, name: id, artists: [], albumName: "", popularity: 0 };
}

function fakeReader(over: Partial<SnapshotReader> = {}): SnapshotReader {
  const playlists: PlaylistSummary[] = [
    { id: "p1", name: "Techno", description: "", ownerId: "u", snapshotId: "s", trackCount: 2 },
  ];
  return {
    listPlaylists: async () => playlists,
    listPlaylistTracks: async () => [track("a"), track("b")],
    listLikedTracks: async () => [track("c")],
    ...over,
  };
}

async function countBackups(d: string): Promise<number> {
  return (await readdir(d)).filter((f) => f.startsWith("backup-")).length;
}

describe("U4 snapshot", () => {
  it("captures every playlist with its track order plus liked songs", async () => {
    const { snapshot } = await takeSnapshot(fakeReader(), { dir, now: 1 });
    expect(snapshot.playlists[0]?.trackUris).toEqual([
      "spotify:track:a",
      "spotify:track:b",
    ]);
    expect(snapshot.likedUris).toEqual(["spotify:track:c"]);
  });
});

describe("U4 backup guard (AE3)", () => {
  it("takes a backup before the mutation when none exists, then runs the mutation", async () => {
    const mutation = vi.fn(async () => "deleted");
    expect(await countBackups(dir)).toBe(0);

    const result = await withBackup({ reader: fakeReader(), dir }, mutation);

    expect(await countBackups(dir)).toBe(1);
    expect(mutation).toHaveBeenCalledOnce();
    expect(result).toBe("deleted");
  });

  it("aborts the mutation if the backup cannot be produced", async () => {
    const mutation = vi.fn(async () => "deleted");
    const reader = fakeReader({
      listPlaylists: async () => {
        throw new Error("Spotify read failed");
      },
    });
    await expect(withBackup({ reader, dir }, mutation)).rejects.toThrow(/read failed/);
    expect(mutation).not.toHaveBeenCalled();
    expect(await countBackups(dir)).toBe(0);
  });

  it("reuses a recent backup instead of taking a new one", async () => {
    await takeSnapshot(fakeReader(), { dir, now: Date.now() });
    expect(await countBackups(dir)).toBe(1);

    await ensureBackup({ reader: fakeReader(), dir, maxAgeMs: 60_000 });
    expect(await countBackups(dir)).toBe(1); // no new file
  });
});

describe("U4 restore", () => {
  const snapshot: LibrarySnapshot = {
    createdAt: "now",
    playlists: [
      { id: "p1", name: "Techno", description: "", ownerId: "u", trackUris: ["spotify:track:a"] },
    ],
    likedUris: [],
  };

  function fakeWriter(): RestoreWriter & {
    replace: ReturnType<typeof vi.fn>;
    created: number;
  } {
    const replace = vi.fn(async () => {});
    let created = 0;
    return {
      replace,
      get created() {
        return created;
      },
      create: async () => ({ id: `new-${created++}` }),
      addTracks: async () => {},
      replaceTracks: replace,
    };
  }

  it("replaces tracks idempotently for a still-existing playlist", async () => {
    const writer = fakeWriter();
    const existing = new Set(["p1"]);

    await restoreSnapshot(snapshot, { userId: "u", writer, existingPlaylistIds: existing });
    await restoreSnapshot(snapshot, { userId: "u", writer, existingPlaylistIds: existing });

    expect(writer.replace).toHaveBeenCalledTimes(2);
    expect(writer.replace).toHaveBeenCalledWith("p1", ["spotify:track:a"]);
    expect(writer.created).toBe(0); // replaced, not recreated
  });

  it("recreates a deleted playlist as a new one", async () => {
    const writer = fakeWriter();
    const result = await restoreSnapshot(snapshot, { userId: "u", writer });
    expect(result.recreated).toBe(1);
    expect(writer.created).toBe(1);
  });
});
