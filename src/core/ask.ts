import type { Provider } from "../providers/provider.ts";
import { ProviderError } from "../providers/provider.ts";
import type { Market } from "./markets.ts";
import { answerId, type Answer, type EngineId } from "./types.ts";

export const CONCURRENCY = 5;

type Job = { engine: EngineId; questionIndex: number; question: string };

export async function askAll(options: {
  provider: Provider;
  engines: EngineId[];
  questions: string[];
  market: Market;
  env: NodeJS.ProcessEnv;
  onAnswer?: (answer: Answer, done: number, total: number) => void;
}): Promise<Answer[]> {
  const jobs: Job[] = options.questions.flatMap((question, questionIndex) => options.engines.map((engine) => ({ engine, questionIndex, question })));
  const results: Answer[] = new Array(jobs.length);
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < jobs.length) {
      const slot = next++;
      const job = jobs[slot]!;
      const base = { id: answerId(job.engine, job.questionIndex), engine: job.engine, questionIndex: job.questionIndex, question: job.question };
      let answer: Answer;
      try {
        const result = await options.provider.ask(job.engine, job.question, options.market, options.env);
        answer = { ...base, ok: true, text: result.text, sources: result.sources, error: null, costUsd: result.costUsd };
      } catch (err) {
        const costUsd = err instanceof ProviderError ? err.costUsd : 0;
        answer = { ...base, ok: false, text: "", sources: [], error: err instanceof Error ? err.message : String(err), costUsd };
      }
      results[slot] = answer;
      done += 1;
      options.onAnswer?.(answer, done, jobs.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  return results;
}

export function estimateCostUsd(provider: Provider, questions: number, engines: number): number {
  return Math.round(questions * engines * provider.costPerAnswerUsd * 1000) / 1000;
}
