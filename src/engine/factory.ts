import { isConnected } from "../auth/tokenStore.js";
import { loadBucketConfig } from "../classify/buckets.js";
import { ClassificationCache } from "../classify/cache.js";
import { OpenAiProvider } from "../classify/llm.js";
import { paths } from "../config/paths.js";
import { AnalysisCache, OpenAiAnalysisProvider } from "../profile/analyze.js";
import { SpotifyClient } from "../spotify/client.js";
import { SpotifyLibrary } from "../spotify/library.js";
import { SpotifyPlaylists } from "../spotify/playlists.js";
import { Engine } from "./engine.js";
import { LibraryCache } from "./libraryCache.js";

/** Wire the engine with real Spotify + OpenAI collaborators from the environment. */
export function buildEngine(): Engine {
  const client = new SpotifyClient();
  const library = new SpotifyLibrary(client);
  const playlists = new SpotifyPlaylists(client);
  return new Engine({
    library,
    writer: playlists,
    manageWriter: playlists,
    classifyProvider: new OpenAiProvider(),
    analysisProvider: new OpenAiAnalysisProvider(),
    loadConfig: () => loadBucketConfig(),
    isConnected: () => isConnected(),
    classificationCache: new ClassificationCache(paths.classificationCacheFile),
    analysisCache: new AnalysisCache(paths.analysisCacheFile),
    libraryCache: new LibraryCache(paths.libraryCacheFile),
    backupDir: paths.backupsDir,
  });
}

let cached: Engine | null = null;

/** Shared engine instance used by the HTTP routes. */
export function getEngine(): Engine {
  return (cached ??= buildEngine());
}
