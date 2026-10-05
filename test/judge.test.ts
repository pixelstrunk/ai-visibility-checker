import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompetitorName, judgeAnswers, missingVerdicts, namedInText, parseVerdicts, summarize, topCompetitors } from "../src/core/judge.ts";
import type { Answer, Verdict } from "../src/core/types.ts";

function answer(id: string, engine: string, questionIndex: number, text: string, ok = true): Answer {
  return { id, engine, questionIndex, question: `Q${questionIndex + 1}?`, ok, text, sources: [], error: ok ? null : "boom", costUsd: 0.004 };
}

function verdict(id: string, named: boolean, extra: Partial<Verdict> = {}): Verdict {
  return { id, named, alias: null, position: null, competitors: [], ...extra };
}

test("brand names are found as whole words, domains as whole hosts", () => {
  assert.equal(namedInText("Acme", "acme.de", "Try Acme today"), true);
  assert.equal(namedInText("Acme", "acme.de", "see acme.de/pricing"), true);
  assert.equal(namedInText("Acme", "acme.de", "visit www.acme.de today"), true);
  assert.equal(namedInText("Acme", "acme.de", "(acme.de)"), true);
  assert.equal(namedInText("Cal", "cal.com", "use vocal.com"), false);
  assert.equal(namedInText("Linear Tools", "linear.de", "try linear.dev"), false);
  assert.equal(namedInText("x", "x.ai", "try box.ai"), false);
  assert.equal(namedInText("Notion Labs", "notion.so", "see notion.software"), false);
  assert.equal(namedInText("Notion Labs", "notion.so", "see notion.so"), true);
  assert.equal(namedInText("Müller", "müller.de", "Infos auf müller.de."), true);
  assert.equal(namedInText("Acme", "acme.de", "Acmeville is a town"), false);
  assert.equal(namedInText("Müller", "mueller.de", "Frag bei Müller nach."), true);
  assert.equal(namedInText("Ab", "ab.de", "ab und zu"), false);
  assert.equal(namedInText("EY", "ey.com", "EY, KPMG and PwC are the big names."), true);
  assert.equal(namedInText("EY", "ey.com", "they recommend KPMG"), false);
  assert.equal(namedInText("EY", "ey.com", "Hey, try KPMG"), false);
  assert.equal(namedInText("3M", "3m.com", "3M or Avery for labels"), true);
  assert.equal(namedInText("3M", "3m.com", "a 13M budget"), false);
  assert.equal(namedInText("O2", "o2.de", "Vodafone, O2 oder Telekom"), true);
  const [short] = judgeAnswers([answer("chatgpt-1", "chatgpt", 0, "EY, KPMG and PwC.")], [verdict("chatgpt-1", true, { position: 1, competitors: ["KPMG", "PwC"] })], "EY", "ey.com");
  assert.equal(short!.named, true);
  assert.equal(short!.position, 1);
  assert.equal(short!.warning, null);
  assert.equal(namedInText("Plausible", "plausible.io", "the most plausible option", { caseSensitive: true }), false);
  assert.equal(namedInText("Plausible", "plausible.io", "Try Plausible Analytics", { caseSensitive: true }), true);
  assert.equal(namedInText("Tim Herbig", "herbig.co", "Herbig's book", { aliases: ["Herbig"] }), true);
});

test("verdicts are validated", () => {
  const verdicts = parseVerdicts({ verdicts: [{ id: "chatgpt-1", named: true, alias: " Herbig ", position: 2, competitors: ["Beta", "https://beta.com/x", "beta.com/pricing", " ", "Gamma"] }, { id: "gemini-1", named: "yes", position: 0 }] });
  assert.deepEqual(verdicts, [
    { id: "chatgpt-1", named: true, alias: "Herbig", position: 2, competitors: ["Beta", "Gamma"] },
    { id: "gemini-1", named: false, alias: null, position: null, competitors: [] },
  ]);
  assert.throws(() => parseVerdicts([{ named: true }]), /no id/);
  assert.throws(() => parseVerdicts("nope"), /list/);
});

test("brands written like domains stay competitors", () => {
  assert.equal(isCompetitorName("Monday.com"), true);
  assert.equal(isCompetitorName("Character.ai"), true);
  assert.equal(isCompetitorName("https://monday.com"), false);
  const judged = judgeAnswers(
    [answer("chatgpt-1", "chatgpt", 0, "Use Monday.com or Asana. Source: [review.com](https://review.com/x)")],
    [verdict("chatgpt-1", false, { competitors: ["Monday.com", "Asana", "review.com"] })],
    "Acme",
    "acme.de",
  );
  assert.deepEqual(judged[0]!.competitors, ["Monday.com", "Asana"]);
});

