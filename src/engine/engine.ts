import type { SnapshotReader } from "../backup/snapshot.js";
import type { BucketConfig } from "../classify/buckets.js";
import type { ClassificationCache } from "../classify/cache.js";
import { classifyLibrary } from "../classify/engine.js";
import type { LlmProvider } from "../classify/llm.js";
import {
  computeAggregate,
  type LibraryAggregate,
  type PlaylistMembership,
} from "../profile/aggregate.js";
import {
  analyzePersonality,
  type AnalysisCache,
  type AnalysisProvider,
  type PersonalityProfile,
} from "../profile/analyze.js";
import {
  isToolPlaylist,
  sortLibrary,
  type SortContext,
  type SortResult,
  type SortWriter,
} from "../operations/sort.js";
import {
  deletePlaylist,
  renamePlaylist,
  type EditContext,
  type EditWriter,
} from "../operations/edit.js";
import { latestSnapshot } from "../backup/snapshot.js";
import { loadSnapshot, restoreSnapshot, type RestoreWriter } from "../backup/restore.js";
import { isForbiddenOrNotFound, isRateLimited } from "../spotify/client.js";
import type { PlaylistSummary, Track } from "../spotify/types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { endProgress, startProgress, updateProgress } from "./progress.js";
import { LibraryCache, type LoadedLibrary } from "./libraryCache.js";

/** Read surface the engine needs from Spotify — satisfied by SpotifyLibrary. */
export interface LibraryReader extends SnapshotReader {
  currentUserId(): Promise<string>;
}

export type ProgressLog = (message: string) => void;

/** Owner-triggered playlist edits + snapshot restore. Satisfied by SpotifyPlaylists. */
export type ManageWriter = EditWriter & RestoreWriter;

export interface EngineDeps {
  library: LibraryReader;
  writer: SortWriter;
  classifyProvider: LlmProvider;
  analysisProvider: AnalysisProvider;
  loadConfig: () => Promise<BucketConfig>;
  isConnected: () => Promise<boolean>;
  /** Write surface for the manage/restore endpoints (delete, rename, restore). */
  manageWriter?: ManageWriter;
  classificationCache?: ClassificationCache;
  analysisCache?: AnalysisCache;
  libraryCache?: LibraryCache;
  backupDir?: string;
}

export interface PlaylistInfo {
  id: string;
  name: string;
  trackCount: number;
  /** True if this playlist was created by the sorter (carries the marker). */
  isTool: boolean;
}

/**
 * Read the user's own library once and build everything the downstream stages need: the
 * classifiable tracks, the aggregate tracks, a uri lookup, and per-playlist membership
 * (including Liked Songs) for the correlation matrix.
 *
 * Only the user's OWN playlists (plus Liked Songs) are read — followed playlists are other
 * people's curation, irrelevant to "your music personality", mostly unreadable for
 * third-party apps anyway, and some are enormous (one huge followed playlist would stall
 * reading for minutes). Empty playlists are skipped too. Track lists are read in parallel;
 * an owned playlist that still errors (403/404) is skipped defensively. Genres are
 * deliberately NOT fetched per artist from Spotify — that endpoint is rate-limited and
 * deprecated; the model infers genre/vibe from name + artist instead.
 */
