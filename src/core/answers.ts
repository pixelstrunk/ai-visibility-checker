import type { Market } from "./markets.ts";
import type { Answer, AnswersFile, Source } from "./types.ts";

class FieldError extends Error {}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FieldError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string") throw new FieldError(`${path} must be a string`);
  return value;
}

function nonEmpty(value: unknown, path: string): string {
  const s = text(value, path);
  if (!s.trim()) throw new FieldError(`${path} must not be empty`);
  return s;
}

function number(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new FieldError(`${path} must be a number`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new FieldError(`${path} must be true or false`);
  return value;
}

function list<T>(value: unknown, path: string, item: (v: unknown, p: string) => T): T[] {
  if (!Array.isArray(value)) throw new FieldError(`${path} must be a list`);
  return value.map((v, i) => item(v, `${path}[${i}]`));
}

function market(value: unknown, path: string): Market {
  const m = record(value, path);
  return { country: nonEmpty(m.country, `${path}.country`), language: nonEmpty(m.language, `${path}.language`), locationCode: number(m.locationCode, `${path}.locationCode`), label: nonEmpty(m.label, `${path}.label`) };
}

function source(value: unknown, path: string): Source {
  const s = record(value, path);
  return { url: nonEmpty(s.url, `${path}.url`), domain: text(s.domain ?? "", `${path}.domain`), title: s.title == null ? null : text(s.title, `${path}.title`) };
}

function answer(value: unknown, path: string): Answer {
  const a = record(value, path);
  const questionIndex = number(a.questionIndex, `${path}.questionIndex`);
  if (!Number.isInteger(questionIndex) || questionIndex < 0) throw new FieldError(`${path}.questionIndex must be a whole number`);
  return {
    id: nonEmpty(a.id, `${path}.id`),
    engine: nonEmpty(a.engine, `${path}.engine`),
    questionIndex,
    question: text(a.question ?? "", `${path}.question`),
    ok: boolean(a.ok, `${path}.ok`),
    text: text(a.text ?? "", `${path}.text`),
    sources: list(a.sources ?? [], `${path}.sources`, source),
    error: a.error == null ? null : text(a.error, `${path}.error`),
    costUsd: number(a.costUsd ?? 0, `${path}.costUsd`),
  };
}

export function parseAnswersFile(data: unknown): AnswersFile {
  const f = record(data, "answers.json");
  const file: AnswersFile = {
    domain: nonEmpty(f.domain, "domain"),
    brand: nonEmpty(f.brand, "brand"),
    market: market(f.market, "market"),
    provider: nonEmpty(f.provider, "provider"),
    engines: list(f.engines, "engines", nonEmpty),
    createdAt: nonEmpty(f.createdAt, "createdAt"),
    questions: list(f.questions, "questions", nonEmpty),
    answers: list(f.answers, "answers", answer),
    costUsd: number(f.costUsd ?? 0, "costUsd"),
  };
  for (const a of file.answers) if (a.questionIndex >= file.questions.length) throw new FieldError(`answer ${a.id} points to question ${a.questionIndex + 1}, but there are only ${file.questions.length}`);
  return file;
}
