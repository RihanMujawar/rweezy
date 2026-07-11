import test from "node:test";
import assert from "node:assert/strict";
import {
  loginSchema,
  registerSchema,
  checkoutSchema,
} from "../backend/lib/validation.mjs";

test("backend loginSchema validates email or phone", () => {
  assert.ok(loginSchema.safeParse({ email: "test@example.com", password: "password123" }).success);
  assert.ok(loginSchema.safeParse({ phone: "+919876543210", password: "password123" }).success);
  assert.ok(!loginSchema.safeParse({ password: "password123" }).success);
});

test("backend registerSchema validates password strength", () => {
  const base = {
    full_name: "Test User",
    phone: "+919876543210",
    phone_verification_token: "token",
  };
  assert.ok(registerSchema.safeParse({ ...base, password: "Password123" }).success);
  assert.ok(!registerSchema.safeParse({ ...base, password: "password" }).success);
  assert.ok(!registerSchema.safeParse({ ...base, password: "12345678" }).success);
});

test("backend checkoutSchema validates items", () => {
  const base = {
    delivery_address: "123 MG Road",
    delivery_lat: 12.97,
    delivery_lng: 77.59,
  };
  assert.ok(checkoutSchema.safeParse({ ...base, items: [{ id: "1", name: "Item", price: 10, quantity: 1 }] }).success);
  assert.ok(!checkoutSchema.safeParse({ ...base, items: [] }).success);
});
