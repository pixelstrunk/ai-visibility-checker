import { domainToASCII } from "node:url";
import { baseNameKey, mergeNameLists, nameKey } from "./names.ts";
import type { Answer, JudgedAnswer, Verdict } from "./types.ts";

const BARE_DOMAIN = /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;
const MAX_COMPETITORS = 10;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SHORT_NAME = 3;

function containsName(name: string, text: string, caseSensitive: boolean): boolean {
  const needle = name.trim();
  if (!needle) return false;
  const exact = caseSensitive || needle.length < SHORT_NAME;
  return new RegExp(`(?<![\\p{L}\\p{N}]|[\\p{L}\\p{N}]\\.)${escapeRegex(needle)}(?![\\p{L}\\p{N}]|\\.[\\p{L}\\p{N}])`, exact ? "u" : "iu").test(text);
}

function containsDomain(domain: string, text: string): boolean {
  const spellings = [...new Set([domain, domainToASCII(domain)].filter(Boolean))];
  return spellings.some((d) => new RegExp(`(?<![\\p{L}\\p{N}-])${escapeRegex(d)}(?![\\p{L}\\p{N}-]|\\.[\\p{L}\\p{N}])`, "iu").test(text));
}

export function namedInText(brand: string, domain: string, text: string, options: { caseSensitive?: boolean; aliases?: string[] } = {}): boolean {
  if (domain && containsDomain(domain, text)) return true;
  const caseSensitive = options.caseSensitive ?? false;
  return [brand, ...(options.aliases ?? [])].some((name) => containsName(name, text, caseSensitive));
}

export function proseOf(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label: string) => (BARE_DOMAIN.test(label.trim()) ? " " : label))
    .replace(/https?:\/\/\S+/g, " ");
}

export function isCompetitorName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = value.trim();
  return name.length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(name) && !/^[^\s/]+\.[a-z]{2,}\/\S/i.test(name);
}

function invalid(id: string, field: string, rule: string): Error {
  return new Error(`verdict ${id}: "${field}" ${rule}`);
}

export function parseVerdicts(data: unknown): Verdict[] {
  const list = Array.isArray(data) ? data : Array.isArray((data as { verdicts?: unknown })?.verdicts) ? (data as { verdicts: unknown[] }).verdicts : null;
  if (!list) throw new Error('verdicts must be a list or an object with a "verdicts" list');
  return list.map((raw, index) => {
    const v = (raw ?? {}) as Record<string, unknown>;
    if (typeof v.id !== "string" || !v.id) throw new Error(`verdict ${index + 1} has no id`);
    if (typeof v.named !== "boolean") throw invalid(v.id, "named", "must be true or false");
    if (v.position != null && (typeof v.position !== "number" || !Number.isInteger(v.position))) throw invalid(v.id, "position", "must be a whole number or null");
    if (v.competitors != null && !Array.isArray(v.competitors)) throw invalid(v.id, "competitors", "must be a list of names");
    if (v.alias != null && typeof v.alias !== "string") throw invalid(v.id, "alias", "must be a name or null");
    const position = typeof v.position === "number" && v.position > 0 ? v.position : null;
    const competitors = Array.isArray(v.competitors) ? v.competitors.filter(isCompetitorName).map((c) => c.trim().slice(0, 120)) : [];
    const alias = typeof v.alias === "string" && v.alias.trim() ? v.alias.trim().slice(0, 120) : null;
    return { id: v.id, named: v.named, alias, position, competitors };
  });
}

const MIN_ALIAS = 3;

export function usableAlias(alias: string | null, brand: string, domain: string): string | null {
  if (!alias || alias.length < MIN_ALIAS) return null;
  if (/^[\p{Ll}\s]+$/u.test(alias) && !brand.toLowerCase().includes(alias) && !domain.toLowerCase().includes(alias)) return null;
  return alias;
}

function keepCompetitor(name: string, answer: Answer, brand: string, domain: string, alias: string | null): boolean {
  const key = baseNameKey(name);
  if (!key || key === baseNameKey(brand) || (alias && key === baseNameKey(alias))) return false;
  if (namedInText(brand, domain, name)) return false;
  if (BARE_DOMAIN.test(name)) return proseOf(answer.text).toLowerCase().includes(name.toLowerCase().replace(/^www\./, ""));
  return true;
}

function writtenWithCapitals(brand: string): boolean {
  return brand !== brand.toLowerCase();
}

function judgeOne(answer: Answer, verdict: Verdict | undefined, brand: string, domain: string): JudgedAnswer {
  if (!answer.ok) return { ...answer, named: null, position: null, competitors: [], warning: null };
  const alias = usableAlias(verdict?.alias ?? null, brand, domain);
  const competitors = (verdict?.competitors ?? []).filter((c) => keepCompetitor(c, answer, brand, domain, alias));
  const prose = proseOf(answer.text);
  const strict = namedInText(brand, domain, prose, { caseSensitive: writtenWithCapitals(brand) });
  if (!verdict) return { ...answer, named: strict, position: null, competitors, warning: null };
  if (verdict.named) {
    const aliases = alias ? [alias] : [];
    if (namedInText(brand, domain, prose, { aliases })) return { ...answer, named: true, position: verdict.position, competitors, warning: null };
    const said = alias ? `"${brand}", "${alias}" or ${domain}` : `"${brand}" or ${domain}`;
    return { ...answer, named: false, position: null, competitors, warning: `The verdict says named, but the text never contains ${said}. Counted as not named.` };
  }
  const warning = strict ? `The text contains "${brand}" or ${domain}, but the verdict says not named. Counted as not named; check whether it means the brand.` : null;
  return { ...answer, named: false, position: null, competitors, warning };
}

export function judgeAnswers(answers: Answer[], verdicts: Verdict[] | null, brand: string, domain: string): JudgedAnswer[] {
  const byId = new Map((verdicts ?? []).map((v) => [v.id, v]));
  const judged = answers.map((answer) => judgeOne(answer, verdicts ? byId.get(answer.id) : undefined, brand, domain));
  const merged = mergeNameLists(judged.map((a) => a.competitors));
  return judged.map((a, i) => ({ ...a, competitors: merged[i]!.slice(0, MAX_COMPETITORS) }));
}

export function missingVerdicts(answers: Answer[], verdicts: Verdict[]): string[] {
  const ids = new Set(verdicts.map((v) => v.id));
  return answers.filter((a) => a.ok && !ids.has(a.id)).map((a) => a.id);
}

export type Summary = { answered: number; named: number; perEngine: Record<string, { answered: number; named: number }> };

export function summarize(answers: JudgedAnswer[], engines: string[]): Summary {
  const perEngine: Summary["perEngine"] = {};
  for (const engine of engines) perEngine[engine] = { answered: 0, named: 0 };
  let answered = 0;
  let named = 0;
  for (const answer of answers) {
    if (!answer.ok) continue;
    const bucket = (perEngine[answer.engine] ??= { answered: 0, named: 0 });
    bucket.answered += 1;
    answered += 1;
    if (answer.named) {
      bucket.named += 1;
      named += 1;
    }
  }
  return { answered, named, perEngine };
}

export function topCompetitors(answers: JudgedAnswer[], limit = 3): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const answer of answers) {
    if (!answer.ok) continue;
    for (const name of answer.competitors) {
      const key = nameKey(name);
      const entry = counts.get(key) ?? { name, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
