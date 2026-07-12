# Rweezy Project: All-in-One Deployment Guide (EC2)

This guide explains how to host the **Frontend**, **Backend**, and **Database** all on a single EC2 instance.

---

## 🏗️ Architecture on EC2
- **Nginx (Port 80)**: Serves the Frontend and acts as a Reverse Proxy for the Backend.
- **Frontend**: React static files (built with Vite).
- **Backend (Port 4000)**: Rust Actix Web server.
- **WhatsApp Sidecar (Port 4001)**: Node.js service.
- **Database (Port 5432)**: PostgreSQL.

---

## 🚀 Quick Deployment (Recommended)

We have provided a `deploy.sh` script that automates the entire process.

1. **SSH into your EC2 instance.**
2. **Clone your repository:**
   ```bash
   git clone https://github.com/your-username/rweezy.git
   cd rweezy
   ```
3. **Make the script executable and run it:**
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```

The script will install Rust, Node.js, Postgres, Nginx, build the project, and start all services.

---

## 🛠️ Manual Step-by-Step Instructions

If you prefer to set up everything manually, follow these steps:

### 1. Database Setup
Install PostgreSQL and create the database:
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
# Switch to postgres user
sudo -u postgres psql
```
Inside the `psql` prompt:
```sql
CREATE USER rweezy WITH PASSWORD 'your_password';
CREATE DATABASE rweezy OWNER rweezy;
\q
```

### 2. Backend Configuration
Create a `.env` file in `backend-rust/`:
```env
DATABASE_URL=postgresql://rweezy:your_password@localhost:5432/rweezy
JWT_SECRET=your_random_secret
BACKEND_PORT=4000
BACKEND_HOST=127.0.0.1
WHATSAPP_SIDECAR_PORT=4001
INTERNAL_TOKEN=some_internal_secret
```
Build and run:
```bash
cd backend-rust
cargo build --release
./target/release/backend-rust
```

### 3. Frontend Configuration
The frontend uses relative paths (e.g., `/api/login`), so it automatically connects to the same domain/IP via Nginx. No special IP configuration is needed in the frontend code.

Build the frontend:
```bash
cd frontend
npm install
npm run build
```
The static files will be generated in `frontend/dist/`.

### 4. Nginx Configuration
Copy the `nginx.conf` provided in the project root to `/etc/nginx/sites-available/rweezy`.

**Key parts of the Nginx config:**
- `root /home/ubuntu/rweezy/frontend/dist;`: Points to your built frontend.
- `location /api { proxy_pass http://127.0.0.1:4000; }`: Redirects API calls to the Rust backend.
- `location /ws { ... }`: Handles WebSockets.

Enable the config:
```bash
sudo ln -s /etc/nginx/sites-available/rweezy /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo systemctl restart nginx
```

---

## 🔐 Security & SSL (Optional)
To enable HTTPS, use Certbot:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 📝 Common Commands
- **Check Backend Logs**: `journalctl -u rweezy-backend -f`
- **Check WhatsApp Logs**: `journalctl -u rweezy-whatsapp -f`
- **Restart All**: 
  ```bash
  sudo systemctl restart rweezy-backend rweezy-whatsapp nginx
  ```
