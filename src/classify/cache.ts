import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Per-track classification cache, keyed by track id. Lets a re-run skip the LLM entirely
 * for a stable library. Pass no file for an in-memory cache (used in tests).
 */
export class ClassificationCache {
  private map = new Map<string, string>();

  constructor(private readonly file?: string) {}

  async load(): Promise<void> {
    if (!this.file) return;
    try {
      const obj = JSON.parse(await readFile(this.file, "utf8")) as Record<string, string>;
      this.map = new Map(Object.entries(obj));
    } catch {
      // No cache yet — start empty.
    }
  }

  get(id: string): string | undefined {
    return this.map.get(id);
  }

  set(id: string, bucket: string): void {
    this.map.set(id, bucket);
  }

  get size(): number {
    return this.map.size;
  }

  async save(): Promise<void> {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.map), null, 2));
  }
}
