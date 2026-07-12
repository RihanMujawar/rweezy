# Architecture & Technical Documentation

This document describes the design principles, backend implementation details, data modeling, and frontend integration within the Rweezy application.

---

## 1. System Topology

```
                  ┌──────────────────────┐
                  │   React 19 Frontend  │ (Vite Dev Server / S3+CloudFront)
                  └──────────┬───────────┘
                             │ (Proxied /api requests, Cookie-Auth)
                             ▼
                  ┌──────────────────────┐
                  │    Node.js Backend   │ (ESM natively compiled API server)
                  └──────┬──────────┬────┘
                         │          │ (WebSocket peer connection)
                         ▼          ▼
             ┌──────────────┐    ┌──────────────┐
             │  PostgreSQL  │    │  WhatsApp    │ (Via Baileys WebSockets)
             │ (Prisma ORM) │    │  Web App     │
             └──────────────┘    └──────────────┘
```

Rweezy utilizes a modern serverless-friendly multi-tier architecture:
- **Client Tier**: A client-side Single Page Application (SPA) built using **React 19**, **Vite**, **Tailwind CSS v4 (oklch)**, and **TanStack Router**. Real-time notifications and state checking are managed client-side using polling mechanisms.
- **Server Tier**: A Node.js native ESM application structured around feature-based routes. The server uses the native `http` module and translates responses cleanly, allowing compatibility with serverless AWS Lambda via the `serverless-http` wrapper.
- **Persistence Tier**: All transactional, customer, and catalog details are held inside a **PostgreSQL** database, modeled cleanly via **Prisma ORM**.

---

## 2. Core Backend Modules

All core backend logic resides in the `backend/lib/` folder:

### 1. Database Connectivity (`prisma.mjs`)
Initializes the Prisma Client. Utilizes an explicit Postgres schema search path mechanism:
```javascript
onConnect: async (client) => {
  await client.query('SET search_path = rweezy, public');
}
```
This ensures seamless compatibility with environments where tables are located either under a dedicated `rweezy` schema or the standard `public` schema.

### 2. WhatsApp Integration (`baileys.mjs` & `whatsapp-otp.mjs`)
Implements **Baileys** (`@whiskeysockets/baileys`) for direct WhatsApp communication.
- Connects cleanly to the WhatsApp WebSocket directly.
- Handles automated QR code rendering for link setup.
- Provides a development bypass option to prevent wasting real WhatsApp messages when testing.

### 3. State-Based Security & Sessions (`auth.mjs` & `env.mjs`)
Performs JWT session token signing and verification using `jsonwebtoken` and password hashing with `bcryptjs`.
- Session tokens are stored inside browser-managed HTTP-Only cookies (`rweezy_access_token`).
- Cookie-based authentication incorporates an explicit `cookieSecure` fallback (`process.env.COOKIE_SECURE === "true"`) to prevent cookies from being rejected when serving builds over HTTP.

---

## 3. Database Schema

The database relies on tables managed by Prisma:
- **`User` and `Profile`**: Keeps basic credentials, phone mapping, email identifiers, and personal settings (town, pincode, names).
- **`UserRole`**: Governs access control based on user categories (`customer`, `admin`, `hotel_manager`, `grocery_manager`, `delivery_boy`, `rider`).
- **`Restaurant` and `MenuItem`**: Configures the food ordering catalog.
- **`GroceryStore` and `GroceryItem`**: Manages store listings and item stock tracking.
- **`FoodOrder` and `GroceryOrder`**: Stores checkout records, pricing, location data, and delivery configurations.
- **`Ride` and `PackageDelivery`**: Handles on-demand package courier services and ride-hailing states.
- **`ChatMessage`**: Powers contextual text messaging during ongoing jobs.
- **`OrderReview`**: Holds buyer ratings and textual comments.
