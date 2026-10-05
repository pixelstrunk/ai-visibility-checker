import { test } from "node:test";
import assert from "node:assert/strict";
import { anthropicBody, anthropicLlm, DEFAULT_MODELS, llmFromEnv, MAX_TOKENS, openaiBody, openaiLlm, type Llm, type LlmTask } from "../src/llm/llm.ts";
import { judgeWithLlm, QUESTIONS_SCHEMA, VERDICTS_SCHEMA, writeQuestions } from "../src/llm/tasks.ts";
import { parseMarket } from "../src/core/markets.ts";
import type { Answer, SiteFile } from "../src/core/types.ts";

const task: LlmTask = { name: "buyer_questions", system: "sys", user: "usr", schema: QUESTIONS_SCHEMA };

function fakeFetch(body: unknown, status = 200, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.url = url;
    seen.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test("Anthropic requests use structured output, never a forced tool call (B1)", () => {
  for (const model of [DEFAULT_MODELS.anthropic.questions, DEFAULT_MODELS.anthropic.judge]) {
    const body = anthropicBody(task, model);
    assert.equal(body.model, model);
    assert.equal(body.max_tokens, MAX_TOKENS);
    assert.ok(MAX_TOKENS >= 16_000);
    assert.equal("tool_choice" in body, false);
    assert.equal("tools" in body, false);
    assert.equal("thinking" in body, false);
    assert.deepEqual(body.output_config, { format: { type: "json_schema", schema: QUESTIONS_SCHEMA } });
  }
});

test("OpenAI requests use a strict JSON schema", () => {
  const body = openaiBody(task, "gpt-5-mini");
  assert.equal(body.max_completion_tokens, MAX_TOKENS);
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "buyer_questions", strict: true, schema: QUESTIONS_SCHEMA } });
  assert.equal("temperature" in body, false);
});

test("every object in the schemas is closed, as structured output requires", () => {
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object") {
      assert.equal(obj.additionalProperties, false);
      assert.deepEqual([...(obj.required as string[])].sort(), Object.keys(obj.properties as object).sort());
    }
    Object.values(obj).forEach(walk);
  };
  walk(QUESTIONS_SCHEMA);
  walk(VERDICTS_SCHEMA);
});

test("Anthropic answers are read from the text blocks, thinking is skipped", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const llm = anthropicLlm("key", "claude-sonnet-5-5", fakeFetch({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"a":1}' }], usage: { input_tokens: 1000, output_tokens: 100 } }, 200, seen));
  const result = await llm.json<{ a: number }>(task);
  assert.deepEqual(result.value, { a: 1 });
  assert.equal(result.costUsd, (1000 * 2 + 100 * 10) / 1_000_000);
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal((seen.init!.headers as Record<string, string>)["x-api-key"], "key");
});

test("Anthropic failures are reported clearly", async () => {
  await assert.rejects(anthropicLlm("k", "m", fakeFetch({ error: { message: "tool_choice not supported" } }, 400)).json(task), /400: tool_choice not supported/);
  await assert.rejects(anthropicLlm("k", "m", fakeFetch({ stop_reason: "max_tokens", content: [] })).json(task), /cut the answer off/);
  await assert.rejects(anthropicLlm("k", "m", fakeFetch({ stop_reason: "refusal", content: [] })).json(task), /declined/);
  await assert.rejects(anthropicLlm("k", "m", fakeFetch({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] })).json(task), /not valid JSON/);
  await assert.rejects(anthropicLlm("k", "m", fakeFetch("<html>", 502), async () => undefined).json(task), /status 502 but no JSON/);
});

test("overloaded or rate limited LLM calls are retried once after a pause, timeouts and client errors are not", async () => {
  const ok = { stop_reason: "end_turn", content: [{ type: "text", text: '{"a":1}' }], usage: {} };
  const pauses: number[] = [];
  const sleep = async (ms: number) => void pauses.push(ms);
  for (const status of [429, 500, 529, 599]) {
    let calls = 0;
    const flaky = (async () => (++calls === 1 ? new Response("busy", { status, headers: status === 429 ? { "retry-after": "5" } : {} }) : new Response(JSON.stringify(ok), { status: 200 }))) as unknown as typeof fetch;
    assert.deepEqual((await anthropicLlm("k", "m", flaky, sleep).json<{ a: number }>(task)).value, { a: 1 }, String(status));
    assert.equal(calls, 2, String(status));
  }
  assert.deepEqual(pauses, [5_000, 2_000, 2_000, 2_000]);
  let twice = 0;
  const down = (async () => (twice++, new Response(JSON.stringify({ error: { message: "overloaded" } }), { status: 529 }))) as unknown as typeof fetch;
  await assert.rejects(anthropicLlm("k", "m", down, sleep).json(task), /529: overloaded/);
  assert.equal(twice, 2);
  assert.equal(pauses.length, 5);
  let bad = 0;
  const invalid = (async () => (bad++, new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }))) as unknown as typeof fetch;
  await assert.rejects(openaiLlm("k", "m", invalid).json(task), /400: bad request/);
  assert.equal(bad, 1);
  let slow = 0;
  const timeout = (async () => {
    slow += 1;
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  }) as unknown as typeof fetch;
  await assert.rejects(anthropicLlm("k", "m", timeout).json(task), /did not answer within 300 seconds/);
  assert.equal(slow, 1);
});

