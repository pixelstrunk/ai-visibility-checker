export type Market = { country: string; language: string; locationCode: number; label: string };

type MarketRow = Market & { tlds: string[]; fallback: boolean };

const MARKET_TABLE: MarketRow[] = [
  { language: "en", country: "US", locationCode: 2840, label: "United States, English", tlds: [], fallback: true },
  { language: "en", country: "GB", locationCode: 2826, label: "United Kingdom, English", tlds: ["uk"], fallback: false },
  { language: "de", country: "DE", locationCode: 2276, label: "Germany, German", tlds: [], fallback: true },
  { language: "de", country: "AT", locationCode: 2040, label: "Austria, German", tlds: ["at"], fallback: false },
  { language: "de", country: "CH", locationCode: 2756, label: "Switzerland, German", tlds: ["ch"], fallback: false },
  { language: "fr", country: "FR", locationCode: 2250, label: "France, French", tlds: [], fallback: true },
  { language: "fr", country: "CH", locationCode: 2756, label: "Switzerland, French", tlds: ["ch"], fallback: false },
  { language: "fr", country: "BE", locationCode: 2056, label: "Belgium, French", tlds: ["be"], fallback: false },
  { language: "es", country: "ES", locationCode: 2724, label: "Spain, Spanish", tlds: [], fallback: true },
  { language: "it", country: "IT", locationCode: 2380, label: "Italy, Italian", tlds: [], fallback: true },
  { language: "it", country: "CH", locationCode: 2756, label: "Switzerland, Italian", tlds: ["ch"], fallback: false },
  { language: "nl", country: "NL", locationCode: 2528, label: "Netherlands, Dutch", tlds: [], fallback: true },
  { language: "nl", country: "BE", locationCode: 2056, label: "Belgium, Dutch", tlds: ["be"], fallback: false },
];

export const MARKET_LANGUAGES = [...new Set(MARKET_TABLE.map((m) => m.language))];

export const LANGUAGE_NAMES: Record<string, string> = { en: "English", de: "German", fr: "French", es: "Spanish", it: "Italian", nl: "Dutch" };

function strip({ country, language, locationCode, label }: MarketRow): Market {
  return { country, language, locationCode, label };
}

export const DEFAULT_MARKET: Market = strip(MARKET_TABLE[0]!);

export function marketId(market: Market): string {
  return `${market.language}-${market.country}`;
}

export function topLevel(domain: string): string {
  return domain.toLowerCase().split(".").pop() ?? "";
}

const TLD_MARKETS: Record<string, string> = { de: "de-DE", at: "de-AT", ch: "de-CH", fr: "fr-FR", es: "es-ES", it: "it-IT", nl: "nl-NL", be: "nl-BE", uk: "en-GB" };

export function marketFromDomain(domain: string): Market | null {
  const id = TLD_MARKETS[topLevel(domain)];
  return id ? parseMarket(id) : null;
}

export function languageOf(language: string | null | undefined): string {
  return (language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
}

export function hasMarket(language: string | null | undefined): boolean {
  return MARKET_LANGUAGES.includes(languageOf(language));
}

export function chooseMarket(language: string | null | undefined, domain: string): Market {
  const lang = languageOf(language);
  if (!lang) return marketFromDomain(domain) ?? DEFAULT_MARKET;
  const rows = MARKET_TABLE.filter((m) => m.language === lang);
  if (rows.length === 0) return DEFAULT_MARKET;
  const tld = topLevel(domain);
  const byTld = rows.find((m) => m.tlds.includes(tld));
  return strip(byTld ?? rows.find((m) => m.fallback)!);
}

export function marketRows(): Market[] {
  return MARKET_TABLE.map(strip);
}

export function parseMarket(input: string): Market | null {
  const match = /^([a-z]{2})[-_]([a-z]{2})$/i.exec(input.trim());
  if (!match) return null;
  const language = match[1]!.toLowerCase();
  const country = match[2]!.toUpperCase();
  const row = MARKET_TABLE.find((m) => m.language === language && m.country === country);
  return row ? strip(row) : null;
}

export function htmlLanguage(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html)?.[0];
  const value = tag ? /\blang\s*=\s*["']?([a-zA-Z]{2,3})(?:[-_][a-zA-Z0-9]+)?/i.exec(tag)?.[1] : undefined;
  return value ? value.toLowerCase() : null;
}
