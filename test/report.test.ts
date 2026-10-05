import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { judgeAnswers } from "../src/core/judge.ts";
import { parseMarket } from "../src/core/markets.ts";
import { answerBody, rankingRows, REPO_URL, REPORT_UTM, reportMarkdown, sourceLink } from "../src/core/report.ts";
import type { Answer } from "../src/core/types.ts";

const questions = ["Which tool helps plumbers with invoices?", "What software do small trades use for bookkeeping?"];

function answer(engine: string, questionIndex: number, text: string, ok = true): Answer {
  return {
    id: `${engine}-${questionIndex + 1}`,
    engine,
    questionIndex,
    question: questions[questionIndex]!,
    ok,
    text,
    sources: ok ? [{ url: `https://review.com/${engine}`, domain: "review.com", title: questionIndex ? null : "Best tools" }] : [],
    error: ok ? null : "timeout",
    costUsd: 0.004,
  };
}

const answers = [answer("chatgpt", 0, "1. Beta\n2. Acme"), answer("gemini", 0, "Beta"), answer("chatgpt", 1, "Acme helps."), answer("gemini", 1, "", false)];

function build(judged: boolean) {
  const verdicts = judged
    ? [
        { id: "chatgpt-1", named: true, alias: null, position: 2, competitors: ["Beta"] },
        { id: "gemini-1", named: false, alias: null, position: null, competitors: ["Beta"] },
        { id: "chatgpt-2", named: true, alias: null, position: null, competitors: [] },
      ]
    : null;
  return reportMarkdown({
    domain: "acme.de",
    brand: "Acme",
    createdAt: "2026-10-04T10:00:00.000Z",
    market: parseMarket("de-DE")!,
    providerLabel: "DataForSEO",
    engines: ["chatgpt", "gemini"],
    questions,
    answers: judgeAnswers(answers, verdicts, "Acme", "acme.de"),
    judged,
  });
}

