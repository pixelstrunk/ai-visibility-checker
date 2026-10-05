import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askAll, estimateCostUsd } from "../src/core/ask.ts";
import { parseMarket, type Market } from "../src/core/markets.ts";
import type { PageFetcher } from "../src/core/homepage.ts";
import type { Llm, LlmTask } from "../src/llm/llm.ts";
import { main, parseArgs, type Context } from "../src/cli.ts";
import { dataforseo } from "../src/providers/dataforseo.ts";
import { ProviderError, type Provider } from "../src/providers/provider.ts";

const market = parseMarket("en-US")!;

type Asked = { engine: string; question: string; market: Market };

function fakeProvider(asked: Asked[]): Provider {
  return {
    id: "fake",
    label: "Fake",
    engines: ["one", "two"],
    costPerAnswerUsd: 0.01,
    setup: "",
    missingSetup: () => null,
    async ask(engine, question, m) {
      asked.push({ engine, question, market: m });
      return { text: engine === "one" ? "Try Acme or Beta." : "Beta is best.", sources: [{ url: "https://review.com/", domain: "review.com", title: "Review" }], costUsd: 0.01 };
    },
  };
}

function page(lang: string | null): PageFetcher {
  return async (url) => ({ url, status: 200, contentType: "text/html", body: `<html${lang ? ` lang="${lang}"` : ""}><head><title>Acme</title></head><body><p>Buchhaltung für Handwerker.</p></body></html>` });
}

function fakeLlm(value: (task: LlmTask) => unknown): Llm {
  return { id: "fake", model: "fake-model", json: async <T>(task: LlmTask) => ({ value: value(task) as T, costUsd: 0.001 }) };
}

function harness(overrides: Partial<Context> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "avc-"));
  const asked: Asked[] = [];
  const out: string[] = [];
  const notes: string[] = [];
  const ctx: Partial<Context> = {
    env: {},
    cwd,
    out: (text = "") => out.push(text),
    note: (text) => notes.push(text),
    fetchPage: page("de"),
    providers: [fakeProvider(asked)],
    llm: null,
    interactive: false,
    confirm: async () => true,
    now: () => new Date("2026-10-05T12:00:00Z"),
    ...overrides,
  };
  return { cwd, asked, out, notes, ctx, run: (argv: string[]) => main(argv, ctx) };
}

const QUESTIONS = ["Which bookkeeping tool works best for a small plumbing business?", "What software do craftsmen use to send invoices quickly?"];

test("arguments are parsed with values and switches", () => {
  assert.deepEqual(parseArgs(["check", "acme.com", "--brand", "Acme Inc", "--market=en-GB", "--yes"]), {
    command: "check",
    positional: ["acme.com"],
    flags: { brand: "Acme Inc", market: "en-GB", yes: true },
  });
  assert.throws(() => parseArgs(["check", "--brand"]), /needs a value/);
  assert.throws(() => parseArgs(["check", "--brand="]), /needs a value/);
  assert.throws(() => parseArgs(["check", "--brand", "--yes"]), /needs a value/);
  assert.throws(() => parseArgs(["check", "--brand", "-x"]), /needs a value/);
  assert.throws(() => parseArgs(["check", "--yes=false"]), /takes no value/);
  assert.throws(() => parseArgs(["check", "--engine", "chatgpt"]), /unknown option --engine/);
  assert.deepEqual(parseArgs(["-y", "-h", "-v"]).flags, { yes: true, help: true, version: true });
});

test("--env-file values win over the environment", async () => {
  const envFile = join(tmpdir(), "avc-probe.env");
  writeFileSync(envFile, "AVC_PROVIDER=fake\n");
  const h = harness({ env: { AVC_PROVIDER: "nonsense" } });
  assert.equal(await h.run(["providers", "--env-file", envFile]), 0);
  assert.equal(h.ctx.env!.AVC_PROVIDER, "fake");
  assert.equal(await h.run(["providers", "--env-file", join(tmpdir(), "missing.env")]), 1);
});

test("check validates the questions file before it touches the network or the disk", async () => {
  const h = harness();
  let fetched = 0;
  h.ctx.fetchPage = async (url, identity) => {
    fetched += 1;
    return page("de")(url, identity);
  };
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-missing.txt"), "--brand", "Acme"]), 1);
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt")]), 1);
  assert.match(h.notes.join("\n"), /does not exist[\s\S]*brand is missing/);
  assert.equal(fetched, 0);
  assert.equal(existsSync(join(h.cwd, "ai-visibility")), false);
});