export async function loadLibrary(
  library: LibraryReader,
  log: ProgressLog = () => {},
): Promise<LoadedLibrary> {
  const userId = await library.currentUserId();
  // If the playlist listing is unavailable (e.g. Spotify rate-limits /me/playlists after
  // heavy use), don't fail or hang — degrade to Liked Songs so the user still gets a result.
  let allPlaylists: PlaylistSummary[] = [];
  let degraded = false;
  try {
    allPlaylists = await library.listPlaylists();
  } catch (err) {
    if (isRateLimited(err) || isForbiddenOrNotFound(err)) {
      degraded = true;
      log("Couldn't read your playlists right now (Spotify rate limit) — using Liked Songs only.");
    } else {
      throw err;
    }
  }
  const mine = allPlaylists.filter((p) => p.ownerId === userId && p.trackCount > 0);
  if (mine.length) {
    log(
      `Reading ${mine.length} of your playlists` +
        ` (skipping ${allPlaylists.length - mine.length} followed/empty)…`,
    );
  }

  const perPlaylist = await mapWithConcurrency(mine, 6, async (p) => {
    try {
      return { p, tracks: await library.listPlaylistTracks(p.id) };
    } catch (err) {
      if (isForbiddenOrNotFound(err)) return null; // unreadable — skip defensively
      throw err;
    }
  });

  const tracksById = new Map<string, Track>();
  const memberships: PlaylistMembership[] = [];
  for (const entry of perPlaylist) {
    if (!entry) continue;
    memberships.push({
      playlistId: entry.p.id,
      playlistName: entry.p.name,
      trackIds: entry.tracks.map((t) => t.id),
    });
    for (const t of entry.tracks) tracksById.set(t.id, t);
  }

  const liked = await library.listLikedTracks();
  for (const t of liked) tracksById.set(t.id, t);
  memberships.push({
    playlistId: "liked",
    playlistName: "Liked Songs",
    trackIds: liked.map((t) => t.id),
  });

  const all = [...tracksById.values()];
  log(`Loaded ${all.length} unique tracks across ${memberships.length} playlists.`);

  return {
    userId,
    classifiable: all.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      genres: [],
      popularity: t.popularity,
    })),
    aggregateTracks: all.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      genres: [],
      popularity: t.popularity,
      releaseDate: t.releaseDate,
    })),
    uriById: new Map(all.map((t) => [t.id, t.uri])),
    memberships,
    degraded,
  };
}

export interface ProfileResult {
  aggregate: LibraryAggregate;
  profile: PersonalityProfile;
  complete: boolean;
}

/** Top-level orchestration the HTTP API calls. */
export class Engine {
  constructor(private readonly deps: EngineDeps) {}

  // Log to the server console and mirror the line into the progress store so the
  // browser (polling /api/progress) shows the same phase messages live.
  private readonly log: ProgressLog = (m) => {
    console.log(`[engine] ${m}`);
    updateProgress({ message: m });
  };

  status(): Promise<boolean> {
    return this.deps.isConnected();
  }

  /**
   * Load the library, reusing a fresh cached read when available. The expensive,
   * rate-limit-prone playlist read then happens once and is shared by sort/profile;
   * a complete read is cached, and mutations clear it via `invalidateLibrary`.
   */
  private async loadLibraryCached(): Promise<LoadedLibrary> {
    const cache = this.deps.libraryCache;
    if (cache) {
      const userId = await this.deps.library.currentUserId();
      const hit = await cache.get(userId);
      if (hit) {
        this.log(`Reusing your library from cache (${hit.classifiable.length} tracks).`);
        return hit;
      }
    }
    const loaded = await loadLibrary(this.deps.library, this.log);
    await cache?.set(loaded);
    return loaded;
  }

  /** Drop the cached library read after any playlist mutation. */
  private async invalidateLibrary(): Promise<void> {
    await this.deps.libraryCache?.clear();
  }

  private async classify(loaded: LoadedLibrary) {
    await this.deps.classificationCache?.load();
    const config = await this.deps.loadConfig();
    const classification = await classifyLibrary(loaded.classifiable, {
      provider: this.deps.classifyProvider,
      config,
      cache: this.deps.classificationCache,
      log: this.log,
      onProgress: (done, total) =>
        updateProgress({ phase: "classifying", done, total }),
    });
    await this.deps.classificationCache?.save();
    return classification;
  }

