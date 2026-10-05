import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { domainToUnicode } from "node:url";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_HOST_LENGTH = 253;
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".test", ".invalid", ".example"];

export class InputError extends Error {}

export function normalizeDomain(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;
  let host: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.replace(/\.$/, "").replace(/^www\./, "");
  if (!host || host.length > MAX_HOST_LENGTH) return null;
  if (isIP(host) || host.startsWith("[")) return null;
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (!/^[a-z]{2,63}$|^xn--[a-z0-9-]{2,59}$/.test(labels[labels.length - 1]!)) return null;
  const unicode = domainToUnicode(host);
  return unicode || host;
}

const PRIVATE_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const PRIVATE_V6: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

const PRIVATE = new BlockList();
for (const [address, prefix] of PRIVATE_V4) PRIVATE.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of PRIVATE_V6) PRIVATE.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 0) return false;
  try {
    return !PRIVATE.check(address, kind === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHost: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  return addresses.map((a) => a.address);
};

export async function assertPublicHost(hostname: string, resolve: HostResolver = resolveHost): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(host) || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new InputError(`${host} is not a public website`);
  const addresses = await resolve(host);
  if (addresses.length === 0) throw new InputError(`${host} does not resolve`);
  if (!addresses.every(isPublicAddress)) throw new InputError(`${host} points to a private address`);
}
