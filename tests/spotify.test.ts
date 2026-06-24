import { describe, expect, it, vi } from "vitest";
import { SpotifyClient } from "../src/spotify/client.js";
import { SpotifyLibrary } from "../src/spotify/library.js";
import { SpotifyPlaylists } from "../src/spotify/playlists.js";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientWith(
  fetchImpl: typeof fetch,
  sleep = vi.fn(async () => {}),
): SpotifyClient {
  return new SpotifyClient({
    getToken: async () => "tok",
    fetchImpl,
    sleep,
    maxRetries: 3,
  });
}

describe("U3 pagination", () => {
  it("follows next cursors and assembles all items", async () => {
    const nextUrl = "https://api.spotify.com/v1/me/tracks?offset=2";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === nextUrl) return json({ items: [3], next: null, total: 3 });
      return json({ items: [1, 2], next: nextUrl, total: 3 });
    }) as unknown as typeof fetch;

    const items = await clientWith(fetchImpl).getAllPages<number>("/me/tracks");
    expect(items).toEqual([1, 2, 3]);
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it("returns an empty array for an empty first page", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ items: [], next: null, total: 0 }),
    ) as unknown as typeof fetch;
    expect(await clientWith(fetchImpl).getAllPages("/me/tracks")).toEqual([]);
  });
});

describe("U3 rate-limit handling", () => {
  it("retries after a 429 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls === 1) return json({ error: "rate" }, 429, { "retry-after": "0" });
      return json({ id: "me-1" });
    }) as unknown as typeof fetch;
    const sleep = vi.fn(async () => {});

    const me = await clientWith(fetchImpl, sleep).request<{ id: string }>("GET", "/me");
    expect(me.id).toBe("me-1");
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("throws a descriptive error on a non-retryable failure", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "bad" }, 403),
    ) as unknown as typeof fetch;
    await expect(clientWith(fetchImpl).request("GET", "/me")).rejects.toThrow(/403/);
  });
});

describe("U3 library reads", () => {
  it("fetches genres once per unique artist", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const id = String(input).split("/artists/")[1]!;
      seen.push(id);
      return json({ id, name: id, genres: [`genre-${id}`] });
    }) as unknown as typeof fetch;

    const lib = new SpotifyLibrary(clientWith(fetchImpl));
    const genres = await lib.fetchArtistGenres(["a", "a", "b", "a"]);

    expect(seen.sort()).toEqual(["a", "b"]); // deduped
    expect(genres.get("a")).toEqual(["genre-a"]);
  });

  it("drops non-track / null items when normalizing playlist tracks", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        items: [
          { track: { id: "t1", uri: "spotify:track:t1", name: "Song", artists: [], album: { name: "A" } } },
          { track: null },
          { track: { id: "e1", type: "episode", uri: "u", name: "Pod", artists: [] } },
        ],
        next: null,
        total: 3,
      }),
    ) as unknown as typeof fetch;

    const tracks = await new SpotifyLibrary(clientWith(fetchImpl)).listPlaylistTracks("p1");
    expect(tracks.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("U3 playlist writes", () => {
  it("creates a playlist and returns its id", async () => {
    const fetchImpl = vi.fn(async () => json({ id: "new-pl" }, 201)) as unknown as typeof fetch;
    const pl = new SpotifyPlaylists(clientWith(fetchImpl));
    expect((await pl.create("user-1", { name: "Techno" })).id).toBe("new-pl");
  });

  it("batches track additions in groups of 100", async () => {
    const bodies: number[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as { uris: string[] };
      bodies.push(parsed.uris.length);
      return json({ snapshot_id: "s" });
    }) as unknown as typeof fetch;

    const uris = Array.from({ length: 150 }, (_, i) => `spotify:track:${i}`);
    await new SpotifyPlaylists(clientWith(fetchImpl)).addTracks("p1", uris);
    expect(bodies).toEqual([100, 50]);
  });
});
