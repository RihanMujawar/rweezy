# Rweezy Setup & Run Guide

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** database (running on localhost:5432 or your configured port)
- **No Mapbox token required** — the app uses OpenStreetMap-based geocoding and map tiles
- **WhatsApp phone number** (for Baileys OTP + notifications)

---

## 1. Clone & Install

### Automated setup (recommended)

From the repository root, run:

```bash
chmod +x setup.sh
./setup.sh
```

This script will:
- verify required tools are installed
- create or update the root .env file
- install frontend and WhatsApp sidecar dependencies
- fetch Rust dependencies
- optionally start the backend, sidecar, and frontend services

Useful flags:

```bash
./setup.sh --setup-only      # configure and install without starting services
./setup.sh --skip-install    # reuse existing dependencies
./setup.sh --skip-env        # skip .env creation/update
```

### Manual setup

```bash
git clone <repo-url> rweezy
cd rweezy

# Install root dependencies (dev tools)
npm install

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Go back to root
cd ..
```

---

## 2. Database Setup

1. Make sure PostgreSQL is running

2. Create a database:
   ```bash
   createdb rweezy
   ```

3. Run Prisma migrations to create tables:
   ```bash
   cd backend
   npx prisma migrate dev
   cd ..
   ```

---

## 3. Environment Variables

### Root `.env`

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Key variables you **must** set:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Random secret for signing auth tokens |
| `PHONE_VERIFICATION_SECRET` | Random secret for phone verification tokens |

WhatsApp & OTP variables (see Section 5 for setup):

| Variable | Description | Default |
|---|---|---|
| `BAILEYS_AUTH_DIR` | Where Baileys stores WhatsApp session credentials | `./baileys_auth_info` |
| `WHATSAPP_OTP_DEV_BYPASS` | Skip sending real WhatsApp messages in dev | `false` |
| `WHATSAPP_OTP_DEV_BYPASS_CODE` | Code to accept when bypass is on | `123456` |

### Backend `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Same variables as root — the backend loads both files (backend-specific values override root).

---

## 4. Run the Development Servers

```bash
# From the project root — starts both backend (port 4000) and frontend (port 3000)
npm run dev

# Or run them separately:
npm run dev:backend   # Backend on http://127.0.0.1:4000
npm run dev:frontend  # Frontend on http://127.0.0.1:3000
```

The backend auto-reloads on file changes via `node --watch`.

---

## 5. WhatsApp Setup (Baileys)

The project uses **Baileys** (`@whiskeysockets/baileys`) to send OTP codes and notifications via WhatsApp Web. Unlike the old OpenWA setup, Baileys connects directly to WhatsApp WebSocket — no Docker, no gateway service needed.

### How it works

1. **First run**: Baileys generates a QR code. You scan it with WhatsApp on your phone (Settings > Linked Devices > Link a Device).
2. **After linking**: Session credentials are saved to `BAILEYS_AUTH_DIR` (`./baileys_auth_info`). On subsequent restarts, it reuses these and connects automatically.
3. **Reconnection**: If the connection drops (e.g., network blip), Baileys auto-reconnects. If you log out from WhatsApp, you need to delete the auth directory and re-link.

### Setup Steps

1. **Enable Baileys** in `.env`:
   ```
   BAILEYS_AUTH_DIR="./baileys_auth_info"
   ```

2. **For local dev without a real WhatsApp connection**, use bypass mode:
   ```
   WHATSAPP_OTP_DEV_BYPASS="true"
   WHATSAPP_OTP_DEV_BYPASS_CODE="123456"
   ```
   This lets you test the full registration/login flow without sending actual WhatsApp messages. Any 6-digit code sent to the API will be accepted as `123456`.

3. **For production / real usage**, start the server:
   ```bash
   cd backend
   node server.mjs
   ```
   On startup, a QR code is printed in the terminal. Open WhatsApp on your phone, tap the three dots (Android) or Settings (iOS) > Linked Devices > Link a Device, and scan the QR code.

   After scanning, the terminal shows:
   ```
   [info] baileys_connected
   ```
   The session is now active. Restarting the server will reconnect automatically.

### Troubleshooting Baileys

| Problem | Solution |
|---|---|
| No QR code appears | Set `BAILEYS_AUTH_DIR` in `.env`. Delete the directory if it exists from a previous failed attempt. |
| QR code expired | Just wait — a new one prints automatically. |
| "WhatsApp is not connected" in logs | Check the terminal for the QR code and scan it. |
| Connection keeps dropping | WhatsApp Web sessions can drop on unstable networks. Baileys retries automatically. |
| Logged out / session invalid | Delete the `baileys_auth_info` directory and restart. A fresh QR code will appear. |
| Permission error on `baileys_auth_info` | Ensure the directory is writable by the Node process. |

---

## 6. API Reference (WhatsApp/OTP)

### Send OTP

```
POST /api/auth/phone/send-otp
Body: { phone: "+919876543210", purpose: "login" }
```

### Verify OTP

```
POST /api/auth/phone/verify-otp
Body: { phone: "+919876543210", code: "123456", purpose: "login" }
```

### Test Notification (admin only)

```
POST /api/admin/notifications/test
Headers: Authorization: Bearer <admin-token>
```

---

## 7. Production Build

```bash
# Build everything
npm run build

# Start production server (serves API + frontend)
npm run start
```

The production server:
- Serves API routes under `/api/*`
- Serves built frontend assets from `frontend/dist/client`
- Falls back to `index.html` for SPA routes
