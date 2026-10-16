import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPublicAddress } from "./domain.ts";

export type HttpRequest = (url: URL, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export type Lookup = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;
export type AddressResolver = (hostname: string) => Promise<LookupAddress[]>;

export class PrivateAddressError extends Error {
  readonly hostname: string;
  constructor(hostname: string) {
    super(`${hostname} points to a private address`);
    this.hostname = hostname;
  }
}

const systemResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))));

export function publicOnlyLookup(resolve: AddressResolver = systemResolver): Lookup {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (all) => {
        const wanted = options.family === 4 || options.family === 6 ? all.filter((a) => a.family === options.family) : all;
        if (wanted.length === 0) return callback(Object.assign(new Error(`${hostname} does not resolve`), { code: "ENOTFOUND" }), "");
        if (!wanted.every((a) => isPublicAddress(a.address))) return callback(new PrivateAddressError(hostname), "");
        if (options.all) return callback(null, wanted);
        callback(null, wanted[0]!.address, wanted[0]!.family);
      },
      (err: NodeJS.ErrnoException) => callback(err, ""),
    );
  };
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function decoded(res: http.IncomingMessage): Readable {
  const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null;
  if (!decoder) return res;
  res.on("error", (err) => decoder.destroy(err));
  return res.pipe(decoder);
}

function responseHeaders(res: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return headers;
}

export function nodeRequest(lookup: Lookup = publicOnlyLookup()): HttpRequest {
  return (url, init) =>
    new Promise((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const req = client.request(url, { method: "GET", headers: { ...init.headers, "accept-encoding": "gzip, deflate, br" }, lookup, signal: init.signal }, (res) => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new Error(`unexpected status ${status}`));
          return;
        }
        const headers = responseHeaders(res);
        if (NULL_BODY_STATUS.has(status)) {
          res.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        resolve(new Response(Readable.toWeb(decoded(res)) as ReadableStream<Uint8Array>, { status, headers }));
      });
      req.on("error", reject);
      req.end();
    });
}
