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
| Phone OTP | Twilio Verify (SMS) |
| State | React context, Zustand for cart management |
| Testing | Node test runner, Playwright for E2E, JUnit for Android |
| Deployment | Docker, Docker Compose |

## What The Project Currently Includes

### Customer App

- Register with email, password, and Indian phone number — phone is verified by SMS OTP before signup completes
- Sign in with email/password or phone OTP (SMS one-time code)
- Reset password with dual verification: Supabase recovery email link plus SMS OTP on the registered phone
- Resend signup email verification from the login page when required
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
- Phone OTP via Twilio Verify for registration, phone login, and password reset
- Email verification on signup (Supabase) and password recovery email for reset flow
- Automatic access token refresh using refresh cookies
- Supabase REST access wrapped behind backend routes
- Mapbox geocoding, route display, and browser geolocation support
- Chat messages between customers and assigned riders/delivery partners
- Web and Android push notifications (Firebase Cloud Messaging) with device token storage
- Android native FCM for background notifications when the app is closed or minimized
- System dark/light theme on web and Android (follows OS setting; no manual theme toggle)
- Android app download prompt on mobile browsers (Android phones only; hidden inside the native app)
- Global in-app alerts on every protected page (role-based polling + toast/sound)
- Rate limiting on sensitive endpoints (auth, password reset, chat, orders, live location)
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
│   │   │   │   │   ├── data/        # Repositories
│   │   │   │   │   ├── messaging/   # FCM service + WebView JS bridge
│   │   │   │   │   ├── theme/       # Material Design 3 theme (system dark/light)
│   │   │   │   │   └── ui/          # Compose UI screens
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
│   │   ├── phone-verification.mjs
│   │   ├── platform-helpers.mjs
│   │   ├── rate-limit.mjs
│   │   ├── request-utils.mjs
│   │   ├── supabase.mjs
│   │   └── twilio.mjs
│   ├── server.mjs
│   ├── supabase/
│   │   ├── config.toml
│   │   └── migrations/
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                          # shadcn/ui components
│   │   │   ├── android-app-download-prompt.tsx
│   │   │   ├── global-notification-watcher.tsx
│   │   │   ├── phone-otp-verification.tsx
│   │   │   ├── system-theme-sync.tsx
│   │   │   └── ...                          # feature components
│   │   ├── integrations/supabase/
│   │   ├── hooks/                           # use-global-notifications, use-live-alerts, etc.
│   │   ├── lib/                             # api, auth, fcm, mobile-detect
│   │   ├── public/              # firebase-messaging-sw.js
│   │   ├── routes/
│   │   │   ├── __root.tsx
│   │   │   ├── forgot-password.tsx
│   │   │   ├── login.tsx
│   │   │   ├── register.tsx
│   │   │   ├── register-partner.tsx
│   │   │   ├── reset-password.tsx
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
- Twilio Verify service for phone OTP during registration, phone login, and password reset
- Supabase CLI if you want to push migrations from this repo

**For Android App:**
- Android Studio (latest version)
- JDK 21
- Android SDK 36 (compileSdk), minSdk 24
- Kotlin 2.3.20
- Firebase project with `google-services.json` for the Android app package `com.example.rweezy`

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
VITE_ANDROID_APP_URL=""
FCM_SERVER_KEY="your-firebase-server-key"

# Twilio Verify phone OTP.
TWILIO_ACCOUNT_SID="your-twilio-account-sid"
TWILIO_AUTH_TOKEN="your-twilio-auth-token"
TWILIO_VERIFY_SERVICE_SID="your-twilio-verify-service-sid"
# Local dev only: skip Twilio Verify and accept TWILIO_DEV_BYPASS_CODE.
TWILIO_DEV_BYPASS="false"
TWILIO_DEV_BYPASS_CODE="123456"
PHONE_VERIFICATION_SECRET="your-random-phone-verification-secret"
# Set to false to auto-confirm emails via admin API (dev/demo only)
AUTH_REQUIRE_EMAIL_VERIFICATION="true"

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

