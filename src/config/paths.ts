import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Central location for every on-disk path and environment-derived setting.
 *
 * All runtime state lives in a single gitignored data directory (default `<cwd>/.data`,
 * overridable with `SPOTIFY_SORT_DATA_DIR`) so there is no database to set up and nothing
 * sensitive ever leaves the machine.
 */
export const DATA_DIR = resolve(
  process.env.SPOTIFY_SORT_DATA_DIR ?? join(process.cwd(), ".data"),
);

export const paths = {
  dataDir: DATA_DIR,
  /** Spotify access/refresh tokens — written with 0600 permissions (see auth/tokenStore). */
  tokensFile: join(DATA_DIR, "tokens.json"),
  /** Timestamped library snapshots taken before any mutation. */
  backupsDir: join(DATA_DIR, "backups"),
  /** Per-track classification cache, keyed by track id. */
  classificationCacheFile: join(DATA_DIR, "classification-cache.json"),
  /** Cached personality analysis result. */
  analysisCacheFile: join(DATA_DIR, "analysis-cache.json"),
  /** Owner-defined vibe buckets and tagged example tracks. */
  bucketsFile: join(DATA_DIR, "buckets.json"),
} as const;

const DEFAULT_PORT = 4477;

/** Settings sourced from the environment, validated lazily so tests can run without them. */
export const env = {
  get port(): number {
    const raw = process.env.PORT;
    const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
    return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
  },
  get spotifyClientId(): string | undefined {
    return process.env.SPOTIFY_CLIENT_ID;
  },
  get spotifyRedirectUri(): string {
    return (
      process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${this.port}/callback`
    );
  },
  get openaiApiKey(): string | undefined {
    return process.env.OPENAI_API_KEY;
  },
  get openaiModel(): string {
    return process.env.OPENAI_MODEL ?? "gpt-5.5";
  },
} as const;

/** The single origin the local server serves from; used for the same-origin API guard. */
export function localOrigin(port = env.port): string {
  return `http://127.0.0.1:${port}`;
}

/** Best-effort load of a project `.env` file (Node built-in; no dependency). */
export function loadEnvFile(): void {
  const candidate = join(process.cwd(), ".env");
  try {
    // process.loadEnvFile is available in Node >= 20.12 / 21.7.
    process.loadEnvFile(candidate);
  } catch {
    // No .env file (or unsupported) — rely on the ambient environment. Not an error.
  }
}

export const HOME_HINT = homedir();
