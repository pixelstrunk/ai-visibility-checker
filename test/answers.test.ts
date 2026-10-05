import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAnswersFile } from "../src/core/answers.ts";
import { parseMarket } from "../src/core/markets.ts";

const market = parseMarket("de-DE")!;
const answer = { id: "chatgpt-1", engine: "chatgpt", questionIndex: 0, question: "Which tool?", ok: true, text: "Acme or Beta", sources: [{ url: "https://r.com/", domain: "r.com", title: null }], error: null, costUsd: 0.004 };
const file = { domain: "acme.de", brand: "Acme", market, provider: "dataforseo", engines: ["chatgpt"], createdAt: "2026-10-05T00:00:00Z", questions: ["Which tool?"], answers: [answer], costUsd: 0.004 };

test("a complete answers file passes through unchanged", () => {
  assert.deepEqual(parseAnswersFile(file), file);
});

test("every missing or wrong field is named", () => {
  const without = (key: string, inner?: Record<string, unknown>) => {
    const copy: Record<string, unknown> = { ...file, ...inner };
    delete copy[key];
    return copy;
  };
  assert.throws(() => parseAnswersFile(without("market")), /market must be an object/);
  assert.throws(() => parseAnswersFile(without("createdAt")), /createdAt must be a string/);
  assert.throws(() => parseAnswersFile({ ...file, brand: "" }), /brand must not be empty/);
  assert.throws(() => parseAnswersFile({ ...file, market: { ...market, locationCode: "2276" } }), /market\.locationCode must be a number/);
  assert.throws(() => parseAnswersFile({ ...file, answers: [{ ...answer, ok: "yes" }] }), /answers\[0\]\.ok must be true or false/);
  assert.throws(() => parseAnswersFile({ ...file, answers: [{ ...answer, sources: [{ title: "no url" }] }] }), /answers\[0\]\.sources\[0\]\.url must be a string/);
  assert.throws(() => parseAnswersFile({ ...file, answers: [{ ...answer, questionIndex: 3 }] }), /points to question 4, but there are only 1/);
  assert.throws(() => parseAnswersFile("nope"), /must be an object/);
  assert.throws(() => parseAnswersFile(null), /must be an object/);
});

test("optional fields get their defaults", () => {
  const sparse = { ...file, costUsd: undefined, answers: [{ id: "chatgpt-1", engine: "chatgpt", questionIndex: 0, ok: false }] };
  const parsed = parseAnswersFile(sparse);
  assert.equal(parsed.costUsd, 0);
  assert.deepEqual(parsed.answers[0], { id: "chatgpt-1", engine: "chatgpt", questionIndex: 0, question: "", ok: false, text: "", sources: [], error: null, costUsd: 0 });
});
