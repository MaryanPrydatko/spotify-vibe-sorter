import { withBackup, type SnapshotReader } from "../backup/snapshot.js";
import { UNSORTED } from "../classify/buckets.js";
import type { ClassificationResult } from "../classify/engine.js";
import type { PlaylistSummary } from "../spotify/types.js";

/**
 * Stamped into the description of every playlist the tool creates, so re-runs can re-identify
 * their own output from *live Spotify* (not just local state) — surviving a wiped `.data/`
 * cache or a manual rename.
 */
export const MARKER = "[vibe-sorter]";

export function markerDescription(bucket: string): string {
  return `Auto-sorted by Spotify Vibe Sorter ${MARKER} bucket=${bucket}`;
}

export function isToolPlaylist(p: Pick<PlaylistSummary, "description">): boolean {
  return p.description.includes(MARKER);
}

export interface SortWriter {
  create(
    userId: string,
    opts: { name: string; description?: string },
  ): Promise<{ id: string }>;
  addTracks(playlistId: string, uris: string[]): Promise<void>;
  unfollow(playlistId: string): Promise<void>;
}

export interface SortContext {
  userId: string;
  writer: SortWriter;
  listPlaylists(): Promise<PlaylistSummary[]>;
  backupReader: SnapshotReader;
  backupDir?: string;
  now?: number;
}

export class IncompleteClassificationError extends Error {
  constructor(public readonly result: ClassificationResult) {
    super(
      `Classification is incomplete (${result.classified}/${result.total} classified, ` +
        `${result.failed} failed) — refusing to build playlists from a partial run.`,
    );
    this.name = "IncompleteClassificationError";
  }
}

export interface SortResult {
  created: { bucket: string; id: string }[];
  removedPrior: number;
}

function groupUrisByBucket(
  assignments: Map<string, string>,
  uriByTrackId: Map<string, string>,
): Map<string, string[]> {
  const byBucket = new Map<string, string[]>();
  for (const [trackId, bucket] of assignments) {
    if (bucket === UNSORTED) continue;
    const uri = uriByTrackId.get(trackId);
    if (!uri) continue;
    const list = byBucket.get(bucket) ?? [];
    list.push(uri);
    byBucket.set(bucket, list);
  }
  return byBucket;
}

/**
 * Build one new playlist per non-empty bucket from a *complete* classification.
 *
 * - Refuses to run on a partial classification (creates nothing).
 * - Takes a backup, then supersedes the tool's prior output (found by marker on live Spotify)
 *   via the backup-guarded unfollow before creating fresh playlists — so re-runs replace
 *   rather than duplicate, and the owner's non-tool playlists are never touched.
 */
export async function sortLibrary(
  classification: ClassificationResult,
  uriByTrackId: Map<string, string>,
  ctx: SortContext,
): Promise<SortResult> {
  if (!classification.complete) {
    throw new IncompleteClassificationError(classification);
  }

  const byBucket = groupUrisByBucket(classification.assignments, uriByTrackId);

  return withBackup(
    { reader: ctx.backupReader, dir: ctx.backupDir, now: ctx.now },
    async () => {
      const existing = await ctx.listPlaylists();
      const prior = existing.filter(isToolPlaylist);
      for (const p of prior) {
        await ctx.writer.unfollow(p.id);
      }

      const created: { bucket: string; id: string }[] = [];
      for (const [bucket, uris] of byBucket) {
        if (uris.length === 0) continue;
        const { id } = await ctx.writer.create(ctx.userId, {
          name: bucket,
          description: markerDescription(bucket),
        });
        await ctx.writer.addTracks(id, uris);
        created.push({ bucket, id });
      }
      return { created, removedPrior: prior.length };
    },
  );
}
