import { env, paths } from "../config/paths.js";
import {
  buildAuthorizeUrl,
  challengeFromVerifier,
  exchangeCodeForTokens,
  generateVerifier,
  randomState,
  type TokenResponse,
} from "./oauth.js";
import { saveTokens, toStored } from "./tokenStore.js";

type ExchangeFn = typeof exchangeCodeForTokens;

export interface AuthFlowOptions {
  /** Falls back to env at call time when omitted (so the shared instance picks up .env). */
  clientId?: string;
  redirectUri?: string;
  exchange?: ExchangeFn;
  tokenFile?: string;
}

/**
 * Drives the server-side PKCE handshake. The `code_verifier` is held in memory keyed by
 * `state` between the authorize redirect and the callback; the callback is rejected unless
 * its `state` matches a pending entry, which is the CSRF guard.
 */
export class AuthFlow {
  private readonly pending = new Map<string, string>();
  private readonly exchange: ExchangeFn;

  constructor(private readonly opts: AuthFlowOptions = {}) {
    this.exchange = opts.exchange ?? exchangeCodeForTokens;
  }

  private get clientId(): string | undefined {
    return this.opts.clientId ?? env.spotifyClientId;
  }
  private get redirectUri(): string {
    return this.opts.redirectUri ?? env.spotifyRedirectUri;
  }
  private get tokenFile(): string {
    return this.opts.tokenFile ?? paths.tokensFile;
  }

  /** Step 1: produce the Spotify consent URL and stash the verifier under its state. */
  begin(): { authorizeUrl: string } {
    if (!this.clientId) {
      throw new Error(
        "SPOTIFY_CLIENT_ID is not set — add it to your .env before connecting.",
      );
    }
    const verifier = generateVerifier();
    const state = randomState();
    this.pending.set(state, verifier);
    const authorizeUrl = buildAuthorizeUrl({
      clientId: this.clientId,
      redirectUri: this.redirectUri,
      state,
      codeChallenge: challengeFromVerifier(verifier),
    });
    return { authorizeUrl };
  }

  /** Step 2: validate state, exchange the code, and persist the tokens. */
  async complete(params: { code?: string; state?: string }): Promise<void> {
    const { code, state } = params;
    if (!state || !this.pending.has(state)) {
      throw new Error("Invalid or expired state — rejecting callback (possible CSRF).");
    }
    const verifier = this.pending.get(state)!;
    this.pending.delete(state);
    if (!code) throw new Error("Authorization callback was missing the code.");
    if (!this.clientId) throw new Error("SPOTIFY_CLIENT_ID is not set.");

    const resp: TokenResponse = await this.exchange({
      clientId: this.clientId,
      code,
      redirectUri: this.redirectUri,
      codeVerifier: verifier,
    });
    await saveTokens(toStored(resp), this.tokenFile);
  }

  /** Test/inspection helper. */
  pendingCount(): number {
    return this.pending.size;
  }
}

/** Shared instance the HTTP routes use; reads SPOTIFY_* from the environment at call time. */
export const authFlow = new AuthFlow();
