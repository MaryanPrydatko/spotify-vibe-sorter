import type { IncomingMessage, ServerResponse } from "node:http";
import { sendError } from "./http.js";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<void> | void;

type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Deliberately tiny exact-path router. Units U2/U6/U7/U8 register their routes onto a
 * shared instance; there is no framework, which keeps the dependency surface and the
 * "what can this server do" answer small and auditable.
 */
export class Router {
  private readonly routes = new Map<string, RouteHandler>();

  private key(method: Method, path: string): string {
    return `${method} ${path}`;
  }

  add(method: Method, path: string, handler: RouteHandler): this {
    this.routes.set(this.key(method, path), handler);
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }
  put(path: string, handler: RouteHandler): this {
    return this.add("PUT", path, handler);
  }
  delete(path: string, handler: RouteHandler): this {
    return this.add("DELETE", path, handler);
  }

  /** Look up a handler for a request, or `undefined` if no route matches. */
  match(method: string, path: string): RouteHandler | undefined {
    return this.routes.get(`${method} ${path}`);
  }

  /** Run a matched handler with uniform error handling; returns false if no route matched. */
  async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const handler = this.match(req.method ?? "GET", url.pathname);
    if (!handler) return false;
    try {
      await handler(req, res, url);
    } catch (err) {
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : "Internal error";
        sendError(res, 500, message);
      }
    }
    return true;
  }
}