test("with a verdict, an ordinary word is not a mention (H1)", () => {
  const [judged] = judgeAnswers([answer("chatgpt-1", "chatgpt", 0, "The most plausible option is Fathom.")], [verdict("chatgpt-1", false)], "Plausible", "plausible.io");
  assert.equal(judged!.named, false);
  assert.equal(judged!.warning, null);
});

test("without a verdict, the fallback matches the brand as written or the domain", () => {
  const judged = judgeAnswers(
    [answer("chatgpt-1", "chatgpt", 0, "The most plausible option is Fathom."), answer("gemini-1", "gemini", 0, "Plausible Analytics is privacy friendly."), answer("ai_mode-1", "ai_mode", 0, "see plausible.io")],
    null,
    "Plausible",
    "plausible.io",
  );
  assert.deepEqual(judged.map((a) => a.named), [false, true, true]);
});

test("a verdict that contradicts the text is reported, not silently overruled", () => {
  const [judged] = judgeAnswers([answer("chatgpt-1", "chatgpt", 0, "Plausible Analytics is the best choice.")], [verdict("chatgpt-1", false)], "Plausible", "plausible.io");
  assert.equal(judged!.named, false);
  assert.match(judged!.warning!, /verdict says not named/);
});

test("a named verdict without the brand in the text is rejected (H2)", () => {
  const judged = judgeAnswers(
    [answer("chatgpt-1", "chatgpt", 0, "Try Fathom or Simple Analytics."), answer("gemini-1", "gemini", 0, "Herbig's coaching is popular.")],
    [verdict("chatgpt-1", true, { position: 1 }), verdict("gemini-1", true, { alias: "Herbig", position: 1 })],
    "Tim Herbig",
    "herbig.co",
  );
  assert.equal(judged[0]!.named, false);
  assert.equal(judged[0]!.position, null);
  assert.match(judged[0]!.warning!, /never contains "Tim Herbig" or herbig\.co/);
  assert.equal(judged[1]!.named, true);
  assert.equal(judged[1]!.position, 1);
  assert.equal(judged[1]!.warning, null);
});

test("judging merges competitor spellings and drops the brand from competitors", () => {
  const answers = [answer("chatgpt-1", "chatgpt", 0, "Beta and Acme"), answer("gemini-1", "gemini", 0, "Use Acme GmbH"), answer("ai_mode-1", "ai_mode", 0, "", false)];
  const judged = judgeAnswers(answers, [verdict("chatgpt-1", true, { position: 2, competitors: ["Beta Software", "Acme", "Beta"] }), verdict("gemini-1", true)], "Acme", "acme.de");
  assert.deepEqual(judged[0]!.competitors, ["Beta Software"]);
  assert.equal(judged[0]!.position, 2);
  assert.equal(judged[1]!.named, true);
  assert.equal(judged[1]!.position, null);
  assert.equal(judged[2]!.named, null);
  assert.deepEqual(missingVerdicts(answers, [verdict("chatgpt-1", true)]), ["gemini-1"]);
});

test("summary and competitor ranking count answered answers only", () => {
  const judged = judgeAnswers(
    [answer("chatgpt-1", "chatgpt", 0, "Acme"), answer("chatgpt-2", "chatgpt", 1, "Beta"), answer("gemini-1", "gemini", 0, "Beta, Gamma"), answer("gemini-2", "gemini", 1, "", false)],
    [verdict("chatgpt-1", true, { position: 1, competitors: ["Beta"] }), verdict("chatgpt-2", false, { competitors: ["Beta"] }), verdict("gemini-1", false, { competitors: ["Beta", "Gamma"] })],
    "Acme",
    "acme.de",
  );
  assert.deepEqual(summarize(judged, ["chatgpt", "gemini", "ai_mode"]), {
    answered: 3,
    named: 1,
    perEngine: { chatgpt: { answered: 2, named: 1 }, gemini: { answered: 1, named: 0 }, ai_mode: { answered: 0, named: 0 } },
  });
  assert.deepEqual(topCompetitors(judged), [
    { name: "Beta", count: 3 },
    { name: "Gamma", count: 1 },
  ]);
});
