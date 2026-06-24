import { createServer as createHttpServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { env, loadEnvFile, localOrigin } from "../config/paths.js";
import { sendError } from "./http.js";
import { Router } from "./router.js";
import { registerApiRoutes } from "./routes.js";
import { serveAppBundle, serveIndex } from "./static.js";

/** A cross-origin fetch from another tab or host carries an Origin we must not honor. */
function isAllowedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * Build the HTTP server. Always bound to 127.0.0.1 by the caller so the API — which can
 * create and delete playlists — is never reachable from the network.
 */
export function createServer(): Server {
  const router = new Router();
  registerApiRoutes(router);

  return createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", localOrigin());

    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      sendError(res, 403, "Cross-origin request rejected");
      return;
    }

    // Registered routes (API + OAuth callback) take precedence over static.
    if (await router.dispatch(req, res, url)) return;

    if (
      req.method === "GET" &&
      (url.pathname === "/" || url.pathname === "/index.html")
    ) {
      await serveIndex(res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      await serveAppBundle(res);
      return;
    }

    sendError(res, 404, `No route for ${req.method ?? "GET"} ${url.pathname}`);
  });
}

/** Boot the server on the loopback interface. */
export function startServer(port = env.port): Promise<Server> {
  const server = createServer();
  return new Promise((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      console.log(`spotify-vibe-sorter running at ${localOrigin(port)}`);
      resolvePromise(server);
    });
  });
}

// Run when invoked directly (`tsx src/server/index.ts`).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFile();
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
