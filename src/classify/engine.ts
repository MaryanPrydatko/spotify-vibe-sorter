import type { ArtistRef } from "../spotify/types.js";
import { mapWithConcurrency } from "../util/concurrency.js";
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
  /** How many LLM batches to run concurrently. */
  concurrency?: number;
  /** bucket name -> example tracks the owner tagged (for subjective buckets). */
  examplesByBucket?: Record<string, TrackForLlm[]>;
  log?: (message: string) => void;
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
  const batchSize = opts.batchSize ?? 80;
  const concurrency = opts.concurrency ?? 4;
  const log = opts.log ?? (() => {});
  const assignments = new Map<string, string>();

  const uncached: ClassifiableTrack[] = [];
  for (const t of tracks) {
    const cached = cache.get(t.id);
    if (cached !== undefined) assignments.set(t.id, cached);
    else uncached.push(t);
  }

  const batches: ClassifiableTrack[][] = [];
  for (let i = 0; i < uncached.length; i += batchSize) {
    batches.push(uncached.slice(i, i + batchSize));
  }
  if (uncached.length) {
    log(
      `Classifying ${uncached.length} tracks in ${batches.length} batch(es)` +
        ` (${assignments.size} already cached)…`,
    );
  }

  // Run batches concurrently — preserves cached progress; a failed batch is recorded as failed.
  let done = 0;
  const outcomes = await mapWithConcurrency(batches, concurrency, async (batch) => {
    try {
      const result = await opts.provider.classifyBatch({
        tracks: batch.map(toLlmTrack),
        buckets: opts.config.buckets,
        examples: opts.examplesByBucket ?? {},
      });
      log(`  classified batch ${++done}/${batches.length}`);
      return { batch, result: result as Record<string, string> | null };
    } catch {
      log(`  batch ${++done}/${batches.length} failed`);
      return { batch, result: null as Record<string, string> | null };
    }
  });

  let failed = 0;
  for (const { batch, result } of outcomes) {
    if (!result) {
      failed += batch.length; // preserve cached progress; mark this batch unclassified
      continue;
    }
    for (const t of batch) {
      const raw = result[t.id];
      // Coerce anything the model invents (or omits) to the safe fallback bucket.
      const bucket = raw && isKnownBucket(opts.config, raw) ? raw : UNSORTED;
      assignments.set(t.id, bucket);
      cache.set(t.id, bucket);
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
