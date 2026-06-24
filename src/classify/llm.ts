import OpenAI from "openai";
import { env } from "../config/paths.js";
import type { BucketDef } from "./buckets.js";
import { UNSORTED } from "./buckets.js";

export interface TrackForLlm {
  id: string;
  name: string;
  artist: string;
  genres: string[];
  popularity: number;
}

export interface ClassifyBatchInput {
  tracks: TrackForLlm[];
  buckets: BucketDef[];
  /** bucket name -> a few example tracks the owner tagged for that bucket. */
  examples: Record<string, TrackForLlm[]>;
}

/** The swap point: GPT-5.5 today, any provider later, without touching the engine. */
export interface LlmProvider {
  /** Returns trackId -> chosen bucket name. */
  classifyBatch(input: ClassifyBatchInput): Promise<Record<string, string>>;
}

export function redactSecret(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join("[redacted]");
}

/** Strip the API key (and raw SDK noise) from any error before it can reach logs or the UI. */
export function sanitizeLlmError(err: unknown, secret = env.openaiApiKey): Error {
  const raw = err instanceof Error ? err.message : String(err);
  return new Error(`LLM request failed: ${redactSecret(raw, secret)}`);
}

/** Minimal shape of the OpenAI chat client we depend on (keeps it injectable for tests). */
interface ChatClient {
  chat: {
    completions: {
      create(args: unknown): Promise<{
        choices: { message: { content: string | null } }[];
      }>;
    };
  };
}

function buildMessages(input: ClassifyBatchInput): { role: "system" | "user"; content: string }[] {
  const bucketLines = input.buckets
    .map((b) => `- ${b.name}${b.description ? `: ${b.description}` : ""}`)
    .join("\n");
  const exampleLines = Object.entries(input.examples)
    .filter(([, ex]) => ex.length > 0)
    .map(([bucket, ex]) => `${bucket}: ${ex.map((t) => `${t.name} — ${t.artist}`).join("; ")}`)
    .join("\n");

  const system =
    "You sort songs into a listener's custom vibe buckets. Assign every track to exactly one " +
    `bucket by name, or "${UNSORTED}" if none fit. Use the genres, artist, and the listener's ` +
    'examples as guidance. Respond with JSON: {"assignments":[{"id":"<trackId>","bucket":"<name>"}]}.';

  const user =
    `Buckets:\n${bucketLines}\n\n` +
    (exampleLines ? `Listener's examples:\n${exampleLines}\n\n` : "") +
    `Tracks:\n${JSON.stringify(
      input.tracks.map((t) => ({
        id: t.id,
        name: t.name,
        artist: t.artist,
        genres: t.genres,
        popularity: t.popularity,
      })),
    )}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export class OpenAiProvider implements LlmProvider {
  private readonly client: ChatClient;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(opts: { apiKey?: string; model?: string; client?: ChatClient } = {}) {
    this.apiKey = opts.apiKey ?? env.openaiApiKey;
    this.model = opts.model ?? env.openaiModel;
    this.client =
      opts.client ?? (new OpenAI({ apiKey: this.apiKey }) as unknown as ChatClient);
  }

  async classifyBatch(input: ClassifyBatchInput): Promise<Record<string, string>> {
    try {
      const resp = await this.client.chat.completions.create({
        model: this.model,
        messages: buildMessages(input),
        response_format: { type: "json_object" },
      });
      const content = resp.choices[0]?.message.content ?? "{}";
      const parsed = JSON.parse(content) as {
        assignments?: { id: string; bucket: string }[];
      };
      const out: Record<string, string> = {};
      for (const a of parsed.assignments ?? []) out[a.id] = a.bucket;
      return out;
    } catch (err) {
      throw sanitizeLlmError(err, this.apiKey);
    }
  }
}
