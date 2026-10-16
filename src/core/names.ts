const UMBRELLA_BRANDS = new Set(["google", "microsoft", "adobe", "amazon", "apple", "meta", "salesforce", "oracle", "ibm", "sap", "hubspot", "atlassian", "zoho"]);

const PLAIN_TOP_LEVELS = new Set(["com", "net", "org", "io", "ai", "co", "app", "de", "at", "ch", "fr", "es", "it", "nl", "be", "uk", "eu", "us"]);
const SINGLE_DOMAIN = /^([\p{L}\p{N}-]+)\.([a-z]{2,24})$/iu;
const LEGAL_FORMS = new Set(["gmbh", "ag", "ug", "kg", "ohg", "mbh", "inc", "llc", "ltd", "limited", "corp", "corporation", "co", "plc", "sa", "sas", "sarl", "srl", "spa", "bv", "nv", "se", "oy", "ab", "as", "aps"]);

export function nameKey(name: string): string {
  const domain = SINGLE_DOMAIN.exec(name.trim());
  if (domain && !PLAIN_TOP_LEVELS.has(domain[2]!.toLowerCase())) return `${nameKey(domain[1]!)}.${domain[2]!.toLowerCase()}`;
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function baseNameKey(name: string): string {
  const parts = nameKey(name).split(" ").filter(Boolean);
  while (parts.length > 1 && LEGAL_FORMS.has(parts[parts.length - 1]!)) parts.pop();
  return parts.join(" ");
}

function tokens(key: string): string[] {
  return key.split(" ").filter(Boolean);
}

function startsWith(long: string[], short: string[]): boolean {
  return short.every((t, i) => long[i] === t);
}

function endsWith(long: string[], short: string[]): boolean {
  return short.every((t, i) => long[long.length - short.length + i] === t);
}

function canonicalKeys(keys: string[]): Map<string, string> {
  const unique = [...new Set(keys)].filter(Boolean);
  const target = new Map<string, string>(unique.map((k) => [k, k]));
  for (const short of unique) {
    const s = tokens(short);
    if (short.length < 3) continue;
    const longer = unique.filter((k) => k !== short && tokens(k).length > s.length);
    const asSurname = s.length === 1 ? longer.filter((k) => endsWith(tokens(k), s)) : [];
    const asPrefix = UMBRELLA_BRANDS.has(short) ? [] : longer.filter((k) => startsWith(tokens(k), s));
    const candidates = [...new Set([...asSurname, ...asPrefix])].sort((a, b) => tokens(b).length - tokens(a).length);
    const longest = candidates[0];
    const chain = longest !== undefined && candidates.every((c) => startsWith(tokens(longest), tokens(c)) || endsWith(tokens(longest), tokens(c)));
    if (chain) target.set(short, longest);
  }
  for (const [k, v] of target) {
    let end = v;
    while (target.get(end) !== end) end = target.get(end)!;
    target.set(k, end);
  }
  return target;
}

export function mergeNameLists(lists: string[][]): string[][] {
  const target = canonicalKeys(lists.flat().map(nameKey));
  const spellings = new Map<string, Map<string, number>>();
  for (const name of lists.flat()) {
    const key = target.get(nameKey(name));
    if (!key || nameKey(name) !== key) continue;
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(name.trim(), (counts.get(name.trim()) ?? 0) + 1);
    spellings.set(key, counts);
  }
  const display = (key: string) => [...(spellings.get(key) ?? new Map([[key, 1]])).entries()].sort((a, b) => b[1] - a[1])[0]![0];
  return lists.map((list) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of list) {
      const key = target.get(nameKey(name));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(display(key));
    }
    return out;
  });
}
