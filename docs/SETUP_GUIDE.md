# Rweezy Setup & Installation Guide

This guide provides step-by-step instructions to set up and run the entire Rweezy multi-service delivery platform locally.

---

## Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v20 or newer is required, ESM compliant)
- **PostgreSQL** (running on port `5432` or your custom port)
- **Mapbox Account** (for maps, routing, and search tokens)
- **WhatsApp Account** (required on a physical phone to link with Baileys for sending OTPs)

---

## 1. Local Setup

### Step 1: Clone the Repository
```bash
git clone <your-repo-url> rweezy
cd rweezy
```

### Step 2: Install Dependencies
Install all required packages at the root, frontend, and backend directories:
```bash
# Install root (dev orchestration tools)
npm install

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Go back to repository root
cd ..
```

---

## 2. Environment Variables Configuration

You need to set up environment files in both the repository root and the `backend` folder.

### Root `.env` file
Copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and fill in your custom values:

| Variable | Description | Recommended/Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/rweezy` |
| `JWT_SECRET` | Secret key for signing session tokens | Use a secure random string |
| `MAPBOX_ACCESS_TOKEN` | Public token for Mapbox GL / routing | Get from Mapbox Dashboard |
| `PHONE_VERIFICATION_SECRET` | Secret key for phone registration signature | Use a secure random string |
| `BAILEYS_AUTH_DIR` | Storage directory for linked WhatsApp session | `./baileys_auth_info` |
| `COOKIE_SECURE` | Set to `"false"` for local HTTP, `"true"` for production HTTPS | `"false"` |

#### local Dev OTP Bypass Mode
To speed up local testing without scanning QR codes, you can bypass real WhatsApp OTPs:
```env
WHATSAPP_OTP_DEV_BYPASS="true"
WHATSAPP_OTP_DEV_BYPASS_CODE="123456"
```
Any phone registration/login OTP request will be accepted instantly with the bypass code `123456`.

---

## 3. Database Initialization

1. Make sure your PostgreSQL server is up and running.
2. Create a clean database matching your `DATABASE_URL`:
   ```bash
   createdb rweezy
   ```
3. Run Prisma migrations to construct database tables:
   ```bash
   cd backend
   npx prisma migrate dev
   cd ..
   ```
4. Seed demo/mock user data:
   ```bash
   npm run seed:demo
   ```
   This will populate database roles (customers, riders, store managers, and administrators) with passwords set to `Demo123456`.

---

## 4. Launching the Platform

### Option A: Run everything with a single command (Recommended)
From the root directory, start the automated orchestration:
```bash
npm run dev
```
This runs:
- **Backend API Server**: `http://127.0.0.1:4000`
- **Frontend SPA Client**: `http://127.0.0.1:3000`

### Option B: Run separately
If you prefer to see dedicated logs for each service:
```bash
# In one terminal tab (Backend)
npm run dev:backend

# In another terminal tab (Frontend)
npm run dev:frontend
```

---

## 5. Pairing WhatsApp with Baileys

If `WHATSAPP_OTP_DEV_BYPASS` is set to `"false"`, the backend needs a linked WhatsApp account to deliver OTP messages.

1. Start the backend server (`npm run dev:backend`).
2. Watch the server console output. On first startup, a **QR code** is rendered directly in the terminal.
3. Open WhatsApp on your physical phone:
   - Tap **Settings** (or the three dots in the top-right)
   - Go to **Linked Devices**
   - Tap **Link a Device** and scan the terminal's QR code.
4. Once scanned, the terminal logs:
   ```
   [info] baileys_connected
   ```
   Session credentials are automatically saved into `BAILEYS_AUTH_DIR` (`./baileys_auth_info`). On subsequent server restarts, it connects automatically.
