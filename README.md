# Rweezy - Multi-Service Delivery Platform

Rweezy is a full-stack delivery marketplace for food delivery, grocery delivery, ride booking, and package transfer. The project includes role-based experiences for customers, riders, delivery partners, restaurant managers, grocery store managers, and admins.

The platform consists of three main components:
- **Web Application**: React 19 frontend with TypeScript, Vite, TanStack Router, TanStack Query, Tailwind CSS 4
- **Android Application**: Native Kotlin app with Jetpack Compose UI
- **Backend**: Node.js ESM server with Supabase Auth/Postgres, Mapbox maps and routing
- **Docker**: Production packaging for the web platform

## Tech Stack

| Area | Tools |
| --- | --- |
| Web Frontend | React 19, TypeScript, Vite, TanStack Router, TanStack Query |
| Mobile App | Kotlin, Jetpack Compose, Android Jetpack, Material Design 3 |
| UI (Web) | Tailwind CSS 4, Radix UI primitives, lucide-react, sonner, shadcn/ui components |
| Maps | Mapbox GL, Mapbox Geocoding, Mapbox Directions |
| Forms | React Hook Form, Zod validation |
| Backend | Node.js ESM HTTP server |
| Database/Auth | Supabase Auth, Supabase Postgres, Supabase REST |
| State | React context, Zustand for cart management |
| Testing | Node test runner, Playwright for E2E, JUnit for Android |
| Deployment | Docker, Docker Compose |

## What The Project Currently Includes

### Customer App

- Register and login with email/password or Indian phone number plus password
- Choose customer access immediately or request rider, delivery partner, restaurant manager, or grocery manager access for admin approval
- Save profile addresses and reuse them during checkout
- Browse restaurants and grocery stores
- Browse restaurants and grocery stores filtered by saved/default user location
- Add food and grocery items to carts and checkout
- Book rides with pickup/drop pins, vehicle selection, fare estimate, and route distance
- Create package delivery requests with pickup/drop, receiver details, and package size
- View order history across food, grocery, rides, and packages
- Confirm food/grocery orders with receipt details and cancel active customer requests before pickup/start
- Track active services with rider location polling, ETA estimate, route map, and chat
- Update profile name and phone number

### Partner and Rider Apps

- Delivery partner dashboard for food and grocery jobs
- Rider dashboard for ride and package jobs
- Accept available jobs, view active job details, advance job statuses, cancel supported jobs, and broadcast live rider location

### Merchant Apps

- Restaurant manager dashboard
- Restaurant profile create/update
- Menu item CRUD, availability toggle, and restaurant order workflow
- Grocery store manager dashboard
- Grocery store profile create/update
- Grocery item CRUD, availability toggle, and grocery order workflow

### Admin App

- Admin dashboard with platform counts
- Analytics for restaurant income, grocery income, delivery activity, and tracked distance
- User and role management
- Admin review flow for pending rider, delivery partner, restaurant manager, and grocery manager requests
- Restaurant CRUD, open/closed toggle, and manager assignment
- Grocery store CRUD
- Configure catalog discovery radius (km) for location-based listings

### Platform Features

- Cookie-based Supabase auth handled by the backend
- Automatic access token refresh using refresh cookies
- Supabase REST access wrapped behind backend routes
- Mapbox geocoding, route display, and browser geolocation support
- Chat messages between customers and assigned riders/delivery partners
- Rate limiting on sensitive endpoints (auth, chat, orders, live location)
- Docker image and Docker Compose setup
- Supabase migrations in `backend/supabase/migrations`

## Project Structure

