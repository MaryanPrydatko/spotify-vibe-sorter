import { UNSORTED } from "../classify/buckets.js";
import type { ArtistRef } from "../spotify/types.js";

export interface AggregateTrack {
  id: string;
  name: string;
  artists: ArtistRef[];
  genres: string[];
  popularity: number;
  releaseDate?: string;
}

export interface PlaylistMembership {
  playlistId: string;
  playlistName: string;
  trackIds: string[];
}

export interface AggregateInput {
  tracks: AggregateTrack[];
  /** trackId -> bucket name. */
  assignments: Map<string, string>;
  playlists: PlaylistMembership[];
}

export interface Count {
  label: string;
  count: number;
}

export interface PlaylistBucketRow {
  playlist: string;
  buckets: Count[];
}

export interface LibraryAggregate {
  totalTracks: number;
  sortedTracks: number;
  bucketDistribution: { bucket: string; count: number; pct: number }[];
  topGenres: Count[];
  topArtists: Count[];
  /** Bounded per-playlist x per-bucket co-occurrence — what grounds cross-playlist correlations. */
  playlistBucketMatrix: PlaylistBucketRow[];
  avgPopularity: number;
  eraDistribution: Count[];
}

interface AggregateLimits {
  topPlaylists?: number;
  topGenres?: number;
  topArtists?: number;
}

function tally(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

function topN(m: Map<string, number>, n: number): Count[] {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function decadeOf(releaseDate?: string): string | null {
  const year = releaseDate ? Number.parseInt(releaseDate.slice(0, 4), 10) : NaN;
  if (!Number.isFinite(year)) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/**
 * Summarize the whole library into a compact, bounded structure suitable for one LLM prompt.
 * "unsorted" tracks are excluded from the personality breakdown so failed classifications
 * don't skew the archetype. The per-playlist x bucket matrix is the piece that lets the model
 * ground real cross-playlist correlations instead of inventing them.
 */
export function computeAggregate(
  input: AggregateInput,
  limits: AggregateLimits = {},
): LibraryAggregate {
  const { topPlaylists = 10, topGenres = 15, topArtists = 15 } = limits;
  const byId = new Map(input.tracks.map((t) => [t.id, t]));

  const sortedEntries = [...input.assignments.entries()].filter(
    ([, bucket]) => bucket !== UNSORTED,
  );
  const sortedTracks = sortedEntries.length;

  // Bucket distribution.
  const bucketCounts = tally(sortedEntries.map(([, bucket]) => bucket));
  const bucketDistribution = [...bucketCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket, count]) => ({
      bucket,
      count,
      pct: sortedTracks ? Math.round((count / sortedTracks) * 1000) / 10 : 0,
    }));

  // Genre / artist / popularity / era over sorted tracks.
  const genres: string[] = [];
  const artists: string[] = [];
  const decades: string[] = [];
  let popularitySum = 0;
  for (const [id] of sortedEntries) {
    const t = byId.get(id);
    if (!t) continue;
    genres.push(...t.genres);
    artists.push(...t.artists.map((a) => a.name));
    popularitySum += t.popularity;
    const d = decadeOf(t.releaseDate);
    if (d) decades.push(d);
  }

  // Per-playlist x bucket matrix for the top playlists by size.
  const matrix: PlaylistBucketRow[] = [...input.playlists]
    .sort((a, b) => b.trackIds.length - a.trackIds.length)
    .slice(0, topPlaylists)
    .map((p) => {
      const buckets = tally(
        p.trackIds
          .map((id) => input.assignments.get(id))
          .filter((b): b is string => !!b && b !== UNSORTED),
      );
      return {
        playlist: p.playlistName,
        buckets: [...buckets.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([label, count]) => ({ label, count })),
      };
    })
    .filter((row) => row.buckets.length > 0);

  return {
    totalTracks: input.tracks.length,
    sortedTracks,
    bucketDistribution,
    topGenres: topN(tally(genres), topGenres),
    topArtists: topN(tally(artists), topArtists),
    playlistBucketMatrix: matrix,
    avgPopularity: sortedTracks ? Math.round(popularitySum / sortedTracks) : 0,
    eraDistribution: topN(tally(decades), 10),
  };
}
