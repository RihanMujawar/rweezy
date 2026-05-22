import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDeliveryPin,
  assertStatusAdvance,
  canAdvanceStatus,
  estimateDeliveryAt,
  estimateDeliveryMinutes,
  generateDeliveryPin,
  sanitizeComment,
} from "../backend/lib/platform-helpers.mjs";

test("generateDeliveryPin returns 4 digits", () => {
  const pin = generateDeliveryPin();
  assert.match(pin, /^\d{4}$/);
});

test("estimateDeliveryMinutes includes prep and travel", () => {
  const minutes = estimateDeliveryMinutes(20, 5);
  assert.ok(minutes >= 20);
});

test("estimateDeliveryMinutes has a minimum fallback for missing distance", () => {
  assert.equal(estimateDeliveryMinutes(0, 0), 15);
});

test("estimateDeliveryAt uses the supplied distance helper", () => {
  const startedAt = Date.now();
  const iso = estimateDeliveryAt(10, { lat: 1, lng: 2 }, { lat: 3, lng: 4 }, () => 11);
  const estimatedMs = new Date(iso).getTime() - startedAt;

  assert.ok(estimatedMs >= 40 * 60_000);
  assert.ok(estimatedMs <= 41 * 60_000);
});

test("sanitizeComment trims, limits, and drops blank comments", () => {
  assert.equal(sanitizeComment("  helpful note  "), "helpful note");
  assert.equal(sanitizeComment("   "), null);
  assert.equal(sanitizeComment(null), null);
  assert.equal(sanitizeComment("x".repeat(600)).length, 500);
});

test("assertDeliveryPin accepts matching PIN and rejects incorrect PIN", () => {
  assert.doesNotThrow(() => assertDeliveryPin({ delivery_pin: "1234" }, " 1234 "));
  assert.doesNotThrow(() => assertDeliveryPin({}, "9999"));
  assert.throws(() => assertDeliveryPin({ delivery_pin: "1234" }, "9999"), /INVALID_PIN/);
});

test("status transition helper allows only the next lifecycle step", () => {
  assert.equal(canAdvanceStatus("delivery", "ready", "picked_up"), true);
  assert.equal(canAdvanceStatus("delivery", "preparing", "picked_up"), true);
  assert.equal(canAdvanceStatus("delivery", "ready", "delivered"), false);
  assert.equal(canAdvanceStatus("ride", "accepted", "started"), true);
  assert.equal(canAdvanceStatus("package", "started", "completed"), true);
  assert.throws(
    () => assertStatusAdvance("ride", "accepted", "completed"),
    /INVALID_STATUS_TRANSITION/,
  );
});
