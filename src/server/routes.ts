import { sendJson } from "./http.js";
import type { Router } from "./router.js";

/**
 * Wires the JSON API onto the shared router. Later units extend this:
 * U2 adds the OAuth connect/callback routes, U6 the sort routes, U7 the profile route,
 * U8 the buckets routes. Keeping registration in one place makes the API surface easy to audit.
 */
export function registerApiRoutes(router: Router): void {
  router.get("/api/health", (_req, res) => {
    sendJson(res, 200, { ok: true, name: "spotify-vibe-sorter" });
  });
}