**Optional frontend variables:**

| Variable | Purpose |
| --- | --- |
| `VITE_ANDROID_APP_URL` | Play Store or direct APK link shown in the Android download popup on mobile browsers. Leave empty to show the message without a download button. |

**Optional backend variables:**

| Variable | Purpose |
| --- | --- |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify credentials for SMS OTP. |
| `TWILIO_DEV_BYPASS` | Set to `"true"` in local dev to skip Twilio Verify and accept `TWILIO_DEV_BYPASS_CODE`. |
| `PHONE_VERIFICATION_SECRET` | HMAC secret for short-lived phone verification tokens after OTP success. Falls back to service role key in dev. |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | Default `"true"`. Set to `"false"` to auto-confirm signup emails via admin API (dev/demo only). |

### Supabase Auth URL Configuration

In **Supabase Dashboard → Authentication → URL configuration**, set:

- **Site URL** — your production app origin (e.g. `https://your-domain.com`)
- **Redirect URLs** — include password reset landing pages, for example:
  - `http://127.0.0.1:3000/reset-password`
  - `http://localhost:3000/reset-password`
  - `https://your-domain.com/reset-password`

Recovery emails must redirect to `/reset-password` so the app can read `token_hash` from the URL and complete reset after phone OTP verification.

### Theme (Web and Android)

Both the website and Android app follow the **system dark/light setting**. There is no manual theme toggle in the UI.

- **Web:** `SystemThemeSync` listens to `prefers-color-scheme` and applies the Tailwind `dark` class.
- **Android:** Compose uses `isSystemInDarkTheme()`; the WebView disables forced darkening so the website CSS matches the OS theme.

### Android App Download Prompt (Web)

When someone opens the website on an **Android phone browser** (not inside the native app), a popup suggests installing the Android app.

- Shown only on Android phones (not iPhone, iPad, or desktop)
- Hidden inside the native Android WebView (`RweezyAndroidBridge`)
- Dismissed permanently when the user chooses **Continue on website**
- Set `VITE_ANDROID_APP_URL` to enable the **Download Android app** button

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
2. Add Firebase config (see below)
3. Sync the project with Gradle files
4. Run on an emulator or physical device

**Firebase / `google-services.json` (required to build):**

- Create a Firebase project and add an Android app with package id `com.example.rweezy`
- Download `google-services.json` from Firebase Console
- Place it at `android/app/google-services.json`
- A template is included at `android/app/google-services.json.example` for reference
- The real `google-services.json` is gitignored; each developer must add their own copy from Firebase

**Firebase Cloud Messaging (FCM) setup (Android):**

- In Firebase Console, enable Cloud Messaging
- For Android 13+, allow notification permission on first app launch
- Log in inside the app so the native FCM token is registered with the backend
- Send a test notification from Firebase Console or `POST /api/admin/notifications/test`

**Connecting to Development Server:**

- For Android Emulator (default): Use `http://10.0.2.2:4000` to connect to the backend.
- For Physical Device: Use your computer's local IP address (e.g., `http://192.168.1.x:3000`)
- The app includes a settings dialog (FAB button) to configure the server URL at runtime

### Push Notifications (FCM)

**Web (browser):**

- Web push service worker: `frontend/public/firebase-messaging-sw.js`
- After login, the app requests notification permission, registers the FCM token, and saves it via `POST /api/notifications/token` with `platform: "web"`
- Foreground FCM messages show as toasts on **any** protected page (`GlobalNotificationWatcher` in `_protected` layout)

**Android (native app):**

- The WebView does not use the browser service worker for push. Instead, `RweezyAndroidBridge` exposes the native FCM token to the website after login.
- Tokens are saved via `POST /api/notifications/token` with `platform: "android"`
- `RweezyFirebaseMessagingService` shows notifications when the app is in the **background or closed**
- Tapping a notification opens the app
- Notification channel id: `rweezy_updates`

**Shared backend behavior:**