  /** Read → classify → create vibe playlists (refuses on an incomplete classification). */
  async sort(): Promise<SortResult> {
    startProgress("reading", "Reading your library…");
    try {
      const loaded = await this.loadLibraryCached();
      const classification = await this.classify(loaded);
      updateProgress({ phase: "finishing", message: "Creating your vibe playlists…" });
      const ctx: SortContext = {
        userId: loaded.userId,
        writer: this.deps.writer,
        listPlaylists: () => this.deps.library.listPlaylists(),
        backupReader: this.deps.library,
        backupDir: this.deps.backupDir,
      };
      const result = await sortLibrary(classification, loaded.uriById, ctx);
      await this.invalidateLibrary(); // playlists changed — next read must be fresh
      return result;
    } finally {
      endProgress();
    }
  }

  /** Read → classify → aggregate → analyze the music personality. */
  async profile(): Promise<ProfileResult> {
    startProgress("reading", "Reading your library…");
    try {
      const loaded = await this.loadLibraryCached();
      const classification = await this.classify(loaded);
      updateProgress({ phase: "finishing", message: "Finding your correlations…" });
      const aggregate = computeAggregate({
        tracks: loaded.aggregateTracks,
        assignments: classification.assignments,
        playlists: loaded.memberships,
      });
      const profile = await analyzePersonality(aggregate, {
        provider: this.deps.analysisProvider,
        cache: this.deps.analysisCache,
      });
      return { aggregate, profile, complete: classification.complete };
    } finally {
      endProgress();
    }
  }

  // --- Playlist management (owner-triggered, backup-guarded) ---

  private manageWriter(): ManageWriter {
    const w = this.deps.manageWriter;
    if (!w) throw new Error("Playlist management is not configured.");
    return w;
  }

  private editContext(): EditContext {
    return {
      writer: this.manageWriter(),
      backupReader: this.deps.library,
      backupDir: this.deps.backupDir,
    };
  }

  /** List the user's OWN playlists, tagging the ones this tool created. */
  async listMyPlaylists(): Promise<PlaylistInfo[]> {
    const userId = await this.deps.library.currentUserId();
    const all = await this.deps.library.listPlaylists();
    return all
      .filter((p) => p.ownerId === userId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        trackCount: p.trackCount,
        isTool: isToolPlaylist(p),
      }));
  }

  /** Resolve a playlist the user owns by id, or throw — guards every mutation below. */
  private async requireOwned(id: string): Promise<PlaylistSummary> {
    const userId = await this.deps.library.currentUserId();
    const all = await this.deps.library.listPlaylists();
    const target = all.find((p) => p.id === id);
    if (!target) throw new Error("Playlist not found.");
    if (target.ownerId !== userId) throw new Error("You can only manage playlists you own.");
    return target;
  }

  /** Delete (unfollow) one of the user's own playlists, after a guaranteed backup. */
  async deleteMyPlaylist(id: string): Promise<void> {
    await this.requireOwned(id);
    await deletePlaylist(id, this.editContext());
    await this.invalidateLibrary();
  }

  /** Rename one of the user's own playlists, after a guaranteed backup. */
  async renameMyPlaylist(id: string, name: string): Promise<void> {
    const clean = name.trim();
    if (!clean) throw new Error("New name cannot be empty.");
    await this.requireOwned(id);
    await renamePlaylist(id, clean, this.editContext());
    await this.invalidateLibrary();
  }

  /** Restore the most recent backup — rebuilds playlist membership and re-creates deleted ones. */
  async restoreLatestBackup(): Promise<{ replaced: number; recreated: number }> {
    const latest = await latestSnapshot(this.deps.backupDir);
    if (!latest) throw new Error("No backup found to restore from.");
    const snapshot = await loadSnapshot(latest.path);
    const userId = await this.deps.library.currentUserId();
    const existingIds = new Set((await this.deps.library.listPlaylists()).map((p) => p.id));
    const result = await restoreSnapshot(snapshot, {
      userId,
      writer: this.manageWriter(),
      existingPlaylistIds: existingIds,
    });
    await this.invalidateLibrary();
    return result;
  }
}
