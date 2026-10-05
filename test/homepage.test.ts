import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeBody, looksBlocked, makeFetcher, pageText, readCapped, readHomepage, type PageFetcher } from "../src/core/homepage.ts";

const HTML = `<!doctype html><html lang="de"><head><title>Acme &amp; Co</title><meta name="description" content="Buchhaltung für Handwerker"></head>
<body><nav>Menu</nav><script>var x = 1;</script><h1>Buchhaltung ohne Stress</h1><p>Für Handwerksbetriebe&nbsp;in Deutschland.</p></body></html>`;

test("page text keeps visible text and drops scripts", () => {
  const page = pageText(HTML);
  assert.equal(page.title, "Acme & Co");
  assert.equal(page.description, "Buchhaltung für Handwerker");
  assert.match(page.text, /Buchhaltung ohne Stress\nFür Handwerksbetriebe in Deutschland\./);
  assert.doesNotMatch(page.text, /var x/);
});

test("challenge pages count as blocked, real pages do not", () => {
  assert.equal(looksBlocked(403, "anything"), true);
  assert.equal(looksBlocked(200, "<title>Just a moment...</title>"), true);
  assert.equal(looksBlocked(200, HTML), false);
  assert.equal(looksBlocked(404, "not found"), false);
});

test("a blocked homepage is read again with a browser identity", async () => {
  const seen: string[] = [];
  const fetcher: PageFetcher = async (url, identity) => {
    seen.push(identity);
    return identity === "checker"
      ? { url, status: 403, body: "denied", contentType: "text/html" }
      : { url, status: 200, body: HTML, contentType: "text/html; charset=utf-8" };
  };
  const page = await readHomepage("acme.de", fetcher);
  assert.deepEqual(seen, ["checker", "browser"]);
  assert.equal(page.identity, "browser");
  assert.equal(page.language, "de");
});

test("a homepage without text is an error", async () => {
  const fetcher: PageFetcher = async (url) => ({ url, status: 200, body: "<html><body></body></html>", contentType: "text/html" });
  await assert.rejects(readHomepage("empty.com", fetcher), /no readable text/);
});

test("broken numeric entities stay as they are instead of crashing", () => {
  assert.equal(pageText("<body><p>a &#99999999; b &#xD800; c &#65;</p></body>").text, "a &#99999999; b &#xD800; c A");
});

test("meta descriptions keep apostrophes and quotes", () => {
  assert.equal(pageText(`<head><meta name="description" content="Plausible's simple analytics"></head>`).description, "Plausible's simple analytics");
  assert.equal(pageText(`<head><meta content='Say "hi"' name='description'></head>`).description, 'Say "hi"');
});

const publicResolver = async () => ["93.184.215.14"];

test("redirects are followed and each hop must resolve to a public address", async () => {
  const seen: string[] = [];
  const request = (async (url: URL) => {
    seen.push(url.toString());
    if (url.hostname === "acme.de") return new Response(null, { status: 301, headers: { location: "https://www.acme.de/" } });
    return new Response(HTML, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
  const page = await makeFetcher(publicResolver, request)("https://acme.de/", "checker");
  assert.deepEqual(seen, ["https://acme.de/", "https://www.acme.de/"]);
  assert.equal(page.url, "https://www.acme.de/");

  const resolver = async (host: string) => (host === "internal.acme.de" ? ["10.0.0.5"] : ["93.184.215.14"]);
  const sneaky = (async () => new Response(null, { status: 302, headers: { location: "https://internal.acme.de/" } })) as unknown as typeof fetch;
  await assert.rejects(makeFetcher(resolver, sneaky)("https://acme.de/", "checker"), /private address/);
  await assert.rejects(makeFetcher(async () => ["127.0.0.1"], sneaky)("https://acme.de/", "checker"), /private address/);
});

test("endless redirects stop", async () => {
  const loop = (async () => new Response(null, { status: 302, headers: { location: "/again" } })) as unknown as typeof fetch;
  await assert.rejects(makeFetcher(publicResolver, loop)("https://acme.de/", "checker"), /redirects too often/);
});

test("an unclosed script and custom elements that start like style are handled", () => {
  assert.equal(pageText("<html><body><script>var secret = 1;<p>Hello world</p></body></html>").text, "");
  assert.equal(pageText("<html><body><styles-x>Visible</styles-x><p>Text</p><style>.a{}</style></body></html>").text, "Visible Text");
  assert.equal(looksBlocked(200, "<script>var x = 'just a moment...'</script><p>" + "Real content. ".repeat(200) + "</p>"), false);
});

test("the declared charset is honoured, from the header or the html", () => {
  const latin1 = Buffer.from("<html><body><p>F\xfcr Handwerker</p></body></html>", "latin1");
  assert.match(decodeBody(latin1, "text/html; charset=ISO-8859-1"), /Für Handwerker/);
  const meta = Buffer.from('<html><head><meta charset="windows-1252"></head><body><p>F\xfcr Handwerker</p></body></html>', "latin1");
  assert.match(decodeBody(meta, "text/html"), /Für Handwerker/);
  const utf8 = Buffer.from("<p>Für Handwerker</p>", "utf8");
  assert.match(decodeBody(utf8, "text/html"), /Für Handwerker/);
  assert.match(decodeBody(utf8, "text/html; charset=no-such-charset"), /Für Handwerker/);
});

test("the body stream is cut at the size limit", async () => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024).fill(97));
    },
  });
  const body = await readCapped(new Response(stream), 4000);
  assert.equal(body.length, 4000);
  assert.ok(pulled <= 5, `pulled ${pulled} chunks`);
});