```text
.
├── android/                      # Native Android application
│   ├── app/
│   │   ├── src/
│   │   │   ├── androidTest/     # Instrumented UI tests
│   │   │   ├── main/
│   │   │   │   ├── java/com/example/rweezy/
│   │   │   │   │   ├── data/    # Repositories
│   │   │   │   │   ├── theme/   # Material Design 3 theme
│   │   │   │   │   └── ui/      # Compose UI screens
│   │   │   │   └── res/         # App resources
│   │   │   └── test/            # Local unit tests
│   │   └── build.gradle.kts
│   ├── gradle/
│   │   └── libs.versions.toml
│   └── build.gradle.kts
├── backend/
│   ├── lib/
│   │   ├── env.mjs
│   │   ├── http.mjs
│   │   ├── logger.mjs
│   │   ├── platform-helpers.mjs
│   │   ├── rate-limit.mjs
│   │   ├── request-utils.mjs
│   │   └── supabase.mjs
│   ├── server.mjs
│   ├── supabase/
│   │   ├── config.toml
│   │   └── migrations/
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/          # shadcn/ui components
│   │   │   └── ...          # feature components
│   │   ├── integrations/supabase/
│   │   ├── lib/
│   │   ├── routes/
│   │   │   ├── __root.tsx
│   │   │   ├── _protected/
│   │   │   │   ├── admin/
│   │   │   │   ├── app/
│   │   │   │   ├── delivery/
│   │   │   │   ├── grocery-admin/
│   │   │   │   ├── hotel/
│   │   │   │   └── rider/
│   │   │   └── ...
│   │   ├── router.tsx
│   │   ├── routeTree.gen.ts
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts
├── e2e/                     # Playwright E2E tests
├── tests/                   # Node unit tests
├── scripts/
│   ├── dev.mjs
│   └── seed-demo-users.mjs
├── .env.example
├── docker-compose.yml
├── Dockerfile
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

**For Web Platform:**
- Node.js 20+ recommended. The Docker image uses Node 22.
- npm
- Supabase project
- Mapbox public token for maps, geocoding, and routing
- Supabase CLI if you want to push migrations from this repo

**For Android App:**
- Android Studio (latest version)
- JDK 17
- Android SDK 36 (compileSdk), minSdk 24
- Kotlin 2.3.20

### Install Dependencies

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

### Configure Environment

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

VITE_FIREBASE_API_KEY="your-firebase-api-key"
VITE_FIREBASE_AUTH_DOMAIN="your-project-id.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-project-id"
VITE_FIREBASE_STORAGE_BUCKET="your-project-id.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="your-firebase-messaging-sender-id"
VITE_FIREBASE_APP_ID="your-firebase-web-app-id"
VITE_FIREBASE_VAPID_KEY="your-web-push-vapid-public-key"
FCM_SERVER_KEY="your-firebase-server-key"

BACKEND_HOST="127.0.0.1"
BACKEND_PORT="4000"
FRONTEND_DEV_URL="http://127.0.0.1:3000"

# Optional production hardening knobs
# Logging: set to "warn" (or "error") in production to reduce noise.
LOG_LEVEL="info"
# Rate limiting: set to "false" to disable (not recommended).
RATE_LIMIT_ENABLED="true"
# CORS:
# - set CORS_ALLOW_ALL="true" to allow any Origin (dev convenience)
# - otherwise set a comma-separated allowlist in CORS_ALLOWED_ORIGINS
CORS_ALLOW_ALL="false"
CORS_ALLOWED_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
# Cookie security for production deployments.
COOKIE_SECURE="true"
```

Optional for Supabase CLI migrations:

```env
SUPABASE_DB_URL="postgresql://postgres:[YOUR-PASSWORD]@db.your-project-ref.supabase.co:5432/postgres"
```

> **Important security note:** Keep `SUPABASE_SERVICE_ROLE_KEY` backend-only. Never expose it as a `VITE_` variable.

### Apply Database Migrations

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

### Run Web Platform Locally

```bash
npm run dev
```

The root dev script starts both services:

- **Backend:** `backend/server.mjs` with `node --watch`, default port `4000`
- **Frontend:** Vite dev server, default port `3000`
- Frontend `/api/*` requests are proxied to the backend

Open:

```text
http://127.0.0.1:3000
```

### Run Android App

1. Open the `android/` directory in Android Studio
2. Sync the project with Gradle files
3. Run on an emulator or physical device

