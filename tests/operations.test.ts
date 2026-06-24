import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotReader } from "../src/backup/snapshot.js";
import type { ClassificationResult } from "../src/classify/engine.js";
import { deletePlaylist } from "../src/operations/edit.js";
import {
  IncompleteClassificationError,
  markerDescription,
  sortLibrary,
  type SortContext,
} from "../src/operations/sort.js";
import type { PlaylistSummary } from "../src/spotify/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "svs-ops-"));
});

const emptyReader: SnapshotReader = {
  listPlaylists: async () => [],
  listPlaylistTracks: async () => [],
  listLikedTracks: async () => [],
};

function complete(assign: Record<string, string>): ClassificationResult {
  const assignments = new Map(Object.entries(assign));
  return {
    assignments,
    total: assignments.size,
    classified: assignments.size,
    failed: 0,
    complete: true,
  };
}

function uris(...ids: string[]): Map<string, string> {
  return new Map(ids.map((id) => [id, `spotify:track:${id}`]));
}

function makeCtx(existing: PlaylistSummary[]): {
  ctx: SortContext;
  create: ReturnType<typeof vi.fn>;
  addTracks: ReturnType<typeof vi.fn>;
  unfollow: ReturnType<typeof vi.fn>;
} {
  let n = 0;
  const create = vi.fn(async () => ({ id: `new-${n++}` }));
  const addTracks = vi.fn(async () => {});
  const unfollow = vi.fn(async () => {});
  return {
    create,
    addTracks,
    unfollow,
    ctx: {
      userId: "u",
      writer: { create, addTracks, unfollow },
      listPlaylists: async () => existing,
      backupReader: emptyReader,
      backupDir: dir,
    },
  };
}

function summary(over: Partial<PlaylistSummary>): PlaylistSummary {
  return {
    id: "x",
    name: "x",
    description: "",
    ownerId: "u",
    snapshotId: "s",
    trackCount: 0,
    ...over,
  };
}

async function countBackups(): Promise<number> {
  return (await readdir(dir)).filter((f) => f.startsWith("backup-")).length;
}

describe("U6 sort", () => {
  it("creates a NEW playlist on a name collision, leaving the existing one untouched (AE4)", async () => {
    const existing = [summary({ id: "old", name: "Techno", description: "my old techno" })];
    const { ctx, create, unfollow } = makeCtx(existing);

    const result = await sortLibrary(complete({ t1: "techno" }), uris("t1"), ctx);

    expect(create).toHaveBeenCalledOnce();
    expect(unfollow).not.toHaveBeenCalled(); // existing playlist has no marker — never touched
    expect(result.created).toEqual([{ bucket: "techno", id: "new-0" }]);
  });

  it("creates one playlist per non-empty bucket and skips empty buckets", async () => {
    const { ctx, create } = makeCtx([]);
    const result = await sortLibrary(
      complete({ t1: "techno", t2: "techno", t3: "rock" }),
      uris("t1", "t2", "t3"),
      ctx,
    );
    expect(create).toHaveBeenCalledTimes(2); // techno + rock, nothing empty
    expect(result.created.map((c) => c.bucket).sort()).toEqual(["rock", "techno"]);
  });

  it("takes a backup before writing", async () => {
    const { ctx } = makeCtx([]);
    expect(await countBackups()).toBe(0);
    await sortLibrary(complete({ t1: "techno" }), uris("t1"), ctx);
    expect(await countBackups()).toBe(1);
  });

  it("supersedes prior tool playlists on re-run, even if renamed (marker match)", async () => {
    const priorMarked = summary({
      id: "mk",
      name: "Renamed By User",
      description: markerDescription("techno"),
    });
    const { ctx, create, unfollow } = makeCtx([priorMarked]);

    await sortLibrary(complete({ t1: "techno" }), uris("t1"), ctx);

    expect(unfollow).toHaveBeenCalledWith("mk"); // identified by marker, not name
    expect(create).toHaveBeenCalledOnce(); // fresh one created, no duplication
  });

  it("refuses to build playlists from an incomplete classification", async () => {
    const { ctx, create, unfollow } = makeCtx([]);
    const partial: ClassificationResult = {
      assignments: new Map([["t1", "techno"]]),
      total: 2,
      classified: 1,
      failed: 1,
      complete: false,
    };
    await expect(sortLibrary(partial, uris("t1"), ctx)).rejects.toBeInstanceOf(
      IncompleteClassificationError,
    );
    expect(create).not.toHaveBeenCalled();
    expect(unfollow).not.toHaveBeenCalled();
    expect(await countBackups()).toBe(0); // gated before backup, too
  });
});

describe("U6 edit/delete guard", () => {
  it("blocks a delete when no backup can be produced", async () => {
    const unfollow = vi.fn(async () => {});
    const failingReader: SnapshotReader = {
      listPlaylists: async () => {
        throw new Error("Spotify read failed");
      },
      listPlaylistTracks: async () => [],
      listLikedTracks: async () => [],
    };

    await expect(
      deletePlaylist("p1", {
        writer: {
          unfollow,
          updateDetails: async () => {},
          removeTracks: async () => {},
          replaceTracks: async () => {},
        },
        backupReader: failingReader,
        backupDir: dir,
      }),
    ).rejects.toThrow(/read failed/);
    expect(unfollow).not.toHaveBeenCalled();
  });
});
