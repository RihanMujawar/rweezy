# Troubleshooting & Common Issues Guide

This guide describes issues commonly faced during development, testing, or deployment of the Rweezy application, along with instructions on how to resolve them.

---

## 1. Authentication & Cookie Issues

### Silent/Instant Disconnect on Success
* **Symptom**: Signing in successfully returns 200, but is immediately followed by a redirect back to `/login` or `/api/auth/me` returning `401`.
* **Root Cause**: The JWT token cookie is being set, but your web browser is rejecting it because of explicit `Secure` cookie constraints.
* **Resolution**: In local dev/staging setups where SSL (HTTPS) is not configured, set `COOKIE_SECURE="false"` in both your root and backend `.env` files. This ensures cookies are transmitted over plain HTTP connection channels:
  ```env
  COOKIE_SECURE="false"
  ```

---

## 2. PostgreSQL / Prisma Connection Errors

### "Relation users does not exist" or Database Schema Errors
* **Symptom**: Connection to Postgres succeeds, but Prisma queries fail with "Relation users does not exist" or schema missing exceptions.
* **Root Cause**: By default, PostgreSQL expects tables inside the `public` schema. If the backend search_path is set exclusively to `rweezy` but tables reside inside `public`, queries fail.
* **Resolution**: The connection string in Rweezy has been unified with a dual schema search path:
  ```javascript
  await client.query('SET search_path = rweezy, public');
  ```
  Ensure your database contains tables under either `rweezy` or `public` schemas. When running migrations manually:
  ```bash
  npx prisma db push --schema=backend/prisma/schema.prisma
  ```

---

## 3. WhatsApp Baileys System Issues

### "WhatsApp is not connected" or WebSocket closed errors
* **Symptom**: Requesting OTP throws `502 BaileysError` containing "WhatsApp is not connected".
* **Root Cause**: The local server is not linked with a WhatsApp phone or the linked session has been invalidated/logged out from the phone.
* **Resolution**:
  1. If running locally or on a server, examine the backend startup logs. Ensure that you scan the printed **QR code** using WhatsApp on your phone.
  2. If the session has corrupted, delete the auth directory to force Baileys to reset and generate a fresh QR code:
     ```bash
     rm -rf backend/baileys_auth_info
     # Then restart the backend server
     ```

### OTP Delivery Failures
* **Symptom**: Calling `POST /api/auth/phone/send-otp` times out or fails with no message received.
* **Root Cause**: Heavy traffic or local network connectivity blocking the WhatsApp socket.
* **Resolution**: For development, enable dev bypass mode inside `.env` to test authentication without sending actual messages:
  ```env
  WHATSAPP_OTP_DEV_BYPASS="true"
  WHATSAPP_OTP_DEV_BYPASS_CODE="123456"
  ```
