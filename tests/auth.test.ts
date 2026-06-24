import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthFlow } from "../src/auth/connect.js";
import { challengeFromVerifier, type TokenResponse } from "../src/auth/oauth.js";
import {
  getValidAccessToken,
  loadTokens,
  saveTokens,
  toStored,
} from "../src/auth/tokenStore.js";

let tokenFile: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), "svs-auth-"));
  tokenFile = join(dir, "tokens.json");
});

function fakeTokenResponse(over: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: "access-1",
    token_type: "Bearer",
    scope: "user-library-read",
    expires_in: 3600,
    refresh_token: "refresh-1",
    ...over,
  };
}

describe("U2 PKCE primitives", () => {
  it("derives a stable base64url challenge from a verifier", () => {
    const challenge = challengeFromVerifier("verifier-abc");
    expect(challenge).toBe(challengeFromVerifier("verifier-abc"));
    expect(challenge).not.toMatch(/[+/=]/); // base64url, not base64
  });
});

describe("U2 AuthFlow CSRF state guard", () => {
  it("completes when the callback state matches and stores tokens", async () => {
    const exchange = vi.fn(async () => fakeTokenResponse());
    const flow = new AuthFlow({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:4477/callback",
      exchange,
      tokenFile,
    });
    const { authorizeUrl } = flow.begin();
    const state = new URL(authorizeUrl).searchParams.get("state")!;

    await flow.complete({ code: "the-code", state });

    expect(exchange).toHaveBeenCalledOnce();
    const stored = await loadTokens(tokenFile);
    expect(stored?.accessToken).toBe("access-1");
    expect(flow.pendingCount()).toBe(0);
  });

  it("rejects a callback whose state does not match (CSRF)", async () => {
    const exchange = vi.fn(async () => fakeTokenResponse());
    const flow = new AuthFlow({
      clientId: "cid",
      redirectUri: "http://127.0.0.1:4477/callback",
      exchange,
      tokenFile,
    });
    flow.begin();
    await expect(flow.complete({ code: "c", state: "not-the-state" })).rejects.toThrow(
      /state/i,
    );
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe("U2 token store", () => {
  it("writes the token file with 0600 permissions", async () => {
    await saveTokens(toStored(fakeTokenResponse()), tokenFile);
    const mode = (await stat(tokenFile)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("round-trips tokens and returns null on a corrupt store", async () => {
    await saveTokens(toStored(fakeTokenResponse()), tokenFile);
    expect((await loadTokens(tokenFile))?.refreshToken).toBe("refresh-1");

    const { writeFile } = await import("node:fs/promises");
    await writeFile(tokenFile, "{ not json");
    expect(await loadTokens(tokenFile)).toBeNull();
  });

  it("refreshes and persists an expired access token", async () => {
    const now = 1_000_000;
    // Store a token that is already expired relative to `now`.
    await saveTokens(
      toStored(fakeTokenResponse({ expires_in: -10 }), undefined, now),
      tokenFile,
    );
    const refresh = vi.fn(async () =>
      fakeTokenResponse({ access_token: "access-2", refresh_token: undefined }),
    );

    const token = await getValidAccessToken({
      clientId: "cid",
      file: tokenFile,
      now,
      refresh,
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(token).toBe("access-2");
    const stored = await loadTokens(tokenFile);
    expect(stored?.accessToken).toBe("access-2");
    expect(stored?.refreshToken).toBe("refresh-1"); // carried over when refresh omits it
  });

  it("throws NotConnectedError when no tokens are stored", async () => {
    await expect(
      getValidAccessToken({ clientId: "cid", file: tokenFile }),
    ).rejects.toThrow(/not connected/i);
  });
});
