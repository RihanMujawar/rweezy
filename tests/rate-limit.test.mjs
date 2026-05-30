import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../backend/lib/rate-limit.mjs";

test("rate limit allows requests under cap", () => {
  const ip = `test-${Date.now()}`;
  for (let i = 0; i < 5; i++) {
    assert.equal(checkRateLimit(ip, "/api/auth/login"), null);
  }
});

test("rate limit blocks after exceeding cap", () => {
  const ip = `block-${Date.now()}`;
  let blocked = null;
  for (let i = 0; i < 25; i++) {
    blocked = checkRateLimit(ip, "/api/auth/login");
  }
  assert.ok(blocked);
  assert.match(blocked, /Too many requests/);
});
