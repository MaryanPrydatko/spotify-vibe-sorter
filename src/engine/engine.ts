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
import { isForbiddenOrNotFound } from "../spotify/client.js";
import type { Track } from "../spotify/types.js";
import { mapWithConcurrency } from "../util/concurrency.js";

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
 * Read the entire library once and build everything the downstream stages need: the
 * classifiable tracks, the aggregate tracks, a uri lookup, and per-playlist membership
 * (including Liked Songs) for the correlation matrix.
 *
 * Playlist track lists are read in parallel (each is independent), and unreadable
 * editorial/algorithmic playlists are skipped. Genres are deliberately NOT fetched per
 * artist from Spotify — that endpoint is rate-limited to ~180/min (minutes of waiting on a
 * large library) and is itself deprecated. The model infers genre/vibe from name + artist
 * instead, which is what it's good at and removes thousands of slow calls.
 */
export async function loadLibrary(
  library: LibraryReader,
  log: ProgressLog = () => {},
): Promise<LoadedLibrary> {
  const playlists = await library.listPlaylists();
  log(`Reading tracks from ${playlists.length} playlists…`);

  const perPlaylist = await mapWithConcurrency(playlists, 6, async (p) => {
    try {
      return { p, tracks: await library.listPlaylistTracks(p.id) };
    } catch (err) {
      if (isForbiddenOrNotFound(err)) return null; // editorial/algorithmic — skip
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
    userId: await library.currentUserId(),
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

  private readonly log: ProgressLog = (m) => console.log(`[engine] ${m}`);

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
    });
    await this.deps.classificationCache?.save();
    return classification;
  }

  /** Read → classify → create vibe playlists (refuses on an incomplete classification). */
  async sort(): Promise<SortResult> {
    const loaded = await loadLibrary(this.deps.library, this.log);
    const classification = await this.classify(loaded);
    const ctx: SortContext = {
      userId: loaded.userId,
      writer: this.deps.writer,
      listPlaylists: () => this.deps.library.listPlaylists(),
      backupReader: this.deps.library,
      backupDir: this.deps.backupDir,
    };
    return sortLibrary(classification, loaded.uriById, ctx);
  }

  /** Read → classify → aggregate → analyze the music personality. */
  async profile(): Promise<ProfileResult> {
    const loaded = await loadLibrary(this.deps.library, this.log);
    const classification = await this.classify(loaded);
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
  }
}