**Firebase Cloud Messaging (FCM) setup (Android):**
- Create a Firebase project and add an Android app with package id `com.example.rweezy`
- Download `google-services.json` and place it in `android/app/google-services.json`
- In Firebase Console, enable Cloud Messaging
- For Android 13+, allow notification permission on first app launch
- Send a test notification from Firebase Console and verify it appears on device

### Web Push Notifications (FCM)

- Web push service worker is available at `frontend/public/firebase-messaging-sw.js`
- Frontend auto-registers browser tokens after login and sends them to `POST /api/notifications/token`
- Saved tokens are stored in Supabase table `public.user_push_tokens`
- Admin test endpoint: `POST /api/admin/notifications/test`
  - payload with direct token:
    - `{ "token": "<FCM_TOKEN>", "title": "Test", "body": "Hello from backend" }`
  - payload with user id:
    - `{ "user_id": "<auth-user-id>", "title": "Test", "body": "Hello from backend" }`

**Connecting to Development Server:**
- For Android Emulator (default): Use `http://10.0.2.2:4000` to connect to the backend.
- For Physical Device: Use your computer's local IP address (e.g., `http://192.168.1.x:3000`)
- The app includes a settings dialog (FAB button) to configure the server URL at runtime

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start backend and frontend together |
| `npm run dev:backend` | Start only the backend |
| `npm run dev:frontend` | Start only the frontend |
| `npm run build` | Run backend syntax check and frontend production build |
| `npm run build:backend` | Check `backend/server.mjs` with Node |
| `npm run build:frontend` | Build the Vite frontend |
| `npm run lint` | Run frontend ESLint |
| `npm run format` | Format frontend with Prettier |
| `npm test` | Run Node unit tests (helpers, validation, rate limits) |
| `npm run test:e2e` | Run Playwright E2E tests (requires build + demo seed) |
| `npm run test:e2e:full` | Build + seed demo users + run Playwright E2E |
| `npm run seed:demo` | Create demo users for customer, rider, delivery, merchant, grocery, and admin roles |
| `npm run start` | Start the backend production server |

### Demo Users

After migrations are applied and `.env` contains `SUPABASE_SERVICE_ROLE_KEY`, seed role-specific demo accounts:

```bash
npm run seed:demo
```

The default password is `Demo123456`. Override it with `DEMO_PASSWORD="your-password" npm run seed:demo`.

## Testing

```bash
# Unit tests
npm test

# Format and lint
npm run format
npm run lint

# Production build
npm run build
```

Optional API tests against a running backend:

```bash
npm run dev:backend
TEST_API_BASE_URL=http://127.0.0.1:4000 npm test
```

Playwright (after build and demo seed):

```bash
npm run build
npm run seed:demo
npm run test:e2e
```

