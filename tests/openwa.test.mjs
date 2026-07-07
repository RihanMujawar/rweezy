import test from "node:test";
import assert from "node:assert/strict";
import { OpenWAError, toWhatsAppChatId } from "../backend/lib/openwa.mjs";

test("toWhatsAppChatId converts an international phone number to a WhatsApp chat ID", () => {
  assert.equal(toWhatsAppChatId("+91 98765-43210"), "919876543210@c.us");
});

test("toWhatsAppChatId rejects invalid phone numbers", () => {
  assert.throws(
    () => toWhatsAppChatId("123"),
    (error) => error instanceof OpenWAError && error.status === 400,
  );
});
