import { assertPublicHost, InputError, resolveHost, type HostResolver } from "./domain.ts";
import { htmlLanguage } from "./markets.ts";

export const HOMEPAGE_TIMEOUT_MS = 15_000;
export const HOMEPAGE_MAX_BYTES = 2 * 1024 * 1024;
export const HOMEPAGE_MAX_REDIRECTS = 3;
const TEXT_LIMIT = 6_000;

export type Identity = "checker" | "browser";
export type Homepage = { url: string; title: string; description: string; text: string; language: string | null; identity: Identity };

const IDENTITY_HEADERS: Record<Identity, Record<string, string>> = {
  checker: { "user-agent": "Mozilla/5.0 (compatible; AIVisibilityChecker/0.1; +https://github.com/pixelstrunk/ai-visibility-checker)", accept: "text/html,application/xhtml+xml" },
  browser: {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
  },
};

const BLOCKING_STATUS = new Set([401, 403, 429, 503]);
const BLOCK_PAGE = /just a moment\.\.\.|attention required!? \| cloudflare|cf-browser-verification|challenge-platform|cf_chl_|checking your browser|access denied|request unsuccessful\. incapsula|pardon our interruption|px-captcha|captcha-delivery|datadome|powered and protected by|are you a robot|verify you are (a )?human/i;
const BLOCK_PAGE_MAX_TEXT = 1_500;

export class SiteBlocked extends InputError {}

const HIDDEN_ELEMENTS = /<(script|style|noscript|svg|template|iframe|title)\b[\s\S]*?(?:<\/\1\s*>|$)/gi;

export function looksBlocked(status: number, body: string): boolean {
  if (BLOCKING_STATUS.has(status)) return true;
  if (status < 200 || status >= 300) return false;
  if (!BLOCK_PAGE.test(body)) return false;
  const visible = body.replace(HIDDEN_ELEMENTS, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return visible.length < BLOCK_PAGE_MAX_TEXT;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function codePoint(entity: string, value: number): string {
  const valid = Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
  return valid ? String.fromCodePoint(value) : entity;
}

export function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (m, n: string) => codePoint(m, Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n: string) => codePoint(m, parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function squash(text: string): string {
  return decode(text).replace(/\s+/g, " ").trim();
}

function metaContent(html: string, key: string): string {
  const tag = new RegExp(`<meta\\b(?:"[^"]*"|'[^']*'|[^'">])*?(?:name|property)\\s*=\\s*["']${key}["'](?:"[^"]*"|'[^']*'|[^'">])*>`, "i").exec(html)?.[0];
  const match = tag ? /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag) : null;
  return match ? squash(match[1] ?? match[2] ?? "") : "";
}

export function pageText(html: string, limit: number = TEXT_LIMIT): { title: string; description: string; text: string } {
  const title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const body = html
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, " ")
    .replace(HIDDEN_ELEMENTS, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|header|footer|nav|br|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decode(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, limit);
  return { title, description, text };
}

export type FetchedPage = { url: string; status: number; body: string; contentType: string };
export type PageFetcher = (url: string, identity: Identity) => Promise<FetchedPage>;

const CHARSET_SNIFF_BYTES = 2_048;

function charsetIn(text: string): string | null {
  return /charset\s*=\s*["']?\s*([a-z0-9_:.-]+)/i.exec(text)?.[1]?.toLowerCase() ?? null;
}

function decoderFor(label: string | null): TextDecoder {
  try {
    return new TextDecoder(label ?? "utf-8");
  } catch {
    return new TextDecoder();
  }
}

export function decodeBody(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, CHARSET_SNIFF_BYTES));
  const metaCharset = /<meta\b[^>]*charset[^>]*>/i.exec(head)?.[0] ?? "";
  const charset = charsetIn(contentType) ?? charsetIn(metaCharset);
  return decoderFor(charset).decode(bytes);
}

export async function readCapped(res: Response, maxBytes: number = HOMEPAGE_MAX_BYTES): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - size;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    size += Math.min(value.byteLength, room);
    if (size >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return decodeBody(Buffer.concat(chunks), res.headers.get("content-type") ?? "");
}

export function makeFetcher(resolve: HostResolver = resolveHost, request: typeof fetch = fetch): PageFetcher {
  return async (start, identity) => {
    let url = new URL(start);
    for (let hop = 0; ; hop += 1) {
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new InputError(`${start} redirects to a non web address`);
      await assertPublicHost(url.hostname, resolve);
      let res: Response;
      try {
        res = await request(url, { headers: IDENTITY_HEADERS[identity], redirect: "manual", signal: AbortSignal.timeout(HOMEPAGE_TIMEOUT_MS) });
      } catch (err) {
        const reason = err instanceof Error && err.name === "TimeoutError" ? "took too long to answer" : "could not be reached";
        throw new InputError(`${url.toString()} ${reason}`);
      }
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (location) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= HOMEPAGE_MAX_REDIRECTS) throw new InputError(`${start} redirects too often`);
        url = new URL(location, url);
        continue;
      }
      return { url: url.toString(), status: res.status, body: await readCapped(res), contentType: res.headers.get("content-type") ?? "" };
    }
  };
}

export const fetchPage: PageFetcher = makeFetcher();

async function load(domain: string, identity: Identity, fetcher: PageFetcher): Promise<FetchedPage> {
  const page = await fetcher(`https://${domain}/`, identity);
  if (looksBlocked(page.status, page.body)) throw new SiteBlocked(`${domain} blocks automated visits (${page.status})`);
  if (page.status < 200 || page.status >= 300) throw new InputError(`${domain} answered with ${page.status}`);
  if (page.contentType && !/html|xml|text\/plain/i.test(page.contentType)) throw new InputError(`${domain} is not a web page`);
  return page;
}

export async function readHomepage(domain: string, fetcher: PageFetcher = fetchPage): Promise<Homepage> {
  let identity: Identity = "checker";
  let page: FetchedPage;
  try {
    page = await load(domain, identity, fetcher);
  } catch (err) {
    if (!(err instanceof SiteBlocked)) throw err;
    identity = "browser";
    page = await load(domain, identity, fetcher);
  }
  const text = pageText(page.body);
  if (!text.text && !text.title) throw new InputError(`${domain} has no readable text on its homepage`);
  return { url: page.url, ...text, language: htmlLanguage(page.body), identity };
}
