import { namedInText } from "./judge.ts";
import type { QuestionsFile } from "./types.ts";

export const QUESTION_COUNT = 5;
export const MAX_QUESTIONS = 10;
export const QUESTION_MAX_CHARS = 300;

export type QuestionCheck = { errors: string[]; warnings: string[] };

export function normalizeQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

function fromText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
}

function strings(list: unknown): string[] | null {
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : null;
}

function fromJson(raw: string): Partial<QuestionsFile> | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (Array.isArray(data)) return { questions: strings(data) ?? [] };
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const out: Partial<QuestionsFile> = {};
  const questions = strings(obj.questions);
  if (questions) out.questions = questions;
  if (typeof obj.brand === "string") out.brand = obj.brand;
  if (typeof obj.market === "string") out.market = obj.market;
  return out;
}

export function parseQuestions(raw: string): Partial<QuestionsFile> {
  const trimmed = raw.trim();
  const json = trimmed.startsWith("[") || trimmed.startsWith("{") ? fromJson(trimmed) : null;
  return json ?? { questions: fromText(trimmed) };
}

export function checkQuestions(questions: string[], brand: string, domain: string): QuestionCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (questions.length === 0) errors.push("no questions found");
  if (questions.length > MAX_QUESTIONS) errors.push(`${questions.length} questions, at most ${MAX_QUESTIONS} are allowed`);
  if (questions.length > 0 && questions.length !== QUESTION_COUNT) warnings.push(`${questions.length} ${questions.length === 1 ? "question" : "questions"} instead of ${QUESTION_COUNT}`);
  questions.forEach((question, index) => {
    const n = index + 1;
    if (!question.trim()) errors.push(`question ${n} is empty`);
    if (question.length > QUESTION_MAX_CHARS) errors.push(`question ${n} is longer than ${QUESTION_MAX_CHARS} characters`);
    if (brand && namedInText(brand, domain, question)) warnings.push(`question ${n} names the brand or its domain, so the check measures nothing`);
    if (question.trim().split(/\s+/).length < 5) warnings.push(`question ${n} is very short; real buyer questions usually have 10 or more words`);
  });
  const seen = new Set<string>();
  questions.forEach((question, index) => {
    const key = question.trim().toLowerCase();
    if (seen.has(key)) errors.push(`question ${index + 1} is a duplicate`);
    seen.add(key);
  });
  return { errors, warnings };
}
