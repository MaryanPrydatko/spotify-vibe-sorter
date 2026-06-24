import { readFile } from "node:fs/promises";
import type { LibrarySnapshot } from "./snapshot.js";

/** The write surface restore needs — satisfied by SpotifyPlaylists, fakeable in tests. */
export interface RestoreWriter {
  create(
    userId: string,
    opts: { name: string; description?: string },
  ): Promise<{ id: string }>;
  addTracks(playlistId: string, uris: string[]): Promise<void>;
  replaceTracks(playlistId: string, uris: string[]): Promise<void>;
}

export async function loadSnapshot(path: string): Promise<LibrarySnapshot> {
  return JSON.parse(await readFile(path, "utf8")) as LibrarySnapshot;
}

export interface RestoreResult {
  replaced: number;
  recreated: number;
}

/**
 * Rebuild playlist membership from a snapshot.
 *
 * For playlists that still exist (id in `existingPlaylistIds`), tracks are *replaced* —
 * which makes restore idempotent (re-running yields the same membership, no duplicates).
 * For playlists that were deleted/unfollowed, a NEW playlist is created. Note the limit
 * surfaced in the plan: a recreated playlist gets a new Spotify id; the original identity
 * (followers, links) is not recoverable.
 */
export async function restoreSnapshot(
  snapshot: LibrarySnapshot,
  opts: {
    userId: string;
    writer: RestoreWriter;
    existingPlaylistIds?: Set<string>;
  },
): Promise<RestoreResult> {
  const existing = opts.existingPlaylistIds ?? new Set<string>();
  let replaced = 0;
  let recreated = 0;

  for (const p of snapshot.playlists) {
    if (existing.has(p.id)) {
      await opts.writer.replaceTracks(p.id, p.trackUris);
      replaced++;
    } else {
      const { id } = await opts.writer.create(opts.userId, {
        name: p.name,
        description: p.description,
      });
      await opts.writer.addTracks(id, p.trackUris);
      recreated++;
    }
  }
  return { replaced, recreated };
}
