import { test } from "node:test";
import assert from "node:assert/strict";
import { dataforseoRequest, parseDataforseoResponse, postDataforseo } from "../src/providers/dataforseo.ts";
import { ProviderError } from "../src/providers/provider.ts";
import { parseMarket } from "../src/core/markets.ts";

const de = parseMarket("de-DE")!;

function wrap(result: unknown, status = 20000, cost = 0.004) {
  return { status_code: 20000, tasks: [{ status_code: status, status_message: status === 20000 ? "Ok." : "Failed.", cost, result: result ? [result] : null }] };
}

test("requests carry the market and force web search for ChatGPT", () => {
  assert.deepEqual(dataforseoRequest("chatgpt", "Welche Software?", de), [{ keyword: "Welche Software?", location_code: 2276, language_code: "de", force_web_search: true }]);
  assert.deepEqual(dataforseoRequest("gemini", "Q?", de), [{ keyword: "Q?", location_code: 2276, language_code: "de" }]);
});

test("ChatGPT and Gemini answers keep text and deduplicated sources without tracking", () => {
  const answer = parseDataforseoResponse(
    "chatgpt",
    wrap({
      markdown: "Try **Acme** or Beta.",
      sources: [
        { url: "https://www.review.com/best?utm_source=chatgpt.com#top", domain: "www.review.com", title: "Best tools" },
        { url: "https://www.review.com/best", domain: "review.com", title: "dup" },
      ],
      items: [{ sources: [{ url: "https://blog.example.org/post", source: "Blog" }] }],
    }),
  );
  assert.equal(answer.text, "Try **Acme** or Beta.");
  assert.equal(answer.costUsd, 0.004);
  assert.deepEqual(answer.sources, [
    { url: "https://www.review.com/best", domain: "review.com", title: "Best tools" },
    { url: "https://blog.example.org/post", domain: "blog.example.org", title: "Blog" },
  ]);
});

test("Google AI Mode answers are read from the AI overview blocks", () => {
  const answer = parseDataforseoResponse(
    "ai_mode",
    wrap({
      items: [
        { type: "organic", markdown: "ignored" },
        { type: "ai_overview", markdown: "Gamma is popular.", references: [{ url: "https://g.com/a", domain: "g.com", title: "G" }], items: [{ references: [{ url: "https://h.com/b", title: "H" }] }] },
      ],
    }),
  );
  assert.equal(answer.text, "Gamma is popular.");
  assert.deepEqual(answer.sources.map((s) => s.domain), ["g.com", "h.com"]);
});

test("failed tasks raise an error that keeps the cost", () => {
  assert.throws(
    () => parseDataforseoResponse("gemini", wrap(null, 40501, 0.001)),
    (err: unknown) => err instanceof ProviderError && err.costUsd === 0.001 && /40501/.test(err.message),
  );
  assert.throws(() => parseDataforseoResponse("chatgpt", wrap({ markdown: "  " })), /without text/);
  assert.throws(() => parseDataforseoResponse("chatgpt", { status_message: "auth" }), /no task/);
});

const env = { DATAFORSEO_LOGIN: "login", DATAFORSEO_PASSWORD: "secret" };

test("a timeout is not retried, because the first request may already be charged", async () => {
  let calls = 0;
  const request = (async () => {
    calls += 1;
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  }) as unknown as typeof fetch;
  await assert.rejects(postDataforseo("x", [], env, request), /did not answer within 120 seconds; not retried/);
  assert.equal(calls, 1);
});

test("server errors are retried once after a pause that follows retry-after", async () => {
  const pauses: number[] = [];
  const sleep = async (ms: number) => void pauses.push(ms);
  let calls = 0;
  const request = (async () => {
    calls += 1;
    return calls === 1 ? new Response("busy", { status: 503 }) : new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await postDataforseo("x", [], env, request, sleep), { ok: true });
  assert.equal(calls, 2);
  const limited = (async () => (pauses.length < 2 ? new Response("slow down", { status: 429, headers: { "retry-after": "30" } }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
  await postDataforseo("x", [], env, limited, sleep);
  assert.deepEqual(pauses, [2_000, 10_000]);
});

test("an answer without JSON is reported as such", async () => {
  const request = (async () => new Response("<html>Gateway</html>", { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(postDataforseo("x", [], env, request), /status 200 but no JSON: <html>Gateway<\/html>/);
});

test("the request carries basic auth and never logs the password", async () => {
  let auth = "";
  const request = (async (_url: string, init: RequestInit) => {
    auth = (init.headers as Record<string, string>).authorization!;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  await postDataforseo("x", [], env, request);
  assert.equal(auth, `Basic ${Buffer.from("login:secret").toString("base64")}`);
});
