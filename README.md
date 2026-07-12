# Rweezy

Rweezy is a comprehensive multi-service delivery platform supporting Food, Grocery, Ride-booking, and Package delivery. It features a high-performance Rust backend, a modern React frontend, and a WhatsApp integration service.

## 🚀 Quick Deployment (EC2)

If you are deploying to an Ubuntu EC2 instance, you can use the automated script to set up the Database, Backend, and Frontend in one go:

```bash
git clone https://github.com/your-username/rweezy.git
cd rweezy
chmod +x deploy.sh
./deploy.sh
```

For detailed manual instructions, see [SETUP_GUIDE.md](./SETUP_GUIDE.md).

## 📁 Project Structure

- `frontend/`: Vite + React + TypeScript web app.
- `backend-rust/`: Rust Actix Web API server.
- `backend-rust/whatsapp-sidecar/`: Node.js service for WhatsApp integrations.
- `nginx.conf`: Production server configuration.
- `deploy.sh`: All-in-one deployment script for Linux/EC2.

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite, TanStack Router, Tailwind CSS.
- **Backend**: Rust, Actix Web, SQLx, PostgreSQL.
- **Messaging**: WhatsApp sidecar (Node.js/Baileys).
- **Infrastructure**: Nginx, Systemd.

## 💻 Local Development

### 1. Database
Ensure PostgreSQL is running and create the database:
```bash
createdb rweezy
```

### 2. Backend
```bash
cd backend-rust
# Create .env with DATABASE_URL and JWT_SECRET
cargo run
```
*Migrations are applied automatically on startup.*

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. WhatsApp Sidecar (Optional)
```bash
cd backend-rust/whatsapp-sidecar
npm install
npm run dev
```

## 📄 Documentation
- [Full Setup & Deployment Guide](./SETUP_GUIDE.md)
- [Nginx Configuration](./nginx.conf)

## 📝 License
Proprietary / Internal use only.
