import { withBackup, type SnapshotReader } from "../backup/snapshot.js";

/** Explicit, owner-triggered playlist edits — every one is backup-guarded. */
export interface EditWriter {
  unfollow(playlistId: string): Promise<void>;
  updateDetails(
    playlistId: string,
    details: { name?: string; description?: string },
  ): Promise<void>;
  removeTracks(playlistId: string, uris: string[]): Promise<void>;
  replaceTracks(playlistId: string, uris: string[]): Promise<void>;
}

export interface EditContext {
  writer: EditWriter;
  backupReader: SnapshotReader;
  backupDir?: string;
  now?: number;
}

function guard(ctx: EditContext): Parameters<typeof withBackup>[0] {
  return { reader: ctx.backupReader, dir: ctx.backupDir, now: ctx.now };
}

/** Delete = unfollow. Guarded: no backup, no delete. */
export function deletePlaylist(playlistId: string, ctx: EditContext): Promise<void> {
  return withBackup(guard(ctx), () => ctx.writer.unfollow(playlistId));
}

export function renamePlaylist(
  playlistId: string,
  name: string,
  ctx: EditContext,
): Promise<void> {
  return withBackup(guard(ctx), () => ctx.writer.updateDetails(playlistId, { name }));
}

export function removeTracks(
  playlistId: string,
  uris: string[],
  ctx: EditContext,
): Promise<void> {
  return withBackup(guard(ctx), () => ctx.writer.removeTracks(playlistId, uris));
}

export function reorderTracks(
  playlistId: string,
  uris: string[],
  ctx: EditContext,
): Promise<void> {
  return withBackup(guard(ctx), () => ctx.writer.replaceTracks(playlistId, uris));
}
