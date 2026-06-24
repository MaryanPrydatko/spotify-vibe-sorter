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

/** Read surface the engine needs from Spotify — satisfied by SpotifyLibrary. */
export interface LibraryReader extends SnapshotReader {
  currentUserId(): Promise<string>;
  fetchArtistGenres(artistIds: string[]): Promise<Map<string, string[]>>;
}

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
 * classifiable tracks (with genres merged from each track's artists), the aggregate tracks,
 * a uri lookup, and per-playlist membership (including Liked Songs) for the correlation matrix.
 */
export async function loadLibrary(library: LibraryReader): Promise<LoadedLibrary> {
  const playlists = await library.listPlaylists();
  const tracksById = new Map<string, Track>();
  const memberships: PlaylistMembership[] = [];

  for (const p of playlists) {
    let tracks: Track[];
    try {
      tracks = await library.listPlaylistTracks(p.id);
    } catch (err) {
      // Editorial/algorithmic playlists (Discover Weekly, Daily Mixes, etc.) return 403 to
      // third-party apps. They aren't the owner's to sort — skip and keep going.
      if (isForbiddenOrNotFound(err)) continue;
      throw err;
    }
    memberships.push({
      playlistId: p.id,
      playlistName: p.name,
      trackIds: tracks.map((t) => t.id),
    });
    for (const t of tracks) tracksById.set(t.id, t);
  }

  const liked = await library.listLikedTracks();
  for (const t of liked) tracksById.set(t.id, t);
  memberships.push({
    playlistId: "liked",
    playlistName: "Liked Songs",
    trackIds: liked.map((t) => t.id),
  });

  const artistIds = [
    ...new Set([...tracksById.values()].flatMap((t) => t.artists.map((a) => a.id))),
  ];
  const genresByArtist = await library.fetchArtistGenres(artistIds);
  const genresFor = (t: Track): string[] => [
    ...new Set(t.artists.flatMap((a) => genresByArtist.get(a.id) ?? [])),
  ];

  const all = [...tracksById.values()];
  return {
    userId: await library.currentUserId(),
    classifiable: all.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      genres: genresFor(t),
      popularity: t.popularity,
    })),
    aggregateTracks: all.map((t) => ({
      id: t.id,
      name: t.name,
      artists: t.artists,
      genres: genresFor(t),
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
    });
    await this.deps.classificationCache?.save();
    return classification;
  }

  /** Read → classify → create vibe playlists (refuses on an incomplete classification). */
  async sort(): Promise<SortResult> {
    const loaded = await loadLibrary(this.deps.library);
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
    const loaded = await loadLibrary(this.deps.library);
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
