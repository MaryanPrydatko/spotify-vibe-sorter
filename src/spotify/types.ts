/** Normalized domain models the rest of the app uses — insulated from Spotify's raw JSON. */

export interface ArtistRef {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: ArtistRef[];
  albumName: string;
  releaseDate?: string;
  popularity: number;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  snapshotId: string;
  trackCount: number;
}

/** A Spotify paging object (subset of fields we read). */
export interface Page<T> {
  items: T[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}