test("check with --dir removes the files of an earlier run first", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  const h = harness();
  const dir = join(h.cwd, "again");
  await h.run(["prepare", "acme.de", "--dir", "again"]);
  writeFileSync(join(dir, "verdicts.json"), JSON.stringify({ verdicts: [{ id: "one-1", named: true, alias: null, position: 1, competitors: ["Stale"] }] }));
  writeFileSync(join(dir, "report.md"), "old");
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme", "--dir", "again"]), 0);
  assert.equal(existsSync(join(dir, "verdicts.json")), false);
  assert.doesNotMatch(readFileSync(join(dir, "report.md"), "utf8"), /Stale|^old$/m);
});

test("check and prepare never touch a folder that is not an earlier run", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  const h = harness();
  const foreign = join(h.cwd, "project");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "report.md"), "my own report");
  writeFileSync(join(foreign, "answers.json"), "my own data");
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme", "--dir", "project"]), 1);
  assert.equal(await h.run(["prepare", "acme.de", "--dir", "project"]), 1);
  assert.match(h.notes.join("\n"), /project is not empty and not an earlier run/);
  assert.equal(readFileSync(join(foreign, "report.md"), "utf8"), "my own report");
  assert.equal(readFileSync(join(foreign, "answers.json"), "utf8"), "my own data");
  assert.equal(h.asked.length, 0);
  mkdirSync(join(h.cwd, "empty"));
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme", "--dir", "empty"]), 0);
});

