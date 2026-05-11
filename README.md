# Zoomly - Multi-Service Delivery Platform 🚀

[![React](https://img.shields.io/badge/React-19-blue?logo=react)](https://react.dev)
[![Node.js](https://img.shields.io/badge/Node.js-ESM-green?logo=node.js)](https://nodejs.org)
[![Supabase](https://img.shields.io/badge/Supabase-DB%20%26%20Auth-purple?logo=supabase)](https://supabase.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-4-cyan?logo=tailwind)](https://tailwindcss.com)
[![Vite](https://img.shields.io/badge/Vite-Build%20Tool-orange?logo=vite)](https://vite.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://typescriptlang.org)

**Zoomly** is a full-stack multi-service delivery platform supporting ride-hailing, package deliveries, food orders from restaurants, and grocery shopping. Built with modern web technologies, it features role-based dashboards for customers, riders/delivery personnel, restaurant/grocery managers, and admins.

## 🧠 How Everything Works: Complete Architecture Overview

### Overall System Flow
```
Frontend (React/Vite) → API Requests (/api/*) → Backend (Node ESM) → Supabase (DB/Auth)
- Auth: Cookies (JWT access/refresh) auto-managed by backend.
- Data: Supabase REST API calls from backend (proxied frontend queries).
- Real-time capable: Live location updates via PATCH.
- Dev: Vite proxies /api to backend; Prod: Backend serves SPA/SSR/API same-origin.
```

**Key Components:**
1. **Frontend**: React 19 SPA with TanStack Router (file-based), Query (data fetching/caching/mutations), Zustand (state), Radix UI (primitives), Tailwind CSS 4, Leaflet (maps), Recharts (charts).
2. **Backend**: Single Node.js ESM HTTP server (`backend/server.mjs`). Routes all /api/*, serves frontend static/SSR, handles auth/DB via Supabase wrappers.
3. **Database**: Supabase Postgres (migrations: `backend/supabase/migrations/`). RLS recommended; service key for backend ops.
4. **Dev Script**: `scripts/dev.mjs` spawns parallel backend (`node --watch server.mjs`) + frontend (`vite dev`).

### Frontend-Backend Communication
- **Development**:
  - Frontend Vite dev server (port 3000): Proxies all `/api/*` requests to backend (`BACKEND_URL` or `http://127.0.0.1:4000` – coordinated by dev.mjs).
  - Browser → Vite (localhost:3000/api/...) → Proxy → Backend → Supabase.
  - Auth cookies set by backend responses, auto-sent by browser.
- **Production**:
  - `npm run build` → `frontend/dist/` (client assets + SSR entry `dist/server/index.js`).
  - Backend `server.mjs` serves:
    | Path | Handler |
    |------|---------|
    | `/api/*` | API routes |
    | `/assets/*`, static | Serve `dist/client` |
    | `/` SPA routes | Vite SSR (`dist/server/index.js`) fallback to client index.html |
  - All same-origin: Browser → Backend (localhost:3000/api/... directly).
- **API Client**: Frontend `src/lib/api.ts` + TanStack Query (`useQuery/useMutation`). Queries hit `/api/*`, backend extracts cookies/token, proxies to Supabase REST, returns JSON.
- **Auth Handling**: Transparent cookies (`zoomly_access_token`, `zoomly_refresh_token`). Backend auto-refreshes expired access tokens using refresh.

**Example Query Flow (Customer Orders):**
```
useQuery({ queryKey: ['orders/me'], queryFn: () => api.get('/api/orders/me') })
→ fetch('/api/orders/me', { credentials: 'include' })
→ Backend: Parse cookies → getUserFromToken/refresh → restRequest('/food_orders?customer_id=eq.$id')
→ Supabase → JSON → Query cache → UI
```

### Backend API Routes (Complete List)
All routes under `/api/*`, CORS-enabled, JSON responses. Require auth except health/login/register/map/route.

#### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | `{email, password}` → session cookies + user/roles |
| POST | `/api/auth/register` | `{email, password, full_name}` → optional auto-login |
| POST | `/api/auth/logout` | Revoke session, clear cookies |
| GET | `/api/auth/me` | Current user + roles |
| GET | `/api/health` | `{ok: true}` (public) |

#### Customer Features
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/orders/food` | Create food order + items `{restaurant_id, items[], ...}` |
| POST | `/api/orders/grocery` | Create grocery order + items |
| POST | `/api/rides` | Create ride `{pickup/drop lat/lng/address, vehicle_type, ...}` |
| POST | `/api/packages` | Create package delivery `{pickup/drop, package_size, receiver_...}` |
| GET | `/api/orders/me` | All my orders (food/grocery/rides/packages) |
| GET | `/api/track/{ride\|package\|food\|grocery}/{id}` | Order details + rider location |
| POST | `/api/live-location` | Riders PATCH `{table, row_id, rider_lat/lng}` |
| GET | `/api/catalog/restaurants` | List restaurants |
| GET | `/api/catalog/restaurants/{id}` | Restaurant + available menu items |
| GET | `/api/catalog/stores` | List grocery stores |
| GET | `/api/catalog/stores/{id}` | Store + available items |

#### Rider/Delivery
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/delivery/available` | Pending food/grocery (status: ready/preparing, no rider) |
| GET | `/api/delivery/active` | My active food/grocery |
| POST | `/api/delivery/{food\|grocery}/{id}/accept` | Assign to self |
| POST | `/api/delivery/{food\|grocery}/{id}/advance` | `{status: 'picked_up\|en_route\|delivered'}` |
| GET | `/api/rider/jobs` | Available/active rides/packages |
| GET | `/api/rider/active?id=&kind=` | Specific job details |
| POST | `/api/rider/rides/{id}/accept` | |
| POST | `/api/rider/packages/{id}/accept` | |
| POST | `/api/rider/{rides\|package_deliveries}/{id}/advance` | Update status |
| POST | `/api/rider/{rides\|package_deliveries}/{id}/cancel` | |

#### Hotel/Restaurant Manager
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hotel/dashboard` | My restaurant + order stats |
| PUT | `/api/hotel/restaurant` | Create/update my restaurant |
| GET | `/api/hotel/menu` | My menu items |
| POST/PUT/DELETE | `/api/hotel/menu[/{id}]` | CRUD items |
| POST | `/api/hotel/menu/{id}/toggle` | `{is_available}` |
| GET | `/api/hotel/orders` | My orders w/ items |
| POST | `/api/hotel/orders/{id}/advance` | Update status |

#### Grocery Manager (similar)
`/api/grocery/*` mirrors hotel (dashboard/store/items/orders/advance).

#### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Counts (users/orders/etc.) |
| GET | `/api/admin/restaurants` | List + managers/orders |
| POST/PUT/DELETE | `/api/admin/restaurants[/{id}]` | CRUD |
| POST | `/api/admin/restaurants/{id}/toggle` | `{is_open}` |
| POST | `/api/admin/restaurants/{id}/grant-revoke-manager` | Assign/revoke hotel_manager role |
| GET/POST/PUT/DELETE | `/api/admin/stores[/{id}]` | Grocery stores CRUD |
| GET | `/api/admin/users` | Profiles + roles |
| POST | `/api/admin/users/{id}/roles/toggle` | `{role, has_role: bool}` |

#### Utilities
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/profile` | My profile |
| PUT | `/api/profile` | Update name/phone |
| GET | `/api/map/route?fromLat=&fromLng=&toLat=&toLng=` | OSRM route coords (public) |

### Database Schema Overview
**Core Tables** (exact columns inferred from queries; see migrations for full):
- `profiles` (id, full_name, phone)
- `user_roles` (user_id, role) – roles: customer, delivery_boy, hotel_manager, grocery_manager, admin
- `restaurants` (id, name, description, address, image_url, is_open, manager_id)
- `menu_items` (id, restaurant_id, name, price, category, is_available, is_veg, ...)
- `food_orders` (id, customer_id, restaurant_id, status, total, delivery_address, rider_id/delivery_boy_id, rider_lat/lng/location_updated_at, ...)
- `food_order_items` (order_id, menu_item_id, name, price, quantity)
- `grocery_stores`, `grocery_items`, `grocery_orders`, `grocery_order_items` (analogous)
- `rides` (id, customer_id/rider_id, status, pickup/drop lat/lng/address, fare_estimate, vehicle_type, ...)
- `package_deliveries` (id, ..., package_size, receiver_name/phone, ...)

Status enums: pending/accepted/preparing/ready/picked_up/en_route/delivered/cancelled/paid.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ (npm or [Bun](https://bun.sh) recommended)
- [Supabase Account](https://supabase.com) (free tier works)
- Git

```bash
git clone <repo-url>
cd swift-deliveries-main

npm install

echo 'SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key  # Optional: for admin
HOST=localhost
PORT=3000' > .env

cd backend/supabase
npx supabase db push
cd ../..

npm run dev  # Parallel backend:3000 + frontend dev
```

Open http://localhost:3000.

### Docker

Build and run the production container with Docker Compose:

```bash
docker compose up --build
```

The app will be available at http://localhost:4000.

Or build and run the image directly:

```bash
docker build -t zoomly-fullstack:latest .
docker run --env-file .env -p 4000:4000 zoomly-fullstack:latest
```

Make sure `.env` contains the Supabase variables from `.env.example`. The Docker runtime binds the backend to `0.0.0.0:4000` so it works with published container ports.

## 📊 Enhanced Workflow Diagram

```mermaid
graph TD
    A[Browser localhost:3000] --> B{Dev?}
    B -->|Yes| C[Vite SPA + /api proxy → Backend:4000?]
    B -->|No| D[Backend serves SSR/API/Assets]
    
    C --> E[TanStack Query useQuery('/api/orders/me')]
    D --> E
    
    E --> F[fetch w/ cookies]
    F --> G[Backend server.mjs]
    G --> H{Auth?}
    H -->|Public| I[Supabase REST]
    H -->|Private| J[Token/Refresh → Supabase REST]
    I --> K[JSON Response]
    J --> K
    K --> E --> L[React UI Renders/Maps/Charts]
    
    subgraph \"Supabase\"
        M[Postgres: Orders/Users/...]
        N[Auth: JWT Sessions]
    end
    I -.-> M & N
    J -.-> M & N
```

## 📁 Project Structure
(Unchanged from original + new insights above)

## ✨ Features / 🔧 Local Development / 🌍 Environment Variables / 🗄️ Database Setup / ☁️ Deployment / 🤝 Contributing / 📄 License
(Unchanged from original README.md content)

---
*Updated with full technical deep-dive!*
