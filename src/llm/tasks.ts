import { chooseMarket, DEFAULT_MARKET, MARKET_LANGUAGES, type Market } from "../core/markets.ts";
import { normalizeQuestion, QUESTION_COUNT } from "../core/questions.ts";
import { JUDGE_RULES, marketLanguage, questionRules } from "../core/rules.ts";
import type { Answer, SiteFile } from "../core/types.ts";
import type { Llm } from "./llm.ts";

const ANSWER_CHARS = 6_000;

export const OTHER_LANGUAGE = "other";

export const QUESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "page_language", "brand", "questions"],
  properties: {
    readable: { type: "boolean", description: "False if the homepage does not make clear what the company sells." },
    page_language: { type: "string", enum: [...MARKET_LANGUAGES, OTHER_LANGUAGE], description: `The main language of the homepage text as ISO 639-1 code, or "${OTHER_LANGUAGE}" for any language not listed.` },
    brand: { type: "string", description: "The company, product or person name as buyers say it." },
    questions: { type: "array", items: { type: "string" }, description: `Exactly ${QUESTION_COUNT} questions.` },
  },
};

export const VERDICTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "named", "alias", "position", "competitors"],
        properties: {
          id: { type: "string", description: "The answer id exactly as given." },
          named: { type: "boolean" },
          alias: { anyOf: [{ type: "string" }, { type: "null" }] },
          position: { anyOf: [{ type: "integer" }, { type: "null" }] },
          competitors: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};

export function languageByText(domain: string): string {
  const options = MARKET_LANGUAGES.map((l) => {
    const market = chooseMarket(l, domain);
    return `${l}: ${marketLanguage(market)} for "${market.label}"`;
  }).join("; ");
  return `Written in the main language of the homepage text, which you report as page_language: ${options}; ${OTHER_LANGUAGE} (any language not listed): ${marketLanguage(DEFAULT_MARKET)} for "${DEFAULT_MARKET.label}". Use the language people there actually type, not a translation from English.`;
}

export function marketFromLanguage(language: string, site: SiteFile): Market {
  if (MARKET_LANGUAGES.includes(language)) return chooseMarket(language, site.domain);
  return language === OTHER_LANGUAGE ? DEFAULT_MARKET : site.market;
}

export type WrittenQuestions = { brand: string; questions: string[]; language: string; market: Market; costUsd: number | null };

export async function writeQuestions(llm: Llm, site: SiteFile, forced: Market | null): Promise<WrittenQuestions> {
  const rules = forced ? questionRules(forced) : questionRules(site.market, languageByText(site.domain));
  const system = `You read a company's homepage. First say whether it is clear what the company sells, report the main language of the homepage text and give the brand name. Then:\n\n${rules}`;
  const user = `Domain: ${site.domain}\nTitle: ${site.title}\nDescription: ${site.description}\n\nHomepage text:\n${site.text}`;
  const { value, costUsd } = await llm.json<{ readable: boolean; page_language: string; brand: string; questions: string[] }>({ name: "buyer_questions", system, user, schema: QUESTIONS_SCHEMA });
  if (!value.readable) throw new Error(`the homepage of ${site.domain} does not make clear what the company sells; pass your own questions with --questions`);
  const language = value.page_language.trim().toLowerCase();
  const market = forced ?? marketFromLanguage(language, site);
  return { brand: value.brand.trim(), questions: value.questions.map(normalizeQuestion).filter(Boolean).slice(0, QUESTION_COUNT), language, market, costUsd };
}

export async function judgeWithLlm(llm: Llm, brand: string, domain: string, answers: Answer[]): Promise<{ verdicts: unknown; costUsd: number | null }> {
  const usable = answers.filter((a) => a.ok);
  if (usable.length === 0) return { verdicts: [], costUsd: 0 };
  const system = `You read answers that AI assistants gave to buyer questions.\n\n${JUDGE_RULES}\n\nRecord every answer id you were given.`;
  const blocks = usable.map((a) => `<answer id="${a.id}">\nQuestion: ${a.question}\nText:\n${a.text.slice(0, ANSWER_CHARS)}\n</answer>`);
  const user = `Brand: ${brand}\nDomain: ${domain}\n\n${blocks.join("\n\n")}`;
  const { value, costUsd } = await llm.json<{ verdicts: unknown }>({ name: "answer_verdicts", system, user, schema: VERDICTS_SCHEMA });
  return { verdicts: value.verdicts, costUsd };
}
