import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { env, paths } from "../config/paths.js";
import { refreshAccessToken, type TokenResponse } from "./oauth.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  scope: string;
  /** Absolute expiry as epoch milliseconds. */
  expiresAt: number;
}

/** Thrown by getValidAccessToken when no tokens are stored — the UI should prompt Connect. */
export class NotConnectedError extends Error {
  constructor() {
    super("Not connected to Spotify. Run the Connect flow first.");
    this.name = "NotConnectedError";
  }
}

/** Refresh a few seconds early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 30_000;

export function toStored(
  resp: TokenResponse,
  previousRefreshToken?: string,
  now: number = Date.now(),
): StoredTokens {
  const refreshToken = resp.refresh_token ?? previousRefreshToken;
  if (!refreshToken) {
    throw new Error("Token response had no refresh_token and none was cached.");
  }
  return {
    accessToken: resp.access_token,
    refreshToken,
    scope: resp.scope,
    expiresAt: now + resp.expires_in * 1000,
  };
}

export async function saveTokens(
  tokens: StoredTokens,
  file: string = paths.tokensFile,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  // writeFile's mode only applies on creation; enforce 0600 on existing files too so a
  // refresh-token grant on a shared machine never leaves the file world-readable.
  await chmod(file, 0o600);
}

export async function loadTokens(
  file: string = paths.tokensFile,
): Promise<StoredTokens | null> {
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export async function clearTokens(file: string = paths.tokensFile): Promise<void> {
  await rm(file, { force: true });
}

export async function isConnected(file: string = paths.tokensFile): Promise<boolean> {
  return (await loadTokens(file)) !== null;
}

export function isExpired(tokens: StoredTokens, now: number = Date.now()): boolean {
  return now >= tokens.expiresAt - EXPIRY_SKEW_MS;
}

/**
 * Return a usable access token, refreshing (and persisting) it first if expired.
 * `refresh` and `now` are injectable for tests. This is the seam U3 uses to construct
 * the Spotify SDK with an always-valid token.
 */
export async function getValidAccessToken(opts?: {
  clientId?: string;
  file?: string;
  now?: number;
  refresh?: typeof refreshAccessToken;
}): Promise<string> {
  const file = opts?.file ?? paths.tokensFile;
  const now = opts?.now ?? Date.now();
  const refresh = opts?.refresh ?? refreshAccessToken;
  const clientId = opts?.clientId ?? env.spotifyClientId;

  const tokens = await loadTokens(file);
  if (!tokens) throw new NotConnectedError();
  if (!isExpired(tokens, now)) return tokens.accessToken;

  if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is required to refresh the token.");
  const refreshed = await refresh({ clientId, refreshToken: tokens.refreshToken });
  const next = toStored(refreshed, tokens.refreshToken, now);
  await saveTokens(next, file);
  return next.accessToken;
}
