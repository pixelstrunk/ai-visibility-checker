import { retryDelayMs, sleep as defaultSleep, type Sleep } from "../core/retry.ts";

export type JsonSchema = Record<string, unknown>;
export type LlmResult<T> = { value: T; costUsd: number | null };
export type LlmTask = { name: string; system: string; user: string; schema: JsonSchema };

export type Llm = {
  id: string;
  model: string;
  json<T>(task: LlmTask): Promise<LlmResult<T>>;
};

export class LlmError extends Error {}

const TIMEOUT_MS = 300_000;
const RETRIES = 1;
export const MAX_TOKENS = 16_000;

function retryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

function cost(model: string, input: number, output: number): number | null {
  const price = PRICES[model];
  return price ? (input * price.input + output * price.output) / 1_000_000 : null;
}

async function postJson(request: typeof fetch, sleep: Sleep, url: string, headers: Record<string, string>, body: unknown, label: string): Promise<Record<string, unknown>> {
  let res: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw new LlmError(`${label} did not answer within ${TIMEOUT_MS / 1000} seconds`);
      throw new LlmError(`${label} could not be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!retryable(res.status) || attempt >= RETRIES) break;
    await res.body?.cancel().catch(() => undefined);
    await sleep(retryDelayMs(res.headers.get("retry-after")));
  }
  const raw = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new LlmError(`${label} answered with status ${res.status} but no JSON`);
  }
  if (!res.ok) {
    const message = (data.error as { message?: string } | undefined)?.message ?? res.statusText;
    throw new LlmError(`${label} answered with ${res.status}: ${message}`);
  }
  return data;
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LlmError(`${label} returned text that is not valid JSON`);
  }
}

export function anthropicBody(task: LlmTask, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: task.system,
    messages: [{ role: "user", content: task.user }],
    output_config: { format: { type: "json_schema", schema: task.schema } },
  };
}

export function openaiBody(task: LlmTask, model: string): Record<string, unknown> {
  return {
    model,
    max_completion_tokens: MAX_TOKENS,
    messages: [
      { role: "system", content: task.system },
      { role: "user", content: task.user },
    ],
    response_format: { type: "json_schema", json_schema: { name: task.name, strict: true, schema: task.schema } },
  };
}

export function anthropicLlm(apiKey: string, model: string, request: typeof fetch = fetch, sleep: Sleep = defaultSleep): Llm {
  return {
    id: "anthropic",
    model,
    async json<T>(task: LlmTask) {
      const data = await postJson(request, sleep, "https://api.anthropic.com/v1/messages", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, anthropicBody(task, model), "Anthropic");
      if (data.stop_reason === "max_tokens") throw new LlmError(`Anthropic cut the answer off at ${MAX_TOKENS} tokens`);
      if (data.stop_reason === "refusal") throw new LlmError("Anthropic declined the request");
      const text = ((data.content as { type: string; text?: string }[] | undefined) ?? [])
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      if (!text.trim()) throw new LlmError("Anthropic returned no structured answer");
      const usage = (data.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
      return { value: parseJson<T>(text, "Anthropic"), costUsd: cost(model, usage.input_tokens ?? 0, usage.output_tokens ?? 0) };
    },
  };
}

export function openaiLlm(apiKey: string, model: string, request: typeof fetch = fetch, sleep: Sleep = defaultSleep): Llm {
  return {
    id: "openai",
    model,
    async json<T>(task: LlmTask) {
      const data = await postJson(request, sleep, "https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${apiKey}` }, openaiBody(task, model), "OpenAI");
      const choice = (data.choices as { message?: { content?: string; refusal?: string }; finish_reason?: string }[] | undefined)?.[0];
      if (choice?.finish_reason === "length") throw new LlmError(`OpenAI cut the answer off at ${MAX_TOKENS} tokens`);
      if (choice?.message?.refusal) throw new LlmError("OpenAI declined the request");
      const content = choice?.message?.content;
      if (!content) throw new LlmError("OpenAI returned no structured answer");
      const usage = (data.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
      return { value: parseJson<T>(content, "OpenAI"), costUsd: cost(model, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0) };
    },
  };
}

export const DEFAULT_MODELS = {
  anthropic: { questions: "claude-sonnet-5-5", judge: "claude-haiku-4-5-20251001" },
  openai: { questions: "gpt-5-mini", judge: "gpt-5-mini" },
} as const;

export type LlmPair = { questions: Llm; judge: Llm };

export function llmFromEnv(choice: string | undefined, env: NodeJS.ProcessEnv): LlmPair | null {
  const wanted = (choice ?? env.AVC_LLM ?? "auto").toLowerCase();
  if (wanted === "none") return null;
  const override = env.AVC_LLM_MODEL;
  if ((wanted === "auto" || wanted === "anthropic") && env.ANTHROPIC_API_KEY) {
    const key = env.ANTHROPIC_API_KEY;
    const models = DEFAULT_MODELS.anthropic;
    return { questions: anthropicLlm(key, override ?? models.questions), judge: anthropicLlm(key, override ?? models.judge) };
  }
  if ((wanted === "auto" || wanted === "openai") && env.OPENAI_API_KEY) {
    const key = env.OPENAI_API_KEY;
    const models = DEFAULT_MODELS.openai;
    return { questions: openaiLlm(key, override ?? models.questions), judge: openaiLlm(key, override ?? models.judge) };
  }
  if (wanted === "anthropic") throw new LlmError("--llm anthropic needs ANTHROPIC_API_KEY");
  if (wanted === "openai") throw new LlmError("--llm openai needs OPENAI_API_KEY");
  if (wanted !== "auto") throw new LlmError(`unknown --llm "${wanted}", use anthropic, openai or none`);
  return null;
}