test("a language without a market of its own is called out in prepare and check", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  const h = harness({ fetchPage: page("pl") });
  assert.equal(await h.run(["prepare", "firma.pl"]), 0);
  assert.match(h.out.join("\n"), /Market: United States, English \(en-US\), fallback, the page declares lang="pl" which has no market of its own/);
  assert.match(h.notes.join("\n"), /warning: the page declares lang="pl", a language without a market of its own, so the check runs for United States, English\. Pass --market/);
  h.notes.length = 0;
  assert.equal(await h.run(["check", "firma.pl", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Firma"]), 0);
  assert.match(h.notes.join("\n"), /warning: the page declares lang="pl", a language without a market of its own/);
  assert.ok(h.asked.every((a) => a.market.label === "United States, English"));
  h.notes.length = 0;
  assert.equal(await h.run(["prepare", "firma.pl", "--market", "de-DE", "--dir", "forced"]), 0);
  assert.doesNotMatch(h.notes.join("\n"), /no market of its own/);
});

test("the skill passes --yes to ask, because the agent asks the user first", () => {
  const skill = readFileSync(new URL("../skills/ai-visibility-checker/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /npx -y ai-visibility-checker@0 ask <run folder> --yes/);
  assert.match(skill, /tell them the cost and wait for a yes/);
});

test("report refuses a --verdicts file that does not exist", async () => {
  const h = harness();
  const dir = join(h.cwd, "run");
  await h.run(["prepare", "acme.com", "--dir", "run"]);
  writeFileSync(
    join(dir, "answers.json"),
    JSON.stringify({ domain: "acme.com", brand: "Acme", market, provider: "fake", engines: ["chatgpt"], createdAt: "2026-10-04T00:00:00Z", questions: ["Which tool?"], answers: [], costUsd: 0 }),
  );
  assert.equal(await h.run(["report", "run", "--verdicts", join(dir, "typo.json")]), 1);
  assert.match(h.notes.join("\n"), /typo\.json does not exist/);
  assert.equal(await h.run(["report", "run"]), 0);
});

test("every question goes to every engine and failures are kept with their cost", async () => {
  const flaky: Provider = {
    ...fakeProvider([]),
    async ask(engine, question) {
      if (engine === "two" && question === "B?") throw new ProviderError("down", 0.002);
      return { text: `${engine}:${question}`, sources: [], costUsd: 0.01 };
    },
  };
  const answers = await askAll({ provider: flaky, engines: flaky.engines, questions: ["A?", "B?"], market, env: {} });
  assert.deepEqual(answers.map((a) => [a.id, a.ok, a.costUsd]), [
    ["one-1", true, 0.01],
    ["two-1", true, 0.01],
    ["one-2", true, 0.01],
    ["two-2", false, 0.002],
  ]);
  assert.equal(answers[3]!.error, "down");
});

test("a default check costs about six cents", () => {
  assert.equal(estimateCostUsd(dataforseo, 5, 3), 0.06);
});

test("check runs end to end with an LLM, and the text language moves the market", async () => {
  const h = harness({
    fetchPage: page("en"),
    llm: {
      questions: fakeLlm(() => ({ readable: true, page_language: "de", brand: "Acme", questions: QUESTIONS })),
      judge: fakeLlm(() => ({ verdicts: [{ id: "one-1", named: true, alias: null, position: 1, competitors: ["Beta"] }, { id: "two-1", named: false, alias: null, position: null, competitors: ["Beta"] }] })),
    },
  });
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake"]), 0);
  const dir = join(h.cwd, "ai-visibility", "acme.de-2026-10-05");
  assert.equal(readFileSync(join(h.cwd, "ai-visibility", ".gitignore"), "utf8"), "*\n");
  for (const file of ["site.json", "questions.json", "answers.json", "verdicts.json", "report.md"]) assert.ok(existsSync(join(dir, file)), file);
  assert.ok(h.asked.every((a) => a.market.label === "Germany, German"));
  assert.equal(h.asked.length, 4);
  assert.match(h.notes.join("\n"), /text is in "de", so the market is Germany, German instead of United States, English/);
  assert.equal(JSON.parse(readFileSync(join(dir, "site.json"), "utf8")).market.country, "DE");
  assert.match(h.out.join("\n"), /Acme is named in 2 of 4 AI answers/);
  assert.match(readFileSync(join(dir, "report.md"), "utf8"), /- Beta: 2/);
  assert.match(h.notes.join("\n"), /warning: no verdict for one-2, two-2; those answers are only checked for the brand name/);
});

test("check asks before paying in a terminal and stops on no", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  const prompts: string[] = [];
  const h = harness({ interactive: true, confirm: async (q) => (prompts.push(q), false) });
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme"]), 1);
  assert.equal(prompts.length, 1);
  assert.equal(h.asked.length, 0);
  assert.match(h.notes.join("\n"), /about \$0\.040 at Fake[\s\S]*cancelled, nothing was asked or charged/);
});

test("--yes skips the confirmation, and outside a terminal nobody is asked", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  let asked = 0;
  const yes = harness({ interactive: true, confirm: async () => (asked++, false) });
  assert.equal(await yes.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme", "--yes"]), 0);
  const piped = harness({ interactive: false, confirm: async () => (asked++, false) });
  assert.equal(await piped.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme"]), 0);
  assert.equal(asked, 0);
});

test("check without an LLM matches the brand name only", async () => {
  writeFileSync(join(tmpdir(), "avc-q.txt"), QUESTIONS.join("\n"));
  const h = harness();
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake", "--questions", join(tmpdir(), "avc-q.txt"), "--brand", "Acme"]), 0);
  assert.match(h.out.join("\n"), /Acme is named in 2 of 4/);
  assert.equal(existsSync(join(h.cwd, "ai-visibility", "acme.de-2026-10-05", "verdicts.json")), false);
});

test("check without questions and without an LLM explains what to do", async () => {
  const h = harness();
  assert.equal(await h.run(["check", "acme.de", "--provider", "fake"]), 1);
  assert.match(h.notes.join("\n"), /no questions: pass --questions FILE/);
});

test("prepare says where the market comes from and asks to check the language", async () => {
  const h = harness({ fetchPage: page(null) });
  assert.equal(await h.run(["prepare", "acme.de"]), 0);
  const text = h.out.join("\n");
  assert.match(text, /Market: Germany, German \(de-DE\), from the domain ending, the page declares no language/);
  assert.match(text, /Check the language first: is the homepage text above mainly in German\?/);
  assert.match(text, /Written in German/);
  assert.match(text, /Buchhaltung für Handwerker/);
  assert.match(text, /main offer of the website/);
});

test("ask uses the market from questions.json and prints the judging rules", async () => {
  const h = harness();
  assert.equal(await h.run(["prepare", "acme.de", "--dir", "run"]), 0);
  writeFileSync(join(h.cwd, "run", "questions.json"), JSON.stringify({ brand: "Acme", market: "de-CH", questions: QUESTIONS }));
  assert.equal(await h.run(["ask", "run", "--provider", "fake"]), 0);
  assert.ok(h.asked.every((a) => a.market.label === "Switzerland, German"));
  const text = h.out.join("\n");
  assert.match(text, /alias:/);
  assert.match(text, /Answer ids: one-1, two-1, one-2, two-2/);
  const answers = JSON.parse(readFileSync(join(h.cwd, "run", "answers.json"), "utf8"));
  assert.equal(answers.costUsd, 0.04);
});

test("ask removes the verdicts and the report of an earlier run before it writes new answers", async () => {
  const h = harness();
  await h.run(["prepare", "acme.de", "--dir", "run"]);
  writeFileSync(join(h.cwd, "run", "questions.json"), JSON.stringify({ brand: "Acme", questions: QUESTIONS }));
  writeFileSync(join(h.cwd, "run", "verdicts.json"), JSON.stringify({ verdicts: [{ id: "one-1", named: false, alias: null, position: null, competitors: ["Stale Competitor"] }] }));
  writeFileSync(join(h.cwd, "run", "report.md"), "old report");
  const declined = harness({ cwd: h.cwd, interactive: true, confirm: async () => false });
  assert.equal(await declined.run(["ask", "run", "--provider", "fake"]), 1);
  assert.ok(existsSync(join(h.cwd, "run", "verdicts.json")));
  assert.equal(await h.run(["ask", "run", "--provider", "fake"]), 0);
  assert.equal(existsSync(join(h.cwd, "run", "verdicts.json")), false);
  assert.equal(existsSync(join(h.cwd, "run", "report.md")), false);
  assert.equal(await h.run(["report", "run"]), 0);
  assert.doesNotMatch(readFileSync(join(h.cwd, "run", "report.md"), "utf8"), /Stale Competitor/);
});

test("ask refuses an unknown market in questions.json", async () => {
  const h = harness();
  await h.run(["prepare", "acme.de", "--dir", "run"]);
  writeFileSync(join(h.cwd, "run", "questions.json"), JSON.stringify({ brand: "Acme", market: "xx-YY", questions: QUESTIONS }));
  assert.equal(await h.run(["ask", "run", "--provider", "fake"]), 1);
  assert.equal(h.asked.length, 0);
});

test("report turns a run folder into report.md and flags contradictions", async () => {
  const h = harness();
  const dir = join(h.cwd, "run");
  const answer = (engine: string, text: string) => ({ id: `${engine}-1`, engine, questionIndex: 0, question: "Which tool?", ok: true, text, sources: [], error: null, costUsd: 0.004 });
  await h.run(["prepare", "acme.com", "--dir", "run"]);
  writeFileSync(
    join(dir, "answers.json"),
    JSON.stringify({ domain: "acme.com", brand: "Acme", market, provider: "fake", engines: ["chatgpt", "gemini"], createdAt: "2026-10-04T00:00:00Z", questions: ["Which tool?"], answers: [answer("chatgpt", "Acme or Beta"), answer("gemini", "Beta")], costUsd: 0.008 }),
  );
  writeFileSync(join(dir, "verdicts.json"), JSON.stringify({ verdicts: [{ id: "chatgpt-1", named: true, position: 1, competitors: ["Beta"] }, { id: "gemini-1", named: true, position: 1, competitors: ["Beta"] }] }));
  assert.equal(await h.run(["report", "run"]), 0);
  const md = readFileSync(join(dir, "report.md"), "utf8");
  assert.match(md, /Acme is named in 1 of 2 AI answers/);
  assert.match(md, /- Beta: 2/);
  assert.match(md, /Answers from: Fake/);
  assert.match(h.notes.join("\n"), /check gemini-1: The verdict says named/);
});

test("a broken answers.json is reported, not crashed on", async () => {
  const h = harness();
  await h.run(["prepare", "acme.com", "--dir", "run"]);
  writeFileSync(join(h.cwd, "run", "answers.json"), "{ not json");
  assert.equal(await h.run(["report", "run"]), 1);
  writeFileSync(join(h.cwd, "run", "answers.json"), JSON.stringify({ brand: "Acme" }));
  assert.equal(await h.run(["report", "run"]), 1);
  assert.match(h.notes.join("\n"), /could not read[\s\S]*is incomplete/);
});

test("usage errors exit with 2", async () => {
  const h = harness();
  assert.equal(await h.run(["check", "localhost"]), 2);
  assert.equal(await h.run(["nonsense"]), 2);
  assert.equal(await h.run(["check", "acme.com", "--market", "xx-YY"]), 2);
});

test("the help lists every option", async () => {
  const h = harness();
  await h.run(["--help"]);
  for (const option of ["--questions", "--brand", "--market", "--provider", "--engines", "--llm", "--verdicts", "--dir", "--env-file", "--yes"]) assert.match(h.out.join("\n"), new RegExp(option));
});
