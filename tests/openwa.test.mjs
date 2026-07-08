import test from "node:test";
import assert from "node:assert/strict";
import { BaileysError, toWhatsAppChatId } from "../backend/lib/baileys.mjs";

test("toWhatsAppChatId converts an international phone number to a WhatsApp JID", () => {
  assert.equal(toWhatsAppChatId("+91 98765-43210"), "919876543210@s.whatsapp.net");
});

test("toWhatsAppChatId rejects invalid phone numbers", () => {
  assert.throws(
    () => toWhatsAppChatId("123"),
    (error) => error instanceof BaileysError && error.status === 400,
  );
});
