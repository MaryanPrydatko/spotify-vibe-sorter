import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { paths } from "../config/paths.js";

/** Tracks the model can't confidently place land here; excluded from the personality analysis. */
export const UNSORTED = "unsorted";

export interface BucketDef {
  name: string;
  /** Optional natural-language hint that sharpens classification (e.g. "high-energy, four-on-the-floor"). */
  description?: string;
  /** Owner-tagged example tracks that anchor a subjective bucket like "shower songs". */
  exampleTrackIds?: string[];
}

export interface BucketConfig {
  buckets: BucketDef[];
}

export const DEFAULT_BUCKETS: BucketConfig = {
  buckets: [
    { name: "techno" },
    { name: "rock" },
    { name: "sad songs" },
    { name: "shower songs" },
  ],
};

export function bucketNames(config: BucketConfig): string[] {
  return config.buckets.map((b) => b.name);
}

export function isKnownBucket(config: BucketConfig, name: string): boolean {
  return name === UNSORTED || config.buckets.some((b) => b.name === name);
}

export async function loadBucketConfig(
  file: string = paths.bucketsFile,
): Promise<BucketConfig> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as BucketConfig;
  } catch {
    return DEFAULT_BUCKETS;
  }
}

export async function saveBucketConfig(
  config: BucketConfig,
  file: string = paths.bucketsFile,
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(config, null, 2));
}
