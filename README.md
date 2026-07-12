# Rweezy

Rweezy is a multi-service delivery platform with a React frontend, a Rust Actix backend, and a WhatsApp sidecar service. The app supports food and grocery ordering, delivery management, ride booking, and package delivery.

## Project structure

- frontend/: Vite + React + TypeScript web app
- backend-rust/: Rust Actix Web API server
- backend-rust/whatsapp-sidecar/: Node.js sidecar for WhatsApp integrations
- backend-rust/migrations/: SQLx database migrations

## Tech stack

- Frontend: React 19, TypeScript, Vite, TanStack Router, Tailwind CSS
- Backend: Rust, Actix Web, SQLx, PostgreSQL
- Messaging: WhatsApp sidecar service

## Prerequisites

- Rust 1.75+
- Node.js 20+
- PostgreSQL running locally
- pkg-config and OpenSSL development headers for Rust builds

On Debian/Ubuntu/Kali this is usually enough:

```bash
sudo apt-get install -y pkg-config libssl-dev
```

## Quick start

### 1. Start PostgreSQL

Make sure PostgreSQL is running and a database named `rweezy` exists.

Example:

```bash
createdb rweezy
```

### 2. Configure environment variables

The Rust backend uses `DATABASE_URL` and other optional values from the environment. A typical local setup is:

```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/rweezy"
export JWT_SECRET="change-me"
```

### 3. Run the backend

```bash
cd backend-rust
cargo run
```

The backend will apply the SQLx migrations automatically. If the local database already contains a prior migration record with a checksum mismatch, the startup path will repair that history and retry.

### 4. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

### 5. Run the WhatsApp sidecar (optional)

```bash
cd backend-rust/whatsapp-sidecar
npm install
npm run dev
```

## Build checks

```bash
cd backend-rust
cargo check

cd ../frontend
npm run build
```

## Notes

- The backend currently expects PostgreSQL to be available on `localhost:5432` unless overridden with `DATABASE_URL`.
- The frontend and backend can be developed independently, but both are required for the full experience.
