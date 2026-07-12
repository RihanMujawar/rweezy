#!/bin/bash

# Rweezy All-in-One Deployment Script for EC2 (Ubuntu)
# This script installs everything (DB, Backend, Frontend) on a single instance.

set -e

echo "🚀 Starting Rweezy Deployment..."

# 1. Update and install dependencies
sudo apt update
sudo apt install -y curl build-essential gcc make pkg-config libssl-dev postgresql postgresql-contrib nginx git

# 2. Install Rust
if ! command -v cargo &> /dev/null; then
    echo "🦀 Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source $HOME/.cargo/env
else
    echo "✅ Rust is already installed."
fi

# 3. Install Node.js
if ! command -v node &> /dev/null; then
    echo "🟢 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "✅ Node.js is already installed."
fi

# 4. Configure PostgreSQL
echo "🐘 Configuring PostgreSQL..."
sudo -u postgres psql -c "CREATE USER rweezy WITH PASSWORD 'rweezy_pass';" || echo "User already exists"
sudo -u postgres psql -c "CREATE DATABASE rweezy OWNER rweezy;" || echo "Database already exists"
sudo -u postgres psql -d rweezy -c "CREATE SCHEMA IF NOT EXISTS rweezy AUTHORIZATION rweezy;"

# 5. Setup Backend
echo "⚙️ Setting up Backend..."
cd backend-rust
cat <<EOF > .env
DATABASE_URL=postgresql://rweezy:rweezy_pass@localhost:5432/rweezy
JWT_SECRET=$(openssl rand -base64 32)
BACKEND_PORT=4000
BACKEND_HOST=127.0.0.1
WHATSAPP_SIDECAR_PORT=4001
INTERNAL_TOKEN=$(openssl rand -hex 16)
EOF

echo "🔨 Building Backend (this may take a few minutes)..."
cargo build --release

# 6. Setup WhatsApp Sidecar
echo "📱 Setting up WhatsApp Sidecar..."
cd whatsapp-sidecar
npm install
cd ../..

# 7. Setup Frontend
echo "🌐 Building Frontend..."
cd frontend
npm install
# In production, relative paths are used, so we don't strictly need VITE_API_URL if hosted on same domain
npm run build
cd ..

# 8. Setup Systemd Services
echo "📋 Creating Systemd Services..."

sudo tee /etc/systemd/system/rweezy-backend.service > /dev/null <<EOF
[Unit]
Description=Rweezy Rust Backend
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)/backend-rust
EnvironmentFile=$(pwd)/backend-rust/.env
ExecStart=$(pwd)/backend-rust/target/release/backend-rust
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/rweezy-whatsapp.service > /dev/null <<EOF
[Unit]
Description=Rweezy WhatsApp Sidecar
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)/backend-rust/whatsapp-sidecar
ExecStart=/usr/bin/node server.mjs
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable rweezy-backend rweezy-whatsapp
sudo systemctl restart rweezy-backend rweezy-whatsapp

# 9. Configure Nginx
echo "🌐 Configuring Nginx..."
# Replace /home/ubuntu with actual path if needed
sudo cp nginx.conf /etc/nginx/sites-available/rweezy
# Ensure the root path in nginx.conf is correct
sudo sed -i "s|/home/ubuntu/rweezy|$(pwd)|g" /etc/nginx/sites-available/rweezy

sudo ln -sf /etc/nginx/sites-available/rweezy /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Deployment Complete!"
echo "📍 Your app should now be accessible at your EC2 IP address."
echo "📜 To check logs, use: journalctl -u rweezy-backend -f"
