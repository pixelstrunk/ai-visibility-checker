const UMBRELLA_BRANDS = new Set(["google", "microsoft", "adobe", "amazon", "apple", "meta", "salesforce", "oracle", "ibm", "sap", "hubspot", "atlassian", "zoho"]);

export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
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
    const candidates = [...new Set([...asSurname, ...asPrefix])];
    if (candidates.length === 1) target.set(short, candidates[0]!);
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
