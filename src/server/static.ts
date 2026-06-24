import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { sendHtml, sendText } from "./http.js";

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));

let cachedBundle: string | null = null;

/** Serve the single-page shell. */
export async function serveIndex(res: ServerResponse): Promise<void> {
  const html = await readFile(new URL("index.html", `file://${WEB_DIR}`), "utf8");
  sendHtml(res, 200, html);
}

/**
 * Bundle the TypeScript client with esbuild (lazily, cached) and serve it as ESM.
 * esbuild is a dev dependency; if it is unavailable we serve a clear fallback rather
 * than 500-ing, so the server still boots for API/test use.
 */
export async function serveAppBundle(res: ServerResponse): Promise<void> {
  if (cachedBundle === null) {
    try {
      const esbuild = await import("esbuild");
      const result = await esbuild.build({
        entryPoints: [fileURLToPath(new URL("app.ts", `file://${WEB_DIR}`))],
        bundle: true,
        format: "esm",
        target: "es2022",
        write: false,
        logLevel: "silent",
      });
      cachedBundle = result.outputFiles[0]?.text ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cachedBundle = `console.error(${JSON.stringify(
        `Client bundle unavailable: ${message}. Run "npm install" to install esbuild.`,
      )});`;
    }
  }
  sendText(res, 200, "application/javascript; charset=utf-8", cachedBundle);
}

/** Test hook: drop the cached bundle so a rebuild is forced. */
export function resetBundleCache(): void {
  cachedBundle = null;
}
