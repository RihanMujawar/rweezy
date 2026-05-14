# Zoomly - Multi-Service Delivery Platform

Zoomly is a full-stack delivery marketplace for food delivery, grocery delivery, ride booking, and package transfer. The project includes role-based experiences for customers, riders, food/grocery delivery partners, restaurant managers, grocery store managers, and admins.

The app uses a React 19 frontend, a Node.js ESM backend, Supabase Auth/Postgres, Mapbox maps and routing, TanStack Router, TanStack Query, Tailwind CSS 4, and Docker production packaging.

## What The Project Currently Includes

### Customer app

- Register and login with email/password or Indian phone number plus password.
- Browse restaurants and grocery stores.
- Add food and grocery items to carts and checkout.
- Book rides with pickup/drop pins, vehicle selection, fare estimate, and route distance.
- Create package delivery requests with pickup/drop, receiver details, and package size.
- View order history across food, grocery, rides, and packages.
- Track active services with rider location polling, ETA estimate, route map, and chat.
- Update profile name and phone number.

### Partner and rider apps

- Delivery partner dashboard for food and grocery jobs.
- Rider dashboard for ride and package jobs.
- Accept available jobs, view active job details, advance job statuses, cancel supported jobs, and broadcast live rider location.

### Merchant apps

- Restaurant manager dashboard.
- Restaurant profile create/update.
- Menu item CRUD, availability toggle, and restaurant order workflow.
- Grocery store manager dashboard.
- Grocery store profile create/update.
- Grocery item CRUD, availability toggle, and grocery order workflow.

### Admin app

- Admin dashboard with platform counts.
- Analytics for restaurant income, grocery income, delivery activity, and tracked distance.
- User and role management.
- Restaurant CRUD, open/closed toggle, and manager assignment.
- Grocery store CRUD.

### Platform features

- Cookie-based Supabase auth handled by the backend.
- Automatic access token refresh using refresh cookies.
- Supabase REST access wrapped behind backend routes.
- Mapbox geocoding, route display, and browser geolocation support.
- Chat messages between customers and assigned riders/delivery partners.
- Docker image and Docker Compose setup.
- Supabase migrations in `backend/supabase/migrations`.

## Tech Stack

| Area | Tools |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, TanStack Router, TanStack Query |
| UI | Tailwind CSS 4, Radix UI primitives, lucide-react, sonner |
| Maps | Mapbox GL, Mapbox Geocoding, Mapbox Directions |
| Backend | Node.js ESM HTTP server |
| Database/Auth | Supabase Auth, Supabase Postgres, Supabase REST |
| State | React context, local cart stores, Zustand dependency available |
| Deployment | Docker, Docker Compose |

## Project Structure

```text
.
├── backend/
│   ├── lib/
│   │   ├── env.mjs
│   │   ├── http.mjs
│   │   └── supabase.mjs
│   ├── server.mjs
│   └── supabase/
│       ├── config.toml
│       └── migrations/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── integrations/supabase/
│   │   ├── lib/
│   │   ├── routes/
│   │   ├── router.tsx
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   └── dev.mjs
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 20+ recommended. The Docker image uses Node 22.
- npm.
- Supabase project.
- Mapbox public token for maps, geocoding, and routing.
- Supabase CLI if you want to push migrations from this repo.

### Install dependencies

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

### Configure environment

Create `.env` in the project root. You can start from `.env.example`.

```env
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_PUBLISHABLE_KEY="your-supabase-publishable-key"
SUPABASE_SERVICE_ROLE_KEY="your-supabase-service-role-key"

VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="your-supabase-publishable-key"
VITE_SUPABASE_PROJECT_ID="your-project-ref"

