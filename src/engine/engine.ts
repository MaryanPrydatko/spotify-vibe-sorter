import type { SnapshotReader } from "../backup/snapshot.js";
import type { BucketConfig } from "../classify/buckets.js";
import type { ClassificationCache } from "../classify/cache.js";
import { classifyLibrary } from "../classify/engine.js";
import type { LlmProvider } from "../classify/llm.js";
import {
  computeAggregate,
  type AggregateTrack,
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
  sortLibrary,
  type SortContext,
  type SortResult,
  type SortWriter,
} from "../operations/sort.js";
import type { ClassifiableTrack } from "../classify/engine.js";
import { isForbiddenOrNotFound, isRateLimited } from "../spotify/client.js";
import type { PlaylistSummary, Track } from "../spotify/types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
import { endProgress, startProgress, updateProgress } from "./progress.js";

/** Read surface the engine needs from Spotify — satisfied by SpotifyLibrary. */
export interface LibraryReader extends SnapshotReader {
  currentUserId(): Promise<string>;
}

export type ProgressLog = (message: string) => void;

export interface EngineDeps {
  library: LibraryReader;
  writer: SortWriter;
  classifyProvider: LlmProvider;
  analysisProvider: AnalysisProvider;
  loadConfig: () => Promise<BucketConfig>;
  isConnected: () => Promise<boolean>;
  classificationCache?: ClassificationCache;
  analysisCache?: AnalysisCache;
  backupDir?: string;
}

interface LoadedLibrary {
  userId: string;
  classifiable: ClassifiableTrack[];
  aggregateTracks: AggregateTrack[];
  uriById: Map<string, string>;
  memberships: PlaylistMembership[];
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
  try {
    allPlaylists = await library.listPlaylists();
  } catch (err) {
    if (isRateLimited(err) || isForbiddenOrNotFound(err)) {
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
      const loaded = await loadLibrary(this.deps.library, this.log);
      const classification = await this.classify(loaded);
      updateProgress({ phase: "finishing", message: "Creating your vibe playlists…" });
      const ctx: SortContext = {
        userId: loaded.userId,
        writer: this.deps.writer,
        listPlaylists: () => this.deps.library.listPlaylists(),
        backupReader: this.deps.library,
        backupDir: this.deps.backupDir,
      };
      return await sortLibrary(classification, loaded.uriById, ctx);
    } finally {
      endProgress();
    }
  }

  /** Read → classify → aggregate → analyze the music personality. */
  async profile(): Promise<ProfileResult> {
    startProgress("reading", "Reading your library…");
    try {
      const loaded = await loadLibrary(this.deps.library, this.log);
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
}