test("the report follows the hosted checker's layout", () => {
  const md = build(true);
  const headings = md.split("\n").filter((l) => l.startsWith("#"));
  assert.deepEqual(headings, [
    "# AI Visibility Report: acme.de",
    "## You vs. your competitors",
    "## The 2 questions we asked",
    "## The answers we got",
    `### 1. ${questions[0]}`,
    "#### ChatGPT: Named, position 2",
    "#### Gemini: Not named",
    `### 2. ${questions[1]}`,
    "#### ChatGPT: Mentioned, no ranking",
    "#### Gemini: No answer",
    "## Where to go from here",
  ]);
  assert.match(md, /\*\*Acme is named in 2 of 3 AI answers\.\*\*/);
  assert.match(md, /- ChatGPT: 2 of 2\n- Gemini: 0 of 1/);
  assert.match(md, /## You vs\. your competitors\n\n- Beta: 2\n- Acme: 2\n/);
  assert.match(md, /Market: Germany, German/);
  assert.match(md, /- \[Best tools\]\(https:\/\/review\.com\/chatgpt\)/);
  assert.match(md, /- \[review\.com\]\(https:\/\/review\.com\/chatgpt\)/);
});

test("every link in the closing section carries the GitHub UTM parameters", () => {
  const md = build(true);
  const closing = md.slice(md.indexOf("## Where to go from here"), md.indexOf("\n---\n"));
  const links = closing.match(/https:\/\/\S+/g) ?? [];
  assert.deepEqual(links.map((l) => `${new URL(l).host}${new URL(l).pathname}`), ["www.christianstrunk.com/tools/ai-visibility-checker", "www.christianstrunk.com/book/call", "www.product-bakery.com/"]);
  for (const link of links) assert.ok(link.endsWith(`?${REPORT_UTM}`), link);
});

test("the footer links back to the repository", () => {
  const md = build(true);
  const footer = md.slice(md.indexOf("\n---\n"));
  assert.equal(REPO_URL, "https://github.com/pixelstrunk/ai-visibility-checker");
  assert.match(footer, /Report by the open source \[AI Visibility Checker\]\(https:\/\/github\.com\/pixelstrunk\/ai-visibility-checker\) by Christian Strunk\./);
});

test("the open source report has no analysis or next steps", () => {
  const md = build(true);
  assert.doesNotMatch(md, /^## (What AI says about you|Your next)/m);
});

test("without verdicts the report says competitors were not judged", () => {
  const md = build(false);
  assert.doesNotMatch(md, /You vs\. your competitors/);
  assert.match(md, /Competitors were not judged/);
  assert.match(md, /#### ChatGPT: Mentioned, no ranking/);
});

test("answer text keeps its links but loses tracking and headings", () => {
  assert.equal(
    answerBody("### Top picks\nSee [x](https://x.com/a?utm_source=chatgpt.com&id=2#:~:text=hi) and https://y.com/?utm_source=openai."),
    "**Top picks**\nSee [x](https://x.com/a?id=2) and https://y.com/.",
  );
});

test("headings inside code fences stay, and a link target loses a trailing full stop", () => {
  assert.equal(answerBody("```\n# not a heading\n```\n# a heading"), "```\n# not a heading\n```\n**a heading**");
  assert.equal(answerBody("See [ProductTrio](https://www.producttrio.com/pmf-program.) now."), "See [ProductTrio](https://www.producttrio.com/pmf-program). now.");
});

test("source links survive brackets in titles and parentheses in urls", () => {
  assert.equal(sourceLink("Best [2026] tools", "a.com", "https://a.com/x_(y)"), "[Best \\[2026\\] tools](https://a.com/x_%28y%29)");
  assert.equal(sourceLink(null, "a.com", "https://a.com/"), "[a.com](https://a.com/)");
});

test("contradicting verdicts are flagged at the top and at the answer", () => {
  const md = reportMarkdown({
    domain: "acme.de",
    brand: "Acme",
    createdAt: "2026-10-04T10:00:00.000Z",
    market: parseMarket("de-DE")!,
    providerLabel: "DataForSEO",
    engines: ["chatgpt"],
    questions: [questions[0]!],
    answers: judgeAnswers([answer("chatgpt", 0, "Beta only")], [{ id: "chatgpt-1", named: true, alias: null, position: 1, competitors: [] }], "Acme", "acme.de"),
    judged: true,
  });
  assert.match(md, /Check: 1 verdict contradicts the answer text/);
  assert.match(md, /#### ChatGPT: Not named\n\n> Check: The verdict says named/);
  assert.match(md, /named in 0 of 1/);
});

test("the README closing links match the report, with the readme medium", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("## Where to go from here"), readme.indexOf("## Contributing"));
  const links = [...section.matchAll(/\((https:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]!));
  assert.deepEqual(links.map((u) => `${u.host}${u.pathname}`), ["www.christianstrunk.com/tools/ai-visibility-checker", "www.christianstrunk.com/book/call", "www.product-bakery.com/"]);
  for (const url of links) assert.equal(url.search, `?${REPORT_UTM.replace("utm_medium=report", "utm_medium=readme")}`, url.toString());
});

test("the ranking puts the brand below every competitor with as many mentions", () => {
  const tie = rankingRows("Acme", 2, [{ name: "Beta", count: 2 }, { name: "Gamma", count: 1 }]);
  assert.deepEqual(tie.map((r) => r.name), ["Beta", "Acme", "Gamma"]);
});

test("a competitor with more mentions comes first, the list stays sorted", () => {
  const behind = rankingRows("Acme", 1, [{ name: "Gamma", count: 2 }, { name: "Beta", count: 4 }, { name: "Delta", count: 1 }]);
  assert.deepEqual(behind.map((r) => `${r.name}: ${r.count}`), ["Beta: 4", "Gamma: 2", "Delta: 1", "Acme: 1"]);
  const ahead = rankingRows("Acme", 5, [{ name: "Beta", count: 3 }]);
  assert.deepEqual(ahead.map((r) => r.name), ["Acme", "Beta"]);
});
