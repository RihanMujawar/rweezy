# Rweezy - Multi-Service Delivery Platform

Rweezy is a full-stack delivery marketplace for food delivery, grocery delivery, ride booking, and package transfer. The project includes role-based experiences for customers, riders, delivery partners, restaurant managers, grocery store managers, and admins.

The platform consists of three main components:
- **Web Application**: React 19 frontend with TypeScript, Vite, TanStack Router, TanStack Query, Tailwind CSS 4
- **Android Application**: Native Kotlin app with Jetpack Compose UI
- **Backend**: Node.js ESM server with PostgreSQL (via Prisma), JWT Auth, Socket.io for real-time updates, Mapbox maps and routing
- **Docker**: Production packaging for the web platform

## Tech Stack

| Area | Tools |
| --- | --- |
| Web Frontend | React 19, TypeScript, Vite, TanStack Router, TanStack Query |
| Mobile App | Kotlin, Jetpack Compose, Android Jetpack, Material Design 3 |
| UI (Web) | Tailwind CSS 4, Radix UI primitives, lucide-react, sonner, shadcn/ui components |
| Maps | Mapbox GL, Mapbox Geocoding, Mapbox Directions |
| Forms | React Hook Form, Zod validation |
| Backend | Node.js ESM HTTP server, Prisma ORM, Socket.io |
| Database | PostgreSQL |

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- Mapbox access token
- (Optional) OpenWA for WhatsApp notifications

### Setup

1.  **Clone the repository**
2.  **Install dependencies**:
    ```bash
    npm install
    cd backend && npm install
    cd ../frontend && npm install
    ```
3.  **Environment Variables**:
    Create a `.env` file in the root directory based on `.env.example`.
    ```bash
    DATABASE_URL="postgresql://user:password@localhost:5432/rweezy"
    JWT_SECRET="your-secret-key"
    MAPBOX_ACCESS_TOKEN="your-mapbox-token"
    ```
4.  **Database Migration**:
    ```bash
    cd backend
    npx prisma migrate dev
    ```
5.  **Run Development Server**:
    ```bash
    npm run dev
    ```

## Project Structure

- `frontend/`: React application
- `backend/`: Node.js server
  - `prisma/`: Database schema and migrations
  - `lib/`: Shared utilities (auth, notifications, etc.)
  - `server.mjs`: Main server entry and API routes
- `android/`: Native Android application

## Core Schema

The application uses Prisma to interact with PostgreSQL. The main models include:
- `User` and `Profile`: Identity and user metadata
- `UserRole`: RBAC (customer, admin, hotel_manager, etc.)
- `Restaurant` and `MenuItem`: Catalog for food delivery
- `GroceryStore` and `GroceryItem`: Catalog for grocery delivery
- `FoodOrder`, `GroceryOrder`, `Ride`, `PackageDelivery`: Core business transactions
- `ChatMessage`: Real-time communication during active jobs
- `OrderReview`: Customer feedback
- `PlatformSetting`: Configuration like commission rates

## Real-time Updates

Real-time features like order tracking and chat are powered by **Socket.io**.
- The backend emits events on `order_updated`, `new_message`, and `new_review`.
- The frontend uses the `useOrderRealtime` hook and Socket.io client to listen for updates.

## Authentication

Custom JWT-based authentication is implemented:
- Passwords are hashed using `bcryptjs`.
- JWTs are stored in cookies (`rweezy_access_token`) for secure session management.
- Supports phone-first registration with WhatsApp OTP verification.

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
3. Update `prisma/schema.prisma` when schema changes are required

## License

No license file is currently included in this repository. Add one before distributing or publishing the project.
