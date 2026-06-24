import { getValidAccessToken } from "../auth/tokenStore.js";
import type { Page } from "./types.js";

export type FetchImpl = typeof fetch;

export interface SpotifyClientOptions {
  /** Returns a valid bearer token; defaults to the refreshing token store. */
  getToken?: () => Promise<string>;
  fetchImpl?: FetchImpl;
  baseUrl?: string;
  maxRetries?: number;
  /** Injectable for tests so backoff doesn't actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const API_BASE = "https://api.spotify.com/v1";

interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  absoluteUrl?: string;
}

/**
 * Minimal typed Spotify Web API client. Handles auth, pagination, and 429/5xx backoff.
 * A hand-rolled client (rather than the official SDK) keeps full control of rate-limit
 * handling and works cleanly with our server-managed PKCE tokens.
 */
export class SpotifyClient {
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: FetchImpl;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: SpotifyClientOptions = {}) {
    this.getToken = opts.getToken ?? (() => getValidAccessToken());
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? API_BASE;
    this.maxRetries = opts.maxRetries ?? 3;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = opts.absoluteUrl ?? this.buildUrl(path, opts.query);

    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      if (res.status === 429 && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "1");
        await this.sleep(Math.max(0, retryAfter) * 1000);
        continue;
      }
      if (res.status >= 500 && res.status < 600 && attempt < this.maxRetries) {
        await this.sleep(500 * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `Spotify ${method} ${path} failed (${res.status})${detail ? `: ${detail}` : ""}`,
        );
      }

      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
  }

  /** Follow a paging object's `next` cursors and collect every item. */
  async getAllPages<T>(
    path: string,
    query?: RequestOptions["query"],
  ): Promise<T[]> {
    const items: T[] = [];
    let page = await this.request<Page<T>>("GET", path, { query });
    items.push(...page.items);
    while (page.next) {
      page = await this.request<Page<T>>("GET", page.next, { absoluteUrl: page.next });
      items.push(...page.items);
    }
    return items;
  }
}

/**
 * True for "expected, skippable" Spotify errors: 403 (e.g. editorial/algorithmic playlists
 * third-party apps can't read) and 404 (unavailable). Real failures (network, 5xx) are NOT
 * skippable — callers should let those abort so a backup is never silently incomplete.
 */
export function isForbiddenOrNotFound(err: unknown): boolean {
  return err instanceof Error && /\((403|404)\)/.test(err.message);
}