See `TEST_REPORT.md` for production readiness notes.

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
docker build -t rweezy-fullstack:latest .
docker run --env-file .env -p 4000:4000 rweezy-fullstack:latest
```

## Android Application

The Android app is a native Kotlin application built with Jetpack Compose that wraps the web platform in a WebView, providing a native mobile experience.

### Features

- **WebView-based**: Loads the web application with full feature parity
- **Geolocation Support**: Handles location permissions for delivery tracking
- **File Upload**: Supports image and file uploads through the WebView
- **Back Navigation**: Proper back button integration with WebView history
- **Server Configuration**: Runtime configuration for connecting to different backend servers
- **Error Recovery**: Premium error UI with retry and server configuration options
- **Progress Indicator**: Loading progress bar for page loads
- **Material Design 3**: Modern UI following Android design guidelines

### Android Tech Stack

| Component | Technology |
| --- | --- |
| Language | Kotlin 2.3.20 |
| UI Framework | Jetpack Compose |
| Navigation | AndroidX Navigation 3 |
| Architecture | MVVM with ViewModel |
| Design | Material Design 3 |
| Testing | JUnit, AndroidX Test, Espresso |

### Building the Android App

```bash
cd android
./gradlew build
```

To build a release APK:

```bash
./gradlew assembleRelease
```

### Android Project Structure

```
android/
├── app/src/main/java/com/example/rweezy/
│   ├── MainActivity.kt          # Main activity entry point
│   ├── Navigation.kt            # Navigation configuration
│   ├── NavigationKeys.kt        # Navigation route keys
│   ├── data/
│   │   ├── DataRepository.kt    # Data layer
│   │   └── ServerConfigRepository.kt  # Server URL persistence
│   ├── theme/
│   │   ├── Color.kt             # Material Design 3 color scheme
│   │   ├── Theme.kt             # App theme definition
│   │   └── Type.kt              # Typography configuration
│   └── ui/
│       ├── WebViewScreen.kt     # Main WebView with error handling
│       └── main/
│           ├── MainScreen.kt    # Main screen layout
│           └── MainScreenViewModel.kt  # ViewModel
```

### Android Minimum Requirements

- **minSdk**: 24 (Android 7.0)
- **targetSdk**: 36
- **compileSdk**: 36
- **JVM Target**: Java 17

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

### Authentication

Auth is cookie-based:

- `rweezy_access_token` stores the short-lived Supabase access token
- `rweezy_refresh_token` stores the refresh token
- Backend refreshes expired access tokens and clears cookies on logout

## API Summary

All routes live under `/api`.

### Public Routes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Login with email or phone plus password |
| `POST` | `/api/auth/register` | Register user and assign initial role |
| `POST` | `/api/auth/logout` | Revoke session and clear cookies |
| `GET` | `/api/map/route` | Fetch Mapbox route coordinates |

### Authenticated Routes

| Area | Endpoints |
| --- | --- |
| Auth/profile | `/api/auth/me`, `/api/profile`, `/api/profile/addresses` |
| Catalog | `/api/catalog/restaurants`, `/api/catalog/restaurants/:id`, `/api/catalog/stores`, `/api/catalog/stores/:id`, `/api/catalog/items/food`, `/api/catalog/items/grocery` |
| Customer orders | `/api/orders/food`, `/api/orders/grocery`, `/api/orders/me`, `/api/rides`, `/api/packages` |
| Tracking and chat | `/api/track/:kind/:id`, `/api/chat/:kind/:id`, `/api/live-location` |
| Delivery partners | `/api/delivery/available`, `/api/delivery/active`, `/api/delivery/:kind/:id/accept`, `/api/delivery/:kind/:id/advance` |
| Riders | `/api/rider/jobs`, `/api/rider/active`, `/api/rider/rides/:id/accept`, `/api/rider/packages/:id/accept`, `/api/rider/:table/:id/advance`, `/api/rider/:table/:id/cancel` |
| Restaurant managers | `/api/hotel/dashboard`, `/api/hotel/restaurant`, `/api/hotel/menu`, `/api/hotel/orders` |
| Grocery managers | `/api/grocery/dashboard`, `/api/grocery/store`, `/api/grocery/items`, `/api/grocery/orders` |
| Admin | `/api/admin/stats`, `/api/admin/analytics`, `/api/admin/users`, `/api/admin/restaurants`, `/api/admin/stores`, `/api/admin/health`, `/api/admin/commissions`, `/api/admin/catalog-settings` |

### Catalog Radius Setting (Admin)

Customer catalog endpoints (`/api/catalog/restaurants`, `/api/catalog/stores`, and popular item feeds) are filtered by user location.  
The backend checks:

1. Default/latest saved address coordinates (`saved_addresses.lat/lng`) and applies a distance radius.
2. If coordinates are missing, it falls back to `pincode` and then `town_name` matching.

The radius is configurable from admin APIs:

- `GET /api/admin/catalog-settings` -> current radius + min/max/default limits
- `PUT /api/admin/catalog-settings` with body `{ "radius_km": 15 }` -> saves radius

Defaults and limits in backend:

- Default: `25 km`
- Allowed range: `1` to `100` km

## Database Notes

The schema is managed through SQL migrations in `backend/supabase/migrations`.

### Main Tables

- `profiles`
- `user_roles`
- `role_requests`
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
- `saved_addresses`
- `platform_settings`
- `audit_events`

### User Roles

- `customer`
- `delivery_boy`
- `rider`
- `hotel_manager`
- `grocery_manager`
- `admin`

## User-Friendly Updates To Prioritize

After checking the codebase, these are the highest-impact improvements to make the project friendlier for real users.

### 1. Improve Onboarding and Role Setup

- Add a clear post-register onboarding step instead of always registering as `customer`
- Explain how a user becomes a rider, delivery partner, restaurant manager, or grocery manager
- Add admin invite/approval flows for business and delivery roles
- Add demo credentials or a seed script for each role so testers can explore quickly

### 2. Make Location Entry Easier

- Auto-fill address text after users pick a map pin
- Let users choose saved addresses from their profile
- Replace the current default Bangalore map center with user location when permission is allowed
- Add clearer map empty states when Mapbox tokens are missing or network requests fail

### 3. Strengthen Order and Checkout Confidence

- Add order confirmation screens with receipt details after placing food, grocery, ride, or package requests
- Show item-level validation before checkout, including unavailable items and quantity limits
- Add payment method UI or clearly label payments as cash/manual/demo
- Add cancellation flows and cancellation rules for customers

### 4. Improve Tracking and Live Updates

- Replace polling for tracking and chat with Supabase Realtime or another realtime channel
- Show rider/delivery partner name, phone/contact action, vehicle details, and last seen time
- Add proper food/grocery pickup coordinates so tracking does not use the rider location as a substitute pickup point
- Add push/toast updates when a status changes

### 5. Polish Mobile Usability

- Test every route on small screens, especially forms, maps, sidebars, carts, and admin tables
- Keep action buttons sticky on long checkout and active-job screens
- Add skeleton loading states instead of plain `Loading...` text
- Add better empty states for no restaurants, no groceries, no orders, no active jobs, and no available jobs

### 6. Add Stronger Form Validation

- Centralize validation with Zod schemas shared between UI and backend expectations
- Validate backend request bodies before writing to Supabase
- Show inline field errors, not only toast messages
- Add phone number handling beyond hard-coded `+91` if the app should support more countries

### 7. Improve Accessibility

- Check keyboard navigation for maps, sidebars, dialogs, carts, and admin tables
- Add accessible names to icon-only controls where missing
- Check color contrast for status badges, muted text, gradients, and dark mode
- Avoid relying only on color for pickup/drop/status meaning

### 8. Make Admin and Merchant Workflows Safer

- Add confirmation dialogs for destructive actions like deleting restaurants, stores, menu items, and grocery items
- Add audit-friendly messages for role changes and manager assignment changes
- Add pagination, search, and filters to large admin lists
- Add optimistic updates or clearer success states after CRUD actions

### 9. Production Hardening

- Add automated tests for backend routes and critical frontend flows
- Add lint/typecheck/build to CI
- Add rate limiting for login/register/chat/location endpoints
- Review RLS policies and backend service-role usage before production launch
- Add logging/monitoring for failed Supabase, Mapbox, and auth requests

## Current Gaps To Know

- E2E tests need a running server and `npm run seed:demo` against your Supabase project
- Backend request validation is mostly manual and route-specific beyond shared Zod schemas
- Realtime chat/tracking uses polling rather than Supabase Realtime subscriptions everywhere
- Production readiness depends on correct Supabase RLS policies, environment variables, and seeded data

## Build For Production

```bash
npm run build
npm run start
```

Production server behavior:

- Serves `/api/*` from the backend
- Serves built frontend assets from `frontend/dist/client`
- Uses the frontend server entry from `frontend/dist/server/index.js` when available
- Falls back to `index.html` for SPA routes

## Contributing

1. Keep changes scoped to one feature or fix
2. Run `npm run format`, `npm test`, `npm run lint`, and `npm run build` before opening a pull request
3. Update Supabase migrations when schema changes are required
4. Update this README when setup, routes, roles, or workflows change

## License

No license file is currently included in this repository. Add one before distributing or publishing the project.