import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress, normalizeDomain } from "../src/core/domain.ts";

test("domains are normalized", () => {
  assert.equal(normalizeDomain("https://www.Example.com/pricing?x=1"), "example.com");
  assert.equal(normalizeDomain("example.co.uk"), "example.co.uk");
  assert.equal(normalizeDomain(" shop.example.de. "), "shop.example.de");
  assert.equal(normalizeDomain(`example.com/${"long".repeat(100)}`), "example.com");
});

test("international domains are shown as typed, not as punycode", () => {
  assert.equal(normalizeDomain("müller.de"), "müller.de");
  assert.equal(normalizeDomain("https://www.MÜLLER.de/"), "müller.de");
  assert.equal(normalizeDomain("xn--mller-kva.de"), "müller.de");
});

test("non public addresses are refused", () => {
  for (const bad of ["localhost", "127.0.0.1", "intranet.local", "example", "ftp://example.com", "user:pw@example.com", "example.com:8080", "", `${"a".repeat(64)}.com`]) {
    assert.equal(normalizeDomain(bad), null, bad);
  }
});

test("private, loopback, link local and test addresses are not public, in every spelling", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "0.0.0.0", "198.51.100.5", "203.0.113.5", "192.0.2.1", "224.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["::1", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "fe80::1", "fe80:0:0:0:0:0:0:1", "fd00::1", "fc00::1", "ff02::1", "64:ff9b::7f00:1", "2001:db8::1"]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ["93.184.215.14", "8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  assert.equal(isPublicAddress("not an address"), false);
});