- Tokens are stored in `public.user_push_tokens` (one row per device token; upserted on conflict)
- In-app alerts (new jobs, pending merchant orders, customer status changes) also run globally — not only on the orders/dashboard page
- Admin test send: `POST /api/admin/notifications/test`
  - By token: `{ "token": "<FCM_TOKEN>", "title": "Test", "body": "Hello" }`
  - By user: `{ "user_id": "<auth-user-id>", "title": "Test", "body": "Hello" }`

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
- **System theme**: Native shell and website follow OS dark/light mode
- **Geolocation Support**: Handles location permissions for delivery tracking
- **File Upload**: Supports image and file uploads through the WebView
- **Back Navigation**: System back navigates WebView history before exiting the app
- **Firebase Cloud Messaging**: Native push via `RweezyFirebaseMessagingService` (foreground, background, and app closed)
- **FCM token bridge**: `RweezyAndroidBridge` registers the native token with the backend after web login
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
├── app/
│   ├── google-services.json.example   # Firebase config template (copy to google-services.json)
│   └── src/main/java/com/example/rweezy/
│       ├── MainActivity.kt                # Main activity entry point
│       ├── Navigation.kt                  # Navigation configuration
│       ├── NavigationKeys.kt              # Navigation route keys
│       ├── data/
│       │   ├── DataRepository.kt          # Data layer
│       │   └── ServerConfigRepository.kt  # Server URL persistence
│       ├── messaging/
│       │   ├── RweezyAndroidBridge.kt     # WebView JS bridge for FCM token
│       │   └── RweezyFirebaseMessagingService.kt
│       ├── theme/
│       │   ├── Color.kt                   # Material Design 3 color scheme
│       │   ├── Theme.kt                   # App theme (system dark/light)
│       │   └── Type.kt                    # Typography configuration
│       └── ui/
│           ├── WebViewScreen.kt           # Main WebView with error handling
│           └── main/
│               ├── MainScreen.kt          # Main screen layout
│               └── MainScreenViewModel.kt # ViewModel
```

### Android Minimum Requirements

- **minSdk**: 24 (Android 7.0)
- **targetSdk**: 36
- **compileSdk**: 36
- **JVM Target**: Java 21

## Runtime Architecture

```text
Browser / Android WebView
  -> React frontend
  -> /api/* requests with cookies
  -> Node backend
  -> Supabase Auth and Supabase REST
  -> Supabase Postgres

Android (background push)
  -> Firebase Cloud Messaging
  -> RweezyFirebaseMessagingService
  -> system notification tray
```

In development, Vite serves the frontend and proxies `/api/*` to the backend. In production, `backend/server.mjs` serves the built frontend assets and API from the same origin.

### Authentication

Auth is cookie-based:

- `rweezy_access_token` stores the short-lived Supabase access token
- `rweezy_refresh_token` stores the refresh token
- Backend refreshes expired access tokens and clears cookies on logout

#### Sign up

1. User enters name, email, phone, and password on `/register` (or `/register-partner` for business roles).
2. User verifies phone with Twilio SMS OTP (`purpose: register`) and receives a short-lived `phone_verification_token`.
3. Backend creates the Supabase user and profile; if `AUTH_REQUIRE_EMAIL_VERIFICATION=true`, Supabase sends a confirmation email before email/password login works.

#### Sign in

- **Email:** `/login` → email + password → session cookies.
- **Phone:** `/login` → Twilio phone OTP (`purpose: login`) → backend resolves phone to account email and starts a session.

#### Password reset

1. User opens `/forgot-password` and submits their account email.
2. Backend sends a Supabase recovery email (if the account exists).
3. User opens the email link on `/reset-password` (provides `token_hash` in the URL).
4. User verifies the registered phone with Twilio SMS OTP (`purpose: reset_password`).
5. User sets a new password → backend verifies the recovery token and phone token, updates the password, and signs the user in.

Requires `SUPABASE_SERVICE_ROLE_KEY` (user lookup), Twilio Verify credentials, and redirect URLs configured in Supabase (see above).

## API Summary

All routes live under `/api`.

### Public Routes

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `POST` | `/api/auth/login` | Login with email and password |
| `POST` | `/api/auth/register` | Register user (requires phone verification token) |
| `POST` | `/api/auth/phone/send-otp` | Validate phone OTP request (`purpose`: `login`, `register`, or `reset_password`) and send SMS via Twilio |
| `POST` | `/api/auth/phone/verify-otp` | Verify Twilio OTP code; returns session (login) or phone token (register / reset) |
| `POST` | `/api/auth/email/resend-verification` | Resend signup confirmation email |
| `POST` | `/api/auth/password-reset/request` | Send password recovery email |
| `POST` | `/api/auth/password-reset/complete` | Set new password after email link + phone verification |
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
| Admin | `/api/admin/stats`, `/api/admin/analytics`, `/api/admin/users`, `/api/admin/restaurants`, `/api/admin/stores`, `/api/admin/health`, `/api/admin/commissions`, `/api/admin/catalog-settings`, `/api/admin/notifications/test` |
| Notifications | `POST /api/notifications/token` (save FCM device token for current user) |

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

## Database

PostgreSQL is hosted on **Supabase**. Auth users live in `auth.users`; application data lives in the `public` schema. Schema changes are applied with SQL migrations in `backend/supabase/migrations` (run `npx supabase db push` from `backend/supabase`).

### Enums

| Enum | Values | Used by |
| --- | --- | --- |
| `app_role` | `customer`, `admin`, `hotel_manager`, `grocery_manager`, `delivery_boy`, `rider` | `user_roles`, `role_requests` |
| `order_status` | `pending`, `accepted`, `preparing`, `ready`, `picked_up`, `delivered`, `cancelled` | `food_orders`, `grocery_orders` |
| `ride_status` | `requested`, `accepted`, `started`, `completed`, `cancelled` | `rides`, `package_deliveries` |

Helper function `public.has_role(user_id, role)` checks role membership (used heavily in RLS policies).

### Entity relationship overview

```mermaid
erDiagram
  auth_users ||--o| profiles : "1:1"
  auth_users ||--o{ user_roles : "has many"
  auth_users ||--o{ role_requests : "requests"
  auth_users ||--o{ saved_addresses : "owns"
  auth_users ||--o{ user_push_tokens : "devices"
  auth_users ||--o{ order_reviews : "writes"

  auth_users ||--o{ restaurants : "manages"
  restaurants ||--o{ menu_items : "menu"
  restaurants ||--o{ food_orders : "receives"
  auth_users ||--o{ food_orders : "customer"
  auth_users ||--o{ food_orders : "delivery_boy"
  food_orders ||--o{ food_order_items : "line items"
  menu_items ||--o{ food_order_items : "snapshot ref"

  auth_users ||--o{ grocery_stores : "manages"
  grocery_stores ||--o{ grocery_items : "catalog"
  grocery_stores ||--o{ grocery_orders : "receives"
  auth_users ||--o{ grocery_orders : "customer"
  auth_users ||--o{ grocery_orders : "delivery_boy"
  grocery_orders ||--o{ grocery_order_items : "line items"
  grocery_items ||--o{ grocery_order_items : "snapshot ref"

  auth_users ||--o{ rides : "customer"
  auth_users ||--o{ rides : "rider"
  auth_users ||--o{ package_deliveries : "customer"
  auth_users ||--o{ package_deliveries : "rider"

  chat_messages }o--|| rides : "service_kind=ride"
  chat_messages }o--|| package_deliveries : "service_kind=package"
  chat_messages }o--|| food_orders : "service_kind=food"
  chat_messages }o--|| grocery_orders : "service_kind=grocery"
```

`chat_messages` and `order_reviews` use a **polymorphic** pattern: `service_kind` + `service_id` (no single FK to one order table).

### Tables and relationships

#### Identity and access

| Table | Primary key | Main foreign keys | Purpose |
| --- | --- | --- | --- |
| `profiles` | `id` | `id` → `auth.users(id)` CASCADE | Display name, phone, avatar, `town_name`, `pincode` |
| `user_roles` | `id` | `user_id` → `auth.users` CASCADE | Many roles per user; UNIQUE (`user_id`, `role`) |
| `role_requests` | `id` | `user_id` → `auth.users`; `reviewed_by` → `auth.users` | Partner role approval workflow (`pending` / `approved` / `rejected`) |
| `saved_addresses` | `id` | `user_id` → `auth.users` CASCADE | Customer delivery addresses with optional `lat`/`lng`, `is_default` |
| `user_push_tokens` | `id` | `user_id` → `auth.users` CASCADE | FCM tokens per device; UNIQUE `token` |

On signup, trigger `handle_new_user` creates a `profiles` row and inserts the default `customer` role (or role from signup metadata).

#### Food (restaurants)

| Table | Primary key | Main foreign keys | Purpose |
| --- | --- | --- | --- |
| `restaurants` | `id` | `manager_id` → `auth.users` SET NULL | Store profile, `is_open`, location (`lat`, `lng`, `town_name`, `pincode`); one manager per restaurant (unique index) |
| `menu_items` | `id` | `restaurant_id` → `restaurants` CASCADE | Menu catalog: price, `is_veg`, `prep_time_minutes`, `modifiers` JSONB |
| `food_orders` | `id` | `customer_id`, `delivery_boy_id` → `auth.users`; `restaurant_id` → `restaurants` RESTRICT | Order header: `status`, totals, delivery/pickup coords, `delivery_pin`, ETA, live `rider_lat`/`rider_lng` |
| `food_order_items` | `id` | `order_id` → `food_orders` CASCADE; `menu_item_id` → `menu_items` RESTRICT | Line items (name/price/qty snapshotted at order time) |

#### Grocery

| Table | Primary key | Main foreign keys | Purpose |
| --- | --- | --- | --- |
| `grocery_stores` | `id` | `manager_id` → `auth.users` SET NULL | Store profile (mirror of restaurants); one manager per store |
| `grocery_items` | `id` | `store_id` → `grocery_stores` CASCADE | Catalog: `stock_quantity`, `unit`, `expiry_date`, `low_stock_threshold` |
| `grocery_orders` | `id` | `customer_id`, `delivery_boy_id` → `auth.users`; `store_id` → `grocery_stores` RESTRICT | Same patterns as food orders |
| `grocery_order_items` | `id` | `order_id` → `grocery_orders` CASCADE; `grocery_item_id` → `grocery_items` RESTRICT | Line items |

#### Rides and packages

| Table | Primary key | Main foreign keys | Purpose |
| --- | --- | --- | --- |
| `rides` | `id` | `customer_id`, `rider_id` → `auth.users` | Pickup/drop addresses and coords, `vehicle_type`, `fare_estimate`, `ride_status`, live rider location |
| `package_deliveries` | `id` | `customer_id`, `rider_id` → `auth.users` | Package size, receiver contact, same status/location model as rides |

#### Platform, chat, reviews

| Table | Primary key | Relations | Purpose |
| --- | --- | --- | --- |
| `chat_messages` | `id` | `sender_id` → `auth.users`; logical link via `service_kind` + `service_id` | In-job chat (customer ↔ rider/delivery partner) |
| `order_reviews` | `id` | `user_id` → `auth.users`; UNIQUE (`user_id`, `service_kind`, `service_id`) | 1–5 star rating per completed service |
| `platform_settings` | `key` (text) | — | JSON config (e.g. `commissions`, `catalog_radius_km`) |
| `audit_events` | `id` | `actor_id` → `auth.users` SET NULL | Admin audit log (`action`, `target_type`, `metadata` JSONB) |

### How services connect to users

| Service | Customer | Assigned partner | Merchant |
| --- | --- | --- | --- |
| Food delivery | `food_orders.customer_id` | `food_orders.delivery_boy_id` | `restaurants.manager_id` |
| Grocery delivery | `grocery_orders.customer_id` | `grocery_orders.delivery_boy_id` | `grocery_stores.manager_id` |
| Ride | `rides.customer_id` | `rides.rider_id` | — |
| Package | `package_deliveries.customer_id` | `package_deliveries.rider_id` | — |

Unassigned jobs are visible to partners with the matching role when `delivery_boy_id` / `rider_id` IS NULL (enforced in RLS).

### Row Level Security (RLS)

RLS is enabled on all `public` tables. Typical rules:

- **Profiles / addresses / push tokens**: users read/write their own rows; admins can read more where noted.
- **Catalog** (`restaurants`, `menu_items`, `grocery_stores`, `grocery_items`): public read; managers update their own venue; admins full control.
- **Orders / rides / packages**: customers see own rows; assigned partners see assigned rows; partners see unassigned pool; merchants see orders for their venue; admins see all.
- **Chat**: only participants on that service (plus admin).
- **Platform settings / audit**: admin only.

The Node backend often uses the user’s JWT for REST calls, so RLS applies. Some flows (token upsert, admin broadcasts) use the **service role** key from the server only — never expose it to the client.

### Realtime (Supabase)

These tables are added to the `supabase_realtime` publication for live updates:

- `rides`, `package_deliveries`, `food_orders`, `grocery_orders`
- `chat_messages`, `order_reviews`

The web app still polls in several places; Realtime can be subscribed for lower latency.

### Migration files (order)

| File | Summary |
| --- | --- |
| `20260430163946_*.sql` | Core schema: enums, profiles, roles, restaurants, grocery, orders, rides, packages, RLS |
| `20260430164012_*.sql` | Security hardening on helper functions |
| `20260501054502_*.sql` | Menu `is_veg`; hotel manager restaurant insert |
| `20260501055338_*.sql` | Realtime on `rides` |
| `20260502004437_*.sql` | Grocery manager self-insert store |
| `20260503034022_*.sql` | Ride `vehicle_type` |
| `20260503034920_*.sql` | Live rider location columns + realtime on order tables |
| `20260504090000_add_location_fields.sql` | Town/pincode on profiles and venues |
| `20260511120000_add_chat_messages.sql` | `chat_messages` + RLS + realtime |
| `20260511123000_store_signup_phone.sql` | Phone on signup; `email_for_phone_login` RPC |
| `20260514103000_user_friendly_flows.sql` | `role_requests`, `saved_addresses`, `audit_events`, pickup/cancel fields |
| `20260515100000_partner_operations_inventory.sql` | Grocery stock, menu prep/modifiers |
| `20260516120000_complete_platform_features.sql` | `platform_settings`, delivery PIN/ETA, `order_reviews` |
| `20260528135000_add_user_push_tokens.sql` | FCM `user_push_tokens` |

### User roles (`app_role`)

| Role | Typical use |
| --- | --- |
| `customer` | Browse catalog, place orders, book rides/packages, track and chat |
| `delivery_boy` | Accept and deliver food/grocery orders |
| `rider` | Accept and complete rides and package deliveries |
| `hotel_manager` | Own one restaurant, menu, and order workflow |
| `grocery_manager` | Own one grocery store, inventory, and orders |
| `admin` | Users, venues, analytics, commissions, catalog radius, role approvals |

Users can hold **multiple roles** (e.g. `customer` + `rider`). Extra business roles are usually requested via `role_requests` and granted by an admin.

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

Note: Indian phone numbers (`+91`) are supported today with Twilio Verify for OTP flows.

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
- Password reset and phone login require Twilio Verify in production (or explicit dev bypass)
- Backend request validation is mostly manual and route-specific beyond shared Zod schemas
- Realtime chat/tracking uses polling rather than Supabase Realtime subscriptions everywhere
- Production readiness depends on correct Supabase RLS policies, environment variables, and seeded data
- Android app is not on the Play Store yet; set `VITE_ANDROID_APP_URL` when you have a public download link
- iOS app is not included; the mobile download prompt targets Android phones only

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
