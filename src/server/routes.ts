import { authFlow } from "../auth/connect.js";
import { isConnected } from "../auth/tokenStore.js";
import { sendError, sendHtml, sendJson } from "./http.js";
import type { Router } from "./router.js";

/**
 * Wires the JSON API onto the shared router. Later units extend this:
 * U6 the sort routes, U7 the profile route, U8 the buckets routes. Keeping registration
 * in one place makes the API surface easy to audit.
 */
export function registerApiRoutes(router: Router): void {
  router.get("/api/health", (_req, res) => {
    sendJson(res, 200, { ok: true, name: "spotify-vibe-sorter" });
  });

  router.get("/api/status", async (_req, res) => {
    sendJson(res, 200, { connected: await isConnected() });
  });

  // Step 1 of the Connect flow: hand the client the Spotify consent URL to navigate to.
  router.get("/api/connect", (_req, res) => {
    try {
      sendJson(res, 200, authFlow.begin());
    } catch (err) {
      sendError(res, 400, err instanceof Error ? err.message : "Cannot start connect");
    }
  });

  // Step 2: Spotify redirects the browser here with ?code&state. Top-level navigation,
  // so no Origin header — the same-origin guard does not apply.
  router.get("/callback", async (_req, res, url) => {
    const code = url.searchParams.get("code") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    const error = url.searchParams.get("error");
    try {
      if (error) throw new Error(`Spotify denied authorization: ${error}`);
      await authFlow.complete({ code, state });
      res.writeHead(302, { location: "/?connected=1" });
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authorization failed";
      sendHtml(
        res,
        400,
        `<!doctype html><meta charset="utf-8"><title>Connect failed</title>` +
          `<body style="font-family:sans-serif;background:#0f1014;color:#e8e9ed;padding:40px">` +
          `<h1>Couldn't connect</h1><p>${message}</p><p><a style="color:#1db954" href="/">Back</a></p>`,
      );
    }
  });
}
