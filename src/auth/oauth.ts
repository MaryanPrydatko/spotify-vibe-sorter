import { createHash, randomBytes } from "node:crypto";

/**
 * Spotify Authorization Code + PKCE primitives for a local public client.
 *
 * PKCE protects the code exchange (no client secret to leak). A separate random `state`
 * value, validated on the callback, closes the loopback CSRF vector PKCE alone does not —
 * without it any local process could deliver a code to our callback.
 */

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
] as const;

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function generateVerifier(): string {
  return base64url(randomBytes(48));
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function randomState(): string {
  return base64url(randomBytes(24));
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge_method: "S256",
    code_challenge: opts.codeChallenge,
    scope: (opts.scopes ?? SPOTIFY_SCOPES).join(" "),
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Spotify token request failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCodeForTokens(opts: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.clientId,
      code_verifier: opts.codeVerifier,
    }),
  );
}

export function refreshAccessToken(opts: {
  clientId: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
    }),
  );
}
