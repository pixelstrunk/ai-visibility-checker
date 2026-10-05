import type { Market } from "./markets.ts";

export type EngineId = string;

export const ENGINE_LABELS: Record<EngineId, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  ai_mode: "Google AI Mode",
  perplexity: "Perplexity",
  claude: "Claude",
  copilot: "Copilot",
};

export function engineLabel(engine: EngineId): string {
  return ENGINE_LABELS[engine] ?? engine;
}

export type Source = { url: string; domain: string; title: string | null };
export type EngineAnswer = { text: string; sources: Source[]; costUsd: number };

export type Answer = {
  id: string;
  engine: EngineId;
  questionIndex: number;
  question: string;
  ok: boolean;
  text: string;
  sources: Source[];
  error: string | null;
  costUsd: number;
};

export type Verdict = { id: string; named: boolean; alias: string | null; position: number | null; competitors: string[] };

export type JudgedAnswer = Answer & { named: boolean | null; position: number | null; competitors: string[]; warning: string | null };

export type AnswersFile = {
  domain: string;
  brand: string;
  market: Market;
  provider: string;
  engines: EngineId[];
  createdAt: string;
  questions: string[];
  answers: Answer[];
  costUsd: number;
};

export type SiteFile = {
  domain: string;
  url: string;
  title: string;
  description: string;
  text: string;
  language: string | null;
  market: Market;
  readAt: string;
};

export type QuestionsFile = { brand: string; questions: string[]; market?: string };

export function answerId(engine: EngineId, questionIndex: number): string {
  return `${engine}-${questionIndex + 1}`;
}
