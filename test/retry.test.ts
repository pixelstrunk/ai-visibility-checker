import { test } from "node:test";
import assert from "node:assert/strict";
import { RETRY_DELAY_MAX_MS, RETRY_DELAY_MS, retryDelayMs } from "../src/core/retry.ts";

test("the pause before a second attempt follows retry-after, capped at ten seconds", () => {
  assert.equal(retryDelayMs(null), RETRY_DELAY_MS);
  assert.equal(retryDelayMs(""), RETRY_DELAY_MS);
  assert.equal(retryDelayMs("garbage"), RETRY_DELAY_MS);
  assert.equal(retryDelayMs("3"), 3_000);
  assert.equal(retryDelayMs("0"), 0);
  assert.equal(retryDelayMs("60"), RETRY_DELAY_MAX_MS);
  const now = Date.parse("Mon, 05 Oct 2026 12:00:00 GMT");
  assert.equal(retryDelayMs("Mon, 05 Oct 2026 12:00:04 GMT", now), 4_000);
  assert.equal(retryDelayMs("Mon, 05 Oct 2026 11:00:00 GMT", now), 0);
  assert.equal(retryDelayMs("Mon, 05 Oct 2026 13:00:00 GMT", now), RETRY_DELAY_MAX_MS);
});
