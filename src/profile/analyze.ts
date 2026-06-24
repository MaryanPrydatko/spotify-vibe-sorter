import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import OpenAI from "openai";
import { redactSecret } from "../classify/llm.js";
import { env } from "../config/paths.js";
import type { LibraryAggregate } from "./aggregate.js";

export interface PersonalityProfile {
  /** Short, shareable label, e.g. "Midnight Techno Romantic". */
  archetype: string;
  summary: string;
  /** Specific cross-playlist observations grounded in the aggregate matrix. */
  correlations: string[];
}

/** The swap point for the analysis model — GPT-5.5 today. */
export interface AnalysisProvider {
  analyze(aggregate: LibraryAggregate): Promise<PersonalityProfile>;
}

interface ChatClient {
  chat: {
    completions: {
      create(args: unknown): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
}

export class OpenAiAnalysisProvider implements AnalysisProvider {
  private readonly client: ChatClient;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(opts: { apiKey?: string; model?: string; client?: ChatClient } = {}) {
    this.apiKey = opts.apiKey ?? env.openaiApiKey;
    this.model = opts.model ?? env.openaiModel;
    this.client =
      opts.client ?? (new OpenAI({ apiKey: this.apiKey }) as unknown as ChatClient);
  }

  async analyze(aggregate: LibraryAggregate): Promise<PersonalityProfile> {
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content:
              "You are a witty music critic. From the listener's library summary, return JSON " +
              '{"archetype":"<short fun label>","summary":"<2-3 sentences>","correlations":["<insight>"]}. ' +
              "Ground every correlation ONLY in the playlistBucketMatrix — do not invent patterns.",
          },
          { role: "user", content: JSON.stringify(aggregate) },
        ],
        response_format: { type: "json_object" },
      });
      const content = resp.choices[0]?.message.content ?? "{}";
      const parsed = JSON.parse(content) as Partial<PersonalityProfile>;
      return {
        archetype: parsed.archetype ?? "Uncategorized Listener",
        summary: parsed.summary ?? "",
        correlations: parsed.correlations ?? [],
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(`Analysis request failed: ${redactSecret(raw, this.apiKey)}`);
    }
  }
}

export function hashAggregate(aggregate: LibraryAggregate): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        b: aggregate.bucketDistribution,
        m: aggregate.playlistBucketMatrix,
        s: aggregate.sortedTracks,
      }),
    )
    .digest("hex");
}

/** File-backed cache of the latest analysis, invalidated when the aggregate changes. */
export class AnalysisCache {
  constructor(private readonly file?: string) {}

  async get(hash: string): Promise<PersonalityProfile | null> {
    if (!this.file) return null;
    try {
      const stored = JSON.parse(await readFile(this.file, "utf8")) as {
        hash: string;
        profile: PersonalityProfile;
      };
      return stored.hash === hash ? stored.profile : null;
    } catch {
      return null;
    }
  }

  async set(hash: string, profile: PersonalityProfile): Promise<void> {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify({ hash, profile }, null, 2));
  }
}

/** Produce the personality profile, reusing a cached result when the aggregate is unchanged. */
export async function analyzePersonality(
  aggregate: LibraryAggregate,
  opts: { provider: AnalysisProvider; cache?: AnalysisCache },
): Promise<PersonalityProfile> {
  const hash = hashAggregate(aggregate);
  const cached = await opts.cache?.get(hash);
  if (cached) return cached;

  const profile = await opts.provider.analyze(aggregate);
  await opts.cache?.set(hash, profile);
  return profile;
}
