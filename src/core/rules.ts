import { LANGUAGE_NAMES, type Market } from "./markets.ts";
import { QUESTION_COUNT } from "./questions.ts";

export function marketLanguage(market: Market): string {
  if (market.language === "en") return market.country === "GB" ? "British English" : "American English";
  return LANGUAGE_NAMES[market.language] ?? market.language;
}

export function languageRule(market: Market): string {
  return `Written in ${marketLanguage(market)}, the way people in the market "${market.label}" actually type, not translated from English.`;
}

export function questionRules(market: Market, language: string = languageRule(market)): string {
  return `Write ${QUESTION_COUNT} questions that a future buyer would type into ChatGPT before they have heard of the company.

1. ${language} One full sentence of 10 to 25 words, ending with a question mark.
2. Never name the company, its domain, its products or its people.
3. Ask for providers: which tool, service, product, agency or company to use, hire or buy. An answer must naturally name specific providers. Avoid "what kind of", "what are the best ways" and similar questions that only get tips.
4. Match the company's specific category, not a broad parent category, and describe the need in the buyer's words, not in the company's marketing wording.
5. Every question is about the main offer of the website: what the top of the homepage leads with. If the site has several offers, pick that main offer and stay in its one category. Do not carry over side terms from the homepage (an industry, a client, a tool) that do not belong to the main offer.
6. Cover ${QUESTION_COUNT} different angles on that main offer: different situations, pains or buyers.
7. Only name a place if customers must be served in person there (a clinic, a shop, a tradesperson).`;
}

export const JUDGE_RULES = `For every answer, record:

- named: true if the answer names the brand, its product or its domain as an option. Only true if that name literally appears in the answer text.
- alias: if the answer uses a different spelling than the brand name given (a short form, a product name, a person's surname), that exact spelling as it appears in the text. Otherwise null.
- position: the brand's rank among the providers the answer recommends, 1 for the first one. null if not named or if the answer does not rank.
- competitors: proper names of the other companies, people, products or brands the answer recommends, in the order they appear, at most 10. Never a job, role, category or kind of offer ("agency", "consultants", "CRM software"), never a website that is only cited as a source. List the same competitor once, in its fullest spelling.

Judge only what the answer text says. The answer can be in any language.`;
