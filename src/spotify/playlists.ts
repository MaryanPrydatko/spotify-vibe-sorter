import type { SpotifyClient } from "./client.js";

const MAX_TRACKS_PER_REQUEST = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Write-side of the Spotify account: create, populate, edit, and unfollow playlists. */
export class SpotifyPlaylists {
  constructor(private readonly client: SpotifyClient) {}

  // Spotify migrated the playlist-mutation endpoints (the legacy `/users/{id}/playlists`
  // and `/playlists/{id}/tracks` routes now 403 for third-party apps). The current routes
  // are `POST /me/playlists` and the `/playlists/{id}/items` family. Removal also changed
  // body shape from `{ tracks: [{ uri }] }` to `{ items: [{ uri }] }`.
  async create(
    _userId: string,
    opts: { name: string; description?: string; isPublic?: boolean },
  ): Promise<{ id: string }> {
    return this.client.request<{ id: string }>("POST", `/me/playlists`, {
      body: {
        name: opts.name,
        description: opts.description ?? "",
        public: opts.isPublic ?? false,
      },
    });
  }

  /** Add track URIs in batches of 100 (Spotify's per-request limit). */
  async addTracks(playlistId: string, uris: string[]): Promise<void> {
    for (const batch of chunk(uris, MAX_TRACKS_PER_REQUEST)) {
      await this.client.request("POST", `/playlists/${playlistId}/items`, {
        body: { uris: batch },
      });
    }
  }

  async removeTracks(playlistId: string, uris: string[]): Promise<void> {
    for (const batch of chunk(uris, MAX_TRACKS_PER_REQUEST)) {
      await this.client.request("DELETE", `/playlists/${playlistId}/items`, {
        body: { items: batch.map((uri) => ({ uri })) },
      });
    }
  }

  /** Replace the playlist's contents (also used for reorder), batching past the first 100. */
  async replaceTracks(playlistId: string, uris: string[]): Promise<void> {
    const [first = [], ...rest] = chunk(uris, MAX_TRACKS_PER_REQUEST);
    await this.client.request("PUT", `/playlists/${playlistId}/items`, {
      body: { uris: first },
    });
    for (const batch of rest) {
      await this.addTracks(playlistId, batch);
    }
  }

  async updateDetails(
    playlistId: string,
    details: { name?: string; description?: string },
  ): Promise<void> {
    await this.client.request("PUT", `/playlists/${playlistId}`, { body: details });
  }

  /** "Delete" a playlist you own = unfollow it. */
  async unfollow(playlistId: string): Promise<void> {
    await this.client.request("DELETE", `/playlists/${playlistId}/followers`);
  }
}