test("OpenAI answers are parsed from the message content", async () => {
  const llm = openaiLlm("key", "gpt-5-mini", fakeFetch({ choices: [{ finish_reason: "stop", message: { content: '{"b":2}' } }], usage: { prompt_tokens: 10_000, completion_tokens: 2_000 } }));
  const result = await llm.json<{ b: number }>(task);
  assert.deepEqual(result.value, { b: 2 });
  assert.equal(result.costUsd, (10_000 * 0.25 + 2_000 * 2) / 1_000_000);
  await assert.rejects(openaiLlm("k", "m", fakeFetch({ choices: [{ finish_reason: "length", message: {} }] })).json(task), /cut the answer off/);
});

test("the LLM comes from the environment, Anthropic first", () => {
  assert.equal(llmFromEnv(undefined, {}), null);
  const both = llmFromEnv(undefined, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })!;
  assert.deepEqual([both.questions.id, both.questions.model, both.judge.model], ["anthropic", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"]);
  assert.equal(llmFromEnv("openai", { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o" })!.questions.id, "openai");
  assert.equal(llmFromEnv(undefined, { ANTHROPIC_API_KEY: "a", AVC_LLM_MODEL: "claude-opus-5-5" })!.judge.model, "claude-opus-5-5");
  assert.equal(llmFromEnv("none", { ANTHROPIC_API_KEY: "a" }), null);
  assert.throws(() => llmFromEnv("anthropic", {}), /needs ANTHROPIC_API_KEY/);
});

function recordingLlm(value: unknown, calls: LlmTask[]): Llm {
  return {
    id: "fake",
    model: "fake-model",
    async json<T>(t: LlmTask) {
      calls.push(t);
      return { value: value as T, costUsd: 0.01 };
    },
  };
}

const site: SiteFile = { domain: "sipgate.com", url: "https://sipgate.com/", title: "sipgate", description: "", text: "Telefonie für Teams", language: "en", market: parseMarket("en-US")!, readAt: "" };

test("the model's reading of the text language wins over the html lang (H3)", async () => {
  const calls: LlmTask[] = [];
  const llm = recordingLlm({ readable: true, page_language: "de", brand: "sipgate", questions: ["Welche Telefonanlage passt für ein kleines Team im Büro?"] }, calls);
  const written = await writeQuestions(llm, site, null);
  assert.equal(written.market.label, "Germany, German");
  assert.match(calls[0]!.system, /main language of the homepage text/);
  assert.match(calls[0]!.system, /de: German for "Germany, German"/);
  const forced = await writeQuestions(llm, site, parseMarket("de-AT"));
  assert.equal(forced.market.label, "Austria, German");
  assert.match(calls[1]!.system, /Written in German, the way people in the market "Austria, German"/);
});

test("the language is an enum, an unexpected code keeps the detected market, other falls back to the United States", async () => {
  assert.deepEqual((QUESTIONS_SCHEMA.properties.page_language as { enum: string[] }).enum, ["en", "de", "fr", "es", "it", "nl", "other"]);
  const german: SiteFile = { ...site, domain: "sipgate.de", language: "de", market: parseMarket("de-DE")! };
  const written = (language: string) => writeQuestions(recordingLlm({ readable: true, page_language: language, brand: "sipgate", questions: ["Welche  Telefonanlage\npasst?"] }, []), german, null);
  assert.equal((await written("German")).market.label, "Germany, German");
  assert.equal((await written("deu")).market.label, "Germany, German");
  assert.equal((await written("other")).market.label, "United States, English");
  assert.equal((await written("fr")).market.label, "France, French");
  assert.deepEqual((await written("de")).questions, ["Welche Telefonanlage passt?"]);
});

test("an unreadable homepage stops the check", async () => {
  await assert.rejects(writeQuestions(recordingLlm({ readable: false, page_language: "en", brand: "", questions: [] }, []), site, null), /does not make clear/);
});

test("the judge sees only answered answers and the alias rule", async () => {
  const calls: LlmTask[] = [];
  const answers: Answer[] = [
    { id: "chatgpt-1", engine: "chatgpt", questionIndex: 0, question: "Q?", ok: true, text: "sipgate", sources: [], error: null, costUsd: 0 },
    { id: "gemini-1", engine: "gemini", questionIndex: 0, question: "Q?", ok: false, text: "", sources: [], error: "x", costUsd: 0 },
  ];
  await judgeWithLlm(recordingLlm({ verdicts: [] }, calls), "sipgate", "sipgate.com", answers);
  assert.match(calls[0]!.user, /<answer id="chatgpt-1">/);
  assert.doesNotMatch(calls[0]!.user, /gemini-1/);
  assert.match(calls[0]!.system, /alias:/);
  assert.match(calls[0]!.system, /Only true if that name literally appears/);
});

test("questions stay with the main offer, in every path that writes them", async () => {
  const calls: LlmTask[] = [];
  const llm = recordingLlm({ readable: true, page_language: "en", brand: "sipgate", questions: ["Which phone system works best for a small office team?"] }, calls);
  await writeQuestions(llm, site, null);
  await writeQuestions(llm, site, parseMarket("en-GB"));
  for (const call of calls) {
    assert.match(call.system, /main offer of the website: what the top of the homepage leads with/);
    assert.match(call.system, /pick that main offer and stay in its one category/);
    assert.match(call.system, /Do not carry over side terms from the homepage/);
  }
});
