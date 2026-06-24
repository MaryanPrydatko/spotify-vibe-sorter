import type { SpotifyClient } from "./client.js";
import type { PlaylistSummary, Track } from "./types.js";

interface RawArtist {
  id: string;
  name: string;
  genres?: string[];
}
interface RawTrack {
  id: string | null;
  uri: string;
  name: string;
  type?: string;
  popularity?: number;
  artists: RawArtist[];
  album?: { name?: string; release_date?: string };
}
interface RawPlaylist {
  id: string;
  name: string | null;
  description: string | null;
  owner?: { id: string };
  snapshot_id?: string;
  // Spotify renamed the playlist track-paging field from `tracks` to `items`
  // (to cover episodes/audiobooks). Read both so older shapes still work.
  items?: { total: number };
  tracks?: { total: number };
}

/** A playlist item entry. Spotify renamed the track field from `track` to `item`. */
interface RawPlaylistItem {
  item?: RawTrack | null;
  track?: RawTrack | null;
}

function normalizeTrack(raw: RawTrack | null): Track | null {
  if (!raw || !raw.id || (raw.type && raw.type !== "track")) return null;
  return {
    id: raw.id,
    uri: raw.uri,
    name: raw.name,
    artists: raw.artists.map((a) => ({ id: a.id, name: a.name })),
    albumName: raw.album?.name ?? "",
    releaseDate: raw.album?.release_date,
    popularity: raw.popularity ?? 0,
  };
}

/** Read-side of the Spotify account: playlists, liked songs, and artist genres. */
export class SpotifyLibrary {
  constructor(private readonly client: SpotifyClient) {}

  async currentUserId(): Promise<string> {
    const me = await this.client.request<{ id: string }>("GET", "/me");
    return me.id;
  }

  async listPlaylists(): Promise<PlaylistSummary[]> {
    const raw = await this.client.getAllPages<RawPlaylist | null>("/me/playlists", {
      limit: 50,
    });
    // Spotify can return null entries (and reduced shapes for some followed playlists),
    // so read every field defensively.
    return raw
      .filter((p): p is RawPlaylist => !!p && !!p.id)
      .map((p) => ({
        id: p.id,
        name: p.name ?? "Untitled",
        description: p.description ?? "",
        ownerId: p.owner?.id ?? "",
        snapshotId: p.snapshot_id ?? "",
        trackCount: p.items?.total ?? p.tracks?.total ?? 0,
      }));
  }

  async listPlaylistTracks(playlistId: string): Promise<Track[]> {
    // Read via `/playlists/{id}/items` — Spotify now 403s the legacy `/tracks`
    // sub-endpoint for third-party apps, while `/items` returns the same data.
    const raw = await this.client.getAllPages<RawPlaylistItem | null>(
      `/playlists/${playlistId}/items`,
      { limit: 100 },
    );
    return raw
      .map((i) => normalizeTrack(i?.item ?? i?.track ?? null))
      .filter((t): t is Track => t !== null);
  }

  async listLikedTracks(): Promise<Track[]> {
    const raw = await this.client.getAllPages<{ track: RawTrack | null } | null>(
      "/me/tracks",
      { limit: 50 },
    );
    return raw
      .map((i) => normalizeTrack(i?.track ?? null))
      .filter((t): t is Track => t !== null);
  }

  /**
   * Fetch genres for a set of artists. Spotify removed bulk multi-get (Feb 2026), so this
   * loops single-artist fetches — but it dedupes first, since a library has far fewer unique
   * artists than tracks. Artists whose genres come back empty (the field is flagged
   * deprecated) simply yield `[]`; classification still works from name + artist downstream.
   */
  async fetchArtistGenres(artistIds: string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(artistIds)];
    const genres = new Map<string, string[]>();
    for (const id of unique) {
      const artist = await this.client.request<RawArtist>("GET", `/artists/${id}`);
      genres.set(id, artist.genres ?? []);
    }
    return genres;
  }
}
