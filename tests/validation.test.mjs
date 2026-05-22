import test from "node:test";
import assert from "node:assert/strict";
import {
  checkoutSchema,
  fieldErrors,
  loginEmailSchema,
  loginPhoneSchema,
  packageBookingSchema,
  registerSchema,
  rideBookingSchema,
} from "../frontend/src/lib/validation.ts";

test("loginEmailSchema rejects invalid email", () => {
  const result = loginEmailSchema.safeParse({ email: "bad", password: "secret1" });
  assert.equal(result.success, false);
});

test("loginPhoneSchema accepts normalized Indian phone", () => {
  const result = loginPhoneSchema.safeParse({ phone: "+919876543210", password: "secret1" });
  assert.equal(result.success, true);
});

test("registerSchema requires matching passwords", () => {
  const result = registerSchema.safeParse({
    fullName: "Demo User",
    email: "demo@zoomly.test",
    phone: "+919876543210",
    password: "secret1",
    confirmPassword: "other",
    requestedRole: "customer",
  });
  assert.equal(result.success, false);
});

test("checkoutSchema requires delivery pin location", () => {
  const result = checkoutSchema.safeParse({
    address: "12 MG Road",
    items: [{ id: "1", name: "Dosa", price: 99, quantity: 1 }],
  });
  assert.equal(result.success, false);
});

test("rideBookingSchema validates pickup and drop", () => {
  const result = rideBookingSchema.safeParse({
    pickupAddress: "MG Road",
    dropAddress: "Indiranagar",
    pickupLocation: { lat: 12.97, lng: 77.59 },
    dropLocation: { lat: 12.98, lng: 77.64 },
    vehicle: "bike",
  });
  assert.equal(result.success, true);
});

test("packageBookingSchema validates receiver phone", () => {
  const result = packageBookingSchema.safeParse({
    pickupAddress: "MG Road",
    dropAddress: "Indiranagar",
    pickupLocation: { lat: 12.97, lng: 77.59 },
    dropLocation: { lat: 12.98, lng: 77.64 },
    receiverName: "Alex",
    receiverPhone: "9876543210",
    size: "medium",
  });
  assert.equal(result.success, false);
});

test("fieldErrors maps zod issues to first message", () => {
  const parsed = loginEmailSchema.safeParse({ email: "bad", password: "x" });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    assert.ok(errors.email || errors.password);
  }
});
