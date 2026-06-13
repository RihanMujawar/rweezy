import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanText,
  isPublicApiRoute,
  normalizeIndianPhone,
} from "../shared/lib/request-utils.mjs";

test("normalizeIndianPhone formats 10-digit numbers", () => {
  assert.equal(normalizeIndianPhone("9876543210"), "+919876543210");
  assert.equal(normalizeIndianPhone("919876543210"), "+919876543210");
});

test("cleanText trims strings", () => {
  assert.equal(cleanText("  hello  "), "hello");
  assert.equal(cleanText(42), "");
});

test("isPublicApiRoute allows health and auth routes only", () => {
  assert.equal(isPublicApiRoute("GET", "/api/health"), true);
  assert.equal(isPublicApiRoute("POST", "/api/auth/login"), true);
  assert.equal(isPublicApiRoute("GET", "/api/orders"), false);
  assert.equal(isPublicApiRoute("POST", "/api/orders/food"), false);
});
