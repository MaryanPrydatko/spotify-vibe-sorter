import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "../config/paths.js";
import { isForbiddenOrNotFound } from "../spotify/client.js";
import type { PlaylistSummary, Track } from "../spotify/types.js";

export interface PlaylistSnapshot {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  trackUris: string[];
}

export interface LibrarySnapshot {
  createdAt: string;
  playlists: PlaylistSnapshot[];
  likedUris: string[];
}

/** The read surface backup needs — satisfied by SpotifyLibrary, fakeable in tests. */
export interface SnapshotReader {
  listPlaylists(): Promise<PlaylistSummary[]>;
  listPlaylistTracks(playlistId: string): Promise<Track[]>;
  listLikedTracks(): Promise<Track[]>;
}

/** Serialize the full library (playlist membership + liked songs) to a timestamped file. */
export async function takeSnapshot(
  reader: SnapshotReader,
  opts: { dir?: string; now?: number } = {},
): Promise<{ path: string; snapshot: LibrarySnapshot }> {
  const dir = opts.dir ?? paths.backupsDir;
  const now = opts.now ?? Date.now();

  const summaries = await reader.listPlaylists();
  const playlists: PlaylistSnapshot[] = [];
  for (const p of summaries) {
    let tracks: Track[];
    try {
      tracks = await reader.listPlaylistTracks(p.id);
    } catch (err) {
      // Skip playlists we're not allowed to read (editorial/algorithmic); abort on real errors
      // so a backup is never silently incomplete.
      if (isForbiddenOrNotFound(err)) continue;
      throw err;
    }
    playlists.push({
      id: p.id,
      name: p.name,
      description: p.description,
      ownerId: p.ownerId,
      trackUris: tracks.map((t) => t.uri),
    });
  }
  const liked = await reader.listLikedTracks();

  const snapshot: LibrarySnapshot = {
    createdAt: new Date(now).toISOString(),
    playlists,
    likedUris: liked.map((t) => t.uri),
  };

  await mkdir(dir, { recursive: true });
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `backup-${stamp}.json`);
  await writeFile(path, JSON.stringify(snapshot, null, 2));
  return { path, snapshot };
}

interface SnapshotInfo {
  path: string;
  mtimeMs: number;
}

export async function latestSnapshot(
  dir: string = paths.backupsDir,
): Promise<SnapshotInfo | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const backups = files.filter((f) => f.startsWith("backup-") && f.endsWith(".json"));
  let newest: SnapshotInfo | null = null;
  for (const f of backups) {
    const path = join(dir, f);
    const { mtimeMs } = await stat(path);
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path, mtimeMs };
  }
  return newest;
}

/**
 * The safety contract every destructive op depends on: guarantee a backup exists before a
 * mutation proceeds. Reuses a recent backup within `maxAgeMs`; otherwise takes a fresh one.
 * If the snapshot cannot be written this rejects — so the caller must abort the mutation.
 */
export async function ensureBackup(opts: {
  reader: SnapshotReader;
  dir?: string;
  maxAgeMs?: number;
  now?: number;
}): Promise<string> {
  const dir = opts.dir ?? paths.backupsDir;
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 10 * 60 * 1000; // reuse within a 10-minute session window

  const latest = await latestSnapshot(dir);
  if (latest && now - latest.mtimeMs <= maxAgeMs) return latest.path;

  const { path } = await takeSnapshot(opts.reader, { dir, now });
  return path;
}

/**
 * Run a destructive mutation only after a backup is guaranteed. If the backup cannot be
 * taken, the mutation never runs — this is the contract U6's delete/replace paths rely on.
 */
export async function withBackup<T>(
  ensureOpts: Parameters<typeof ensureBackup>[0],
  mutation: () => Promise<T>,
): Promise<T> {
  await ensureBackup(ensureOpts);
  return mutation();
}
