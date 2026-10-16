import type { Market } from "../core/markets.ts";
import type { EngineAnswer, EngineId } from "../core/types.ts";

export type Provider = {
  id: string;
  label: string;
  engines: EngineId[];
  setup: string;
  costPerAnswerUsd: number;
  missingSetup(env: NodeJS.ProcessEnv): string | null;
  ask(engine: EngineId, question: string, market: Market, env: NodeJS.ProcessEnv): Promise<EngineAnswer>;
};

export class ProviderError extends Error {
  readonly costUsd: number;
  constructor(message: string, costUsd = 0) {
    super(message);
    this.costUsd = costUsd;
  }
}

function rewrite(url: string, dropHash: (hash: string) => boolean): string {
  try {
    const u = new URL(url);
    if (dropHash(u.hash)) u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (key.startsWith("utm_")) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

export function cleanUrl(url: string): string {
  return rewrite(url, () => true);
}

export function withoutTracking(url: string): string {
  return rewrite(url, (hash) => hash.startsWith("#:~:"));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