MAPBOX_ACCESS_TOKEN="your-mapbox-public-token"
VITE_MAPBOX_ACCESS_TOKEN="your-mapbox-public-token"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="4000"
FRONTEND_DEV_URL="http://127.0.0.1:3000"
```

Optional for Supabase CLI migrations:

```env
SUPABASE_DB_URL="postgresql://postgres:[YOUR-PASSWORD]@db.your-project-ref.supabase.co:5432/postgres"
```

Important security note: keep `SUPABASE_SERVICE_ROLE_KEY` backend-only. Never expose it as a `VITE_` variable.

### Apply database migrations

From the backend Supabase folder:

```bash
cd backend/supabase
npx supabase db push
cd ../..
```

Or link your Supabase project first if your CLI workflow requires it:

```bash
npx supabase link --project-ref your-project-ref
npx supabase db push
```

### Run locally

```bash
npm run dev
```

The root dev script starts both services:

- Backend: `backend/server.mjs` with `node --watch`, default port `4000`.
- Frontend: Vite dev server, default port `3000`.
- Frontend `/api/*` requests are proxied to the backend.

Open:

```text
http://127.0.0.1:3000
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start backend and frontend together. |
| `npm run dev:backend` | Start only the backend. |
| `npm run dev:frontend` | Start only the frontend. |
| `npm run build` | Run backend syntax check and frontend production build. |
| `npm run build:backend` | Check `backend/server.mjs` with Node. |
| `npm run build:frontend` | Build the Vite frontend. |
| `npm run lint` | Run frontend ESLint. |
| `npm run start` | Start the backend production server. |

## Docker

Run the production container with Docker Compose:

```bash
docker compose up --build
```

The app is served by the backend at:

```text
http://127.0.0.1:4000
```

Build and run manually:

```bash
docker build -t zoomly-fullstack:latest .
docker run --env-file .env -p 4000:4000 zoomly-fullstack:latest
```

## Runtime Architecture

```text
Browser
  -> React frontend
  -> /api/* requests with cookies
  -> Node backend
  -> Supabase Auth and Supabase REST
  -> Supabase Postgres
```

In development, Vite serves the frontend and proxies `/api/*` to the backend. In production, `backend/server.mjs` serves the built frontend assets and API from the same origin.

Auth is cookie-based:

- `zoomly_access_token` stores the short-lived Supabase access token.
- `zoomly_refresh_token` stores the refresh token.
- Backend refreshes expired access tokens and clears cookies on logout.

## API Summary

All routes live under `/api`.

### Public routes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check. |
| `POST` | `/api/auth/login` | Login with email or phone plus password. |
| `POST` | `/api/auth/register` | Register user and assign initial role. |
| `POST` | `/api/auth/logout` | Revoke session and clear cookies. |
| `GET` | `/api/map/route` | Fetch Mapbox route coordinates. |

### Authenticated routes

| Area | Endpoints |
| --- | --- |
| Auth/profile | `/api/auth/me`, `/api/profile` |
| Catalog | `/api/catalog/restaurants`, `/api/catalog/restaurants/:id`, `/api/catalog/stores`, `/api/catalog/stores/:id` |
| Customer orders | `/api/orders/food`, `/api/orders/grocery`, `/api/orders/me`, `/api/rides`, `/api/packages` |
| Tracking and chat | `/api/track/:kind/:id`, `/api/chat/:kind/:id`, `/api/live-location` |
| Delivery partners | `/api/delivery/available`, `/api/delivery/active`, `/api/delivery/:kind/:id/accept`, `/api/delivery/:kind/:id/advance` |
| Riders | `/api/rider/jobs`, `/api/rider/active`, `/api/rider/rides/:id/accept`, `/api/rider/packages/:id/accept`, `/api/rider/:table/:id/advance`, `/api/rider/:table/:id/cancel` |
| Restaurant managers | `/api/hotel/dashboard`, `/api/hotel/restaurant`, `/api/hotel/menu`, `/api/hotel/orders` |
| Grocery managers | `/api/grocery/dashboard`, `/api/grocery/store`, `/api/grocery/items`, `/api/grocery/orders` |
| Admin | `/api/admin/stats`, `/api/admin/analytics`, `/api/admin/users`, `/api/admin/restaurants`, `/api/admin/stores` |

## Database Notes

The schema is managed through SQL migrations in `backend/supabase/migrations`.

Main tables used by the app:

- `profiles`
- `user_roles`
- `restaurants`
- `menu_items`
- `food_orders`
- `food_order_items`
- `grocery_stores`
- `grocery_items`
- `grocery_orders`
- `grocery_order_items`
- `rides`
- `package_deliveries`
- `chat_messages`

Roles used by the UI and backend:

- `customer`
- `delivery_boy`
- `rider`
- `hotel_manager`
- `grocery_manager`
- `admin`

## User-Friendly Updates To Prioritize

After checking the codebase, these are the highest-impact improvements to make the project friendlier for real users.

### 1. Improve onboarding and role setup

- Add a clear post-register onboarding step instead of always registering as `customer`.
- Explain how a user becomes a rider, delivery partner, restaurant manager, or grocery manager.
- Add admin invite/approval flows for business and delivery roles.
- Add demo credentials or a seed script for each role so testers can explore quickly.

### 2. Make location entry easier

- Auto-fill address text after users pick a map pin.
- Let users choose saved addresses from their profile.
- Replace the current default Bangalore map center with user location when permission is allowed.
- Add clearer map empty states when Mapbox tokens are missing or network requests fail.

### 3. Strengthen order and checkout confidence

- Add order confirmation screens with receipt details after placing food, grocery, ride, or package requests.
- Show item-level validation before checkout, including unavailable items and quantity limits.
- Add payment method UI or clearly label payments as cash/manual/demo.
- Add cancellation flows and cancellation rules for customers.

### 4. Improve tracking and live updates

- Replace polling for tracking and chat with Supabase Realtime or another realtime channel.
- Show rider/delivery partner name, phone/contact action, vehicle details, and last seen time.
- Add proper food/grocery pickup coordinates so tracking does not use the rider location as a substitute pickup point.
- Add push/toast updates when a status changes.

### 5. Polish mobile usability

- Test every route on small screens, especially forms, maps, sidebars, carts, and admin tables.
- Keep action buttons sticky on long checkout and active-job screens.
- Add skeleton loading states instead of plain `Loading...` text.
- Add better empty states for no restaurants, no groceries, no orders, no active jobs, and no available jobs.

### 6. Add stronger form validation

- Centralize validation with Zod schemas shared between UI and backend expectations.
- Validate backend request bodies before writing to Supabase.
- Show inline field errors, not only toast messages.
- Add phone number handling beyond hard-coded `+91` if the app should support more countries.

### 7. Improve accessibility

- Check keyboard navigation for maps, sidebars, dialogs, carts, and admin tables.
- Add accessible names to icon-only controls where missing.
- Check color contrast for status badges, muted text, gradients, and dark mode.
- Avoid relying only on color for pickup/drop/status meaning.

### 8. Make admin and merchant workflows safer

- Add confirmation dialogs for destructive actions like deleting restaurants, stores, menu items, and grocery items.
- Add audit-friendly messages for role changes and manager assignment changes.
- Add pagination, search, and filters to large admin lists.
- Add optimistic updates or clearer success states after CRUD actions.

### 9. Production hardening

- Add automated tests for backend routes and critical frontend flows.
- Add lint/typecheck/build to CI.
- Add rate limiting for login/register/chat/location endpoints.
- Review RLS policies and backend service-role usage before production launch.
- Add logging/monitoring for failed Supabase, Mapbox, and auth requests.

## Current Gaps To Know

- There are no automated tests configured yet.
- Backend request validation is mostly manual and route-specific.
- Realtime chat/tracking is implemented with polling.
- The README documents the intended setup, but actual production readiness depends on correct Supabase RLS policies, environment variables, and seeded data.

## Build For Production

```bash
npm run build
npm run start
```

Production server behavior:

- Serves `/api/*` from the backend.
- Serves built frontend assets from `frontend/dist/client`.
- Uses the frontend server entry from `frontend/dist/server/index.js` when available.
- Falls back to `index.html` for SPA routes.

## Contributing

1. Keep changes scoped to one feature or fix.
2. Run `npm run lint` and `npm run build` before opening a pull request.
3. Update Supabase migrations when schema changes are required.
4. Update this README when setup, routes, roles, or workflows change.

## License

No license file is currently included in this repository. Add one before distributing or publishing the project.
