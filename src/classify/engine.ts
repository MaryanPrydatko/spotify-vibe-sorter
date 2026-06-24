import type { ArtistRef } from "../spotify/types.js";
import { type BucketConfig, isKnownBucket, UNSORTED } from "./buckets.js";
import { ClassificationCache } from "./cache.js";
import type { LlmProvider, TrackForLlm } from "./llm.js";

export interface ClassifiableTrack {
  id: string;
  name: string;
  artists: ArtistRef[];
  genres: string[];
  popularity: number;
}

export interface ClassificationResult {
  /** trackId -> bucket name (cached + freshly classified). */
  assignments: Map<string, string>;
  total: number;
  classified: number;
  failed: number;
  /** True only when every track was classified — U6 refuses to build playlists otherwise. */
  complete: boolean;
}

export interface ClassifyOptions {
  provider: LlmProvider;
  config: BucketConfig;
  cache?: ClassificationCache;
  batchSize?: number;
  /** bucket name -> example tracks the owner tagged (for subjective buckets). */
  examplesByBucket?: Record<string, TrackForLlm[]>;
}

function toLlmTrack(t: ClassifiableTrack): TrackForLlm {
  return {
    id: t.id,
    name: t.name,
    artist: t.artists.map((a) => a.name).join(", "),
    genres: t.genres,
    popularity: t.popularity,
  };
}

/**
 * Classify every track into the owner's buckets. The whole library goes through the LLM
 * (genres are context, not a gate); results are cached so a stable library re-runs for free.
 * A batch that fails is recorded as failed and skipped — already-cached progress is preserved,
 * and `complete` flips to false so the caller knows the result is partial.
 */
export async function classifyLibrary(
  tracks: ClassifiableTrack[],
  opts: ClassifyOptions,
): Promise<ClassificationResult> {
  const cache = opts.cache ?? new ClassificationCache();
  const batchSize = opts.batchSize ?? 50;
  const assignments = new Map<string, string>();

  const uncached: ClassifiableTrack[] = [];
  for (const t of tracks) {
    const cached = cache.get(t.id);
    if (cached !== undefined) assignments.set(t.id, cached);
    else uncached.push(t);
  }

  let failed = 0;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    try {
      const result = await opts.provider.classifyBatch({
        tracks: batch.map(toLlmTrack),
        buckets: opts.config.buckets,
        examples: opts.examplesByBucket ?? {},
      });
      for (const t of batch) {
        const raw = result[t.id];
        // Coerce anything the model invents (or omits) to the safe fallback bucket.
        const bucket = raw && isKnownBucket(opts.config, raw) ? raw : UNSORTED;
        assignments.set(t.id, bucket);
        cache.set(t.id, bucket);
      }
    } catch {
      failed += batch.length; // preserve cached progress; mark this batch unclassified
    }
  }

  const classified = assignments.size;
  return {
    assignments,
    total: tracks.length,
    classified,
    failed,
    complete: failed === 0 && classified === tracks.length,
  };
}
