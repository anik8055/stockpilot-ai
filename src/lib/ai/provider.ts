import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env";

/**
 * Server-side LLM provider abstraction. Groq and any OpenAI-compatible endpoint share one implementation
 * (both speak the /chat/completions protocol). Keys never leave the server; the model ID always comes from env.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatJSONResult<T> =
  | { ok: true; data: T; usage: { promptTokens: number | null; completionTokens: number | null }; latencyMs: number; model: string }
  | { ok: false; reason: "not_configured" | "timeout" | "rate_limited" | "provider_error" | "invalid_output"; message: string; latencyMs: number; model: string | null };

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  chatJSON<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts?: { maxTokens?: number; temperature?: number }): Promise<ChatJSONResult<T>>;
  health(): Promise<{ ok: boolean; message: string }>;
}

type FetchLike = typeof fetch;

export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    public readonly name: string,
    private baseUrl: string,
    private apiKey: string,
    public readonly model: string,
    private timeoutMs: number,
    private defaultMaxTokens: number,
    private fetchImpl: FetchLike = fetch,
  ) {}

  async chatJSON<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: { maxTokens?: number; temperature?: number } = {}): Promise<ChatJSONResult<T>> {
    const started = Date.now();
    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.1,
      max_tokens: opts.maxTokens ?? this.defaultMaxTokens,
      response_format: { type: "json_object" },
    });
    let lastReason: ChatJSONResult<T> & { ok: false } = { ok: false, reason: "provider_error", message: "No response", latencyMs: 0, model: this.model };
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        lastReason = { ok: false, reason: timeout ? "timeout" : "provider_error", message: timeout ? "The AI service took too long to respond." : "Could not reach the AI service.", latencyMs: Date.now() - started, model: this.model };
        if (timeout) break; // do not double the wait on timeouts
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Math.min(5, Number(res.headers.get("retry-after")) || 1.5);
        lastReason = { ok: false, reason: res.status === 429 ? "rate_limited" : "provider_error", message: res.status === 429 ? "The AI service is busy (rate limit)." : `The AI service returned an error (${res.status}).`, latencyMs: Date.now() - started, model: this.model };
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        break;
      }
      if (!res.ok) {
        return { ok: false, reason: "provider_error", message: `The AI service rejected the request (${res.status}).`, latencyMs: Date.now() - started, model: this.model };
      }
      const json = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
      const content = json?.choices?.[0]?.message?.content ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      } catch {
        return { ok: false, reason: "invalid_output", message: "The AI response was not valid JSON.", latencyMs: Date.now() - started, model: this.model };
      }
      const valid = schema.safeParse(parsed);
      if (!valid.success) {
        return { ok: false, reason: "invalid_output", message: "The AI response did not match the expected format.", latencyMs: Date.now() - started, model: this.model };
      }
      return {
        ok: true,
        data: valid.data,
        usage: { promptTokens: json?.usage?.prompt_tokens ?? null, completionTokens: json?.usage?.completion_tokens ?? null },
        latencyMs: Date.now() - started,
        model: this.model,
      };
    }
    return lastReason;
  }

  async health() {
    try {
      const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, message: `Provider returned HTTP ${res.status}` };
      const json = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
      const found = json?.data?.some((m) => m.id === this.model);
      return found === false ? { ok: false, message: `Model "${this.model}" is not available for this API key` } : { ok: true, message: "reachable" };
    } catch {
      return { ok: false, message: "unreachable" };
    }
  }
}

let override: AIProvider | null | undefined;
/** Tests inject a fake provider here. */
export function setProviderForTests(p: AIProvider | null | undefined) {
  override = p;
}

export function getProvider(): AIProvider | null {
  if (override !== undefined) return override;
  const e = env();
  if (e.AI_PROVIDER === "groq" && e.GROQ_API_KEY && e.GROQ_MODEL) {
    return new OpenAICompatibleProvider("groq", e.GROQ_BASE_URL, e.GROQ_API_KEY, e.GROQ_MODEL, e.AI_TIMEOUT_MS, e.AI_MAX_OUTPUT_TOKENS);
  }
  if (e.AI_PROVIDER === "openai_compatible" && e.OPENAI_COMPATIBLE_API_KEY && e.OPENAI_COMPATIBLE_MODEL && e.OPENAI_COMPATIBLE_BASE_URL) {
    return new OpenAICompatibleProvider("openai_compatible", e.OPENAI_COMPATIBLE_BASE_URL, e.OPENAI_COMPATIBLE_API_KEY, e.OPENAI_COMPATIBLE_MODEL, e.AI_TIMEOUT_MS, e.AI_MAX_OUTPUT_TOKENS);
  }
  return null;
}

export async function aiStatus(deep = false) {
  const e = env();
  const p = getProvider();
  if (!p) {
    const missing = e.AI_PROVIDER === "none" ? [] : e.AI_PROVIDER === "groq" ? ["GROQ_API_KEY", "GROQ_MODEL"].filter((k) => !process.env[k]) : ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_MODEL", "OPENAI_COMPATIBLE_BASE_URL"].filter((k) => !process.env[k]);
    return { provider: e.AI_PROVIDER, configured: false, missing };
  }
  if (!deep) return { provider: p.name, configured: true, model: p.model };
  const h = await p.health();
  return { provider: p.name, configured: true, model: p.model, healthy: h.ok, detail: h.message };
}
