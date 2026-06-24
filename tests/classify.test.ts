import { describe, expect, it } from "vitest";
import type { BucketConfig } from "../src/classify/buckets.js";
import { UNSORTED } from "../src/classify/buckets.js";
import { ClassificationCache } from "../src/classify/cache.js";
import {
  classifyLibrary,
  type ClassifiableTrack,
} from "../src/classify/engine.js";
import {
  OpenAiProvider,
  redactSecret,
  type ClassifyBatchInput,
  type LlmProvider,
  type TrackForLlm,
} from "../src/classify/llm.js";

const CONFIG: BucketConfig = { buckets: [{ name: "rock" }, { name: "techno" }] };

function track(id: string, genres: string[] = []): ClassifiableTrack {
  return { id, name: `song-${id}`, artists: [{ id: `a-${id}`, name: "Artist" }], genres, popularity: 50 };
}

class FakeProvider implements LlmProvider {
  calls = 0;
  lastInput?: ClassifyBatchInput;
  constructor(private readonly resolve: (t: TrackForLlm) => string) {}
  async classifyBatch(input: ClassifyBatchInput): Promise<Record<string, string>> {
    this.calls++;
    this.lastInput = input;
    const out: Record<string, string> = {};
    for (const t of input.tracks) out[t.id] = this.resolve(t);
    return out;
  }
}

describe("U5 classification engine", () => {
  it("classifies a track with no genres (AE1) — the model still assigns it", async () => {
    const provider = new FakeProvider(() => "rock");
    const result = await classifyLibrary([track("t1", [])], { provider, config: CONFIG });
    expect(result.assignments.get("t1")).toBe("rock");
    expect(result.complete).toBe(true);
  });

  it("passes the owner's examples to the provider for subjective buckets (AE2)", async () => {
    const provider = new FakeProvider(() => "rock");
    const examples = {
      "shower songs": [{ id: "ex1", name: "Mr. Brightside", artist: "The Killers", genres: [], popularity: 80 }],
    };
    await classifyLibrary([track("t1")], { provider, config: CONFIG, examplesByBucket: examples });
    expect(provider.lastInput?.examples["shower songs"]?.[0]?.name).toBe("Mr. Brightside");
  });

  it("coerces an unknown bucket to the unsorted fallback", async () => {
    const provider = new FakeProvider(() => "not-a-real-bucket");
    const result = await classifyLibrary([track("t1")], { provider, config: CONFIG });
    expect(result.assignments.get("t1")).toBe(UNSORTED);
  });

  it("serves cached tracks without calling the provider on re-run", async () => {
    const provider = new FakeProvider(() => "techno");
    const cache = new ClassificationCache();
    await classifyLibrary([track("t1")], { provider, config: CONFIG, cache });
    expect(provider.calls).toBe(1);

    await classifyLibrary([track("t1")], { provider, config: CONFIG, cache });
    expect(provider.calls).toBe(1); // no new call — fully cached
  });

  it("batches uncached tracks by batchSize (handles a partial final batch)", async () => {
    const provider = new FakeProvider(() => "rock");
    await classifyLibrary([track("t1"), track("t2"), track("t3")], {
      provider,
      config: CONFIG,
      batchSize: 2,
    });
    expect(provider.calls).toBe(2); // 2 + 1
  });

  it("reports incomplete when a batch fails, preserving the run", async () => {
    const failing: LlmProvider = {
      classifyBatch: async () => {
        throw new Error("LLM down");
      },
    };
    const result = await classifyLibrary([track("t1"), track("t2")], {
      provider: failing,
      config: CONFIG,
    });
    expect(result.failed).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.classified).toBe(0);
  });
});

describe("U5 secret redaction", () => {
  it("redacts the api key from text", () => {
    expect(redactSecret("error with sk-abc123", "sk-abc123")).toBe("error with [redacted]");
  });

  it("does not leak the OpenAI key when the SDK throws (provider sanitizes)", async () => {
    const key = "sk-secret-XYZ";
    const client = {
      chat: {
        completions: {
          create: async () => {
            throw new Error(`401 Unauthorized: key ${key} is invalid`);
          },
        },
      },
    };
    const provider = new OpenAiProvider({ apiKey: key, client });
    await expect(
      provider.classifyBatch({ tracks: [], buckets: [], examples: {} }),
    ).rejects.toThrow(/LLM request failed/);

    try {
      await provider.classifyBatch({ tracks: [], buckets: [], examples: {} });
    } catch (err) {
      expect((err as Error).message).not.toContain(key);
    }
  });
});
