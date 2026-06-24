import { authFlow } from "../auth/connect.js";
import { isConnected, NotConnectedError } from "../auth/tokenStore.js";
import {
  loadBucketConfig,
  saveBucketConfig,
  type BucketConfig,
} from "../classify/buckets.js";
import { getEngine } from "../engine/factory.js";
import { getProgress } from "../engine/progress.js";
import { IncompleteClassificationError } from "../operations/sort.js";
import { readJsonBody, sendError, sendHtml, sendJson } from "./http.js";
import type { Router } from "./router.js";

/** Map engine/auth errors to the right HTTP status. */
function sendEngineError(res: import("node:http").ServerResponse, err: unknown): void {
  if (err instanceof NotConnectedError) {
    sendError(res, 401, err.message);
  } else if (err instanceof IncompleteClassificationError) {
    sendError(res, 409, err.message, { result: { ...err.result, assignments: undefined } });
  } else {
    sendError(res, 500, err instanceof Error ? err.message : "Engine error");
  }
}

export function registerApiRoutes(router: Router): void {
  router.get("/api/health", (_req, res) => {
    sendJson(res, 200, { ok: true, name: "spotify-vibe-sorter" });
  });

  router.get("/api/status", async (_req, res) => {
    sendJson(res, 200, { connected: await isConnected() });
  });

  // Live progress for the in-flight sort/profile job; the browser polls this.
  router.get("/api/progress", (_req, res) => {
    sendJson(res, 200, getProgress());
  });

  // --- Connect (U2) ---
  router.get("/api/connect", (_req, res) => {
    try {
      sendJson(res, 200, authFlow.begin());
    } catch (err) {
      sendError(res, 400, err instanceof Error ? err.message : "Cannot start connect");
    }
  });

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

  // --- Buckets (U5/U8) ---
  router.get("/api/buckets", async (_req, res) => {
    sendJson(res, 200, await loadBucketConfig());
  });

  router.put("/api/buckets", async (req, res) => {
    const body = await readJsonBody<BucketConfig>(req);
    if (!body || !Array.isArray(body.buckets)) {
      sendError(res, 400, "Expected { buckets: [...] }");
      return;
    }
    await saveBucketConfig(body);
    sendJson(res, 200, body);
  });

  // --- Sort (U6) ---
  router.post("/api/sort", async (_req, res) => {
    try {
      sendJson(res, 200, await getEngine().sort());
    } catch (err) {
      sendEngineError(res, err);
    }
  });

  // --- Personality (U7) ---
  router.get("/api/profile", async (_req, res) => {
    try {
      sendJson(res, 200, await getEngine().profile());
    } catch (err) {
      sendEngineError(res, err);
    }
  });
}
