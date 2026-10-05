import type { Market } from "../core/markets.ts";
import { retryDelayMs, sleep as defaultSleep, type Sleep } from "../core/retry.ts";
import type { EngineAnswer, EngineId, Source } from "../core/types.ts";
import { cleanUrl, hostOf, ProviderError, type Provider } from "./provider.ts";

const ENGINE_TIMEOUT_MS = 120_000;
const RETRIES = 1;

const PATHS: Record<string, string> = {
  chatgpt: "ai_optimization/chat_gpt/llm_scraper/live/advanced",
  gemini: "ai_optimization/gemini/llm_scraper/live/advanced",
  ai_mode: "serp/google/ai_mode/live/advanced",
};

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function dataforseoRequest(engine: EngineId, question: string, market: Market): Json[] {
  const task: Json = { keyword: question, location_code: market.locationCode, language_code: market.language };
  if (engine === "chatgpt") task.force_web_search = true;
  return [task];
}

function collectSources(list: unknown, into: Map<string, Source>): void {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Json;
    const url = cleanUrl(str(s.url));
    if (!url || into.has(url)) continue;
    into.set(url, { url, domain: str(s.domain).replace(/^www\./, "") || hostOf(url), title: str(s.title) || str(s.source) || null });
  }
}

export function parseDataforseoResponse(engine: EngineId, body: unknown): EngineAnswer {
  const root = (body ?? {}) as Json;
  const task = (Array.isArray(root.tasks) ? root.tasks[0] : undefined) as Json | undefined;
  const costUsd = Number(task?.cost ?? root.cost ?? 0) || 0;
  if (!task) throw new ProviderError(`DataForSEO ${engine}: no task in response (${str(root.status_message)})`, costUsd);
  if (task.status_code !== 20000) throw new ProviderError(`DataForSEO ${engine}: ${String(task.status_code)} ${str(task.status_message)}`, costUsd);
  const result = (Array.isArray(task.result) ? task.result[0] : undefined) as Json | undefined;
  if (!result) throw new ProviderError(`DataForSEO ${engine}: empty result`, costUsd);

  const sources = new Map<string, Source>();
  let text: string;
  if (engine === "ai_mode") {
    const blocks = (Array.isArray(result.items) ? result.items : []) as Json[];
    const overviews = blocks.filter((b) => b?.type === "ai_overview");
    text = overviews.map((b) => str(b.markdown)).filter(Boolean).join("\n\n");
    for (const block of overviews) {
      collectSources(block.references, sources);
      for (const element of (Array.isArray(block.items) ? block.items : []) as Json[]) collectSources(element?.references, sources);
    }
  } else {
    text = str(result.markdown);
    if (!text) text = ((Array.isArray(result.items) ? result.items : []) as Json[]).map((i) => str(i.markdown)).filter(Boolean).join("\n\n");
    collectSources(result.sources, sources);
    for (const item of (Array.isArray(result.items) ? result.items : []) as Json[]) collectSources(item?.sources, sources);
  }
  if (!text.trim()) throw new ProviderError(`DataForSEO ${engine}: answer without text`, costUsd);
  return { text: text.trim(), sources: [...sources.values()], costUsd };
}

function credentials(env: NodeJS.ProcessEnv): string {
  return Buffer.from(`${env.DATAFORSEO_LOGIN ?? ""}:${env.DATAFORSEO_PASSWORD ?? ""}`).toString("base64");
}

export async function postDataforseo(path: string, payload: unknown, env: NodeJS.ProcessEnv, request: typeof fetch = fetch, sleep: Sleep = defaultSleep): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await request(`https://api.dataforseo.com/v3/${path}`, {
        method: "POST",
        headers: { authorization: `Basic ${credentials(env)}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") throw new ProviderError(`DataForSEO did not answer within ${ENGINE_TIMEOUT_MS / 1000} seconds; not retried, because the request may already have been charged`);
      throw new ProviderError(`DataForSEO could not be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401) throw new ProviderError("DataForSEO rejected the login. Check DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD (API credentials, not the website password).");
    if (res.status === 402) throw new ProviderError("DataForSEO says the account balance is too low.");
    if ((res.status >= 500 || res.status === 429) && attempt < RETRIES) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(retryDelayMs(res.headers.get("retry-after")));
      continue;
    }
    const raw = await res.text();
    try {
      return JSON.parse(raw);
    } catch {
      throw new ProviderError(`DataForSEO answered with status ${res.status} but no JSON: ${raw.slice(0, 120).replace(/\s+/g, " ")}`);
    }
  }
}

export const dataforseo: Provider = {
  id: "dataforseo",
  label: "DataForSEO",
  engines: ["chatgpt", "gemini", "ai_mode"],
  costPerAnswerUsd: 0.004,
  setup: "Both are the API credentials from https://app.dataforseo.com/api-access, not the website password.",
  missingSetup(env) {
    const missing = [env.DATAFORSEO_LOGIN ? null : "DATAFORSEO_LOGIN", env.DATAFORSEO_PASSWORD ? null : "DATAFORSEO_PASSWORD"].filter((v) => v !== null);
    if (missing.length === 0) return null;
    return missing.length === 1 ? `${missing[0]} is not set.` : `${missing.join(" and ")} are not set.`;
  },
  async ask(engine, question, market, env) {
    const path = PATHS[engine];
    if (!path) throw new ProviderError(`DataForSEO does not support the engine "${engine}"`);
    const body = await postDataforseo(path, dataforseoRequest(engine, question, market), env);
    return parseDataforseoResponse(engine, body);
  },
};
