#!/bin/bash

# Rweezy All-in-One Deployment Script
# Optimized for Ubuntu/Debian environments (EC2 or Local)

set -e

# Get the absolute path of the project root
PROJECT_ROOT=$(pwd)
echo "🚀 Starting Rweezy Deployment in $PROJECT_ROOT..."

# 1. Update and install system dependencies
echo "📦 Installing system dependencies..."
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
# Create user if not exists, then ALWAYS set the password to ensure it matches .env
sudo -u postgres psql -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'rweezy') THEN CREATE USER rweezy WITH PASSWORD 'rweezy_pass'; END IF; END \$\$;"
sudo -u postgres psql -c "ALTER USER rweezy WITH PASSWORD 'rweezy_pass';"
# Create database if not exists
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname = 'rweezy'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE rweezy OWNER rweezy;"
# Ensure schema and permissions
sudo -u postgres psql -d rweezy -c "CREATE SCHEMA IF NOT EXISTS rweezy AUTHORIZATION rweezy;"
sudo -u postgres psql -d rweezy -c "GRANT ALL PRIVILEGES ON SCHEMA rweezy TO rweezy;"
sudo -u postgres psql -d rweezy -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA rweezy TO rweezy;"

# 5. Setup Backend
echo "⚙️ Setting up Backend..."
cd "$PROJECT_ROOT/backend-rust"
cat <<EOF > .env
DATABASE_URL=postgresql://rweezy:rweezy_pass@localhost:5432/rweezy
JWT_SECRET=$(openssl rand -base64 32)
BACKEND_PORT=4000
BACKEND_HOST=127.0.0.1
WHATSAPP_SIDECAR_PORT=4001
INTERNAL_TOKEN=$(openssl rand -hex 16)
EOF

echo "🔨 Building Backend (Release mode)..."
cargo build --release

# 6. Setup WhatsApp Sidecar
echo "📱 Setting up WhatsApp Sidecar..."
cd "$PROJECT_ROOT/backend-rust/whatsapp-sidecar"
npm install

# 7. Setup Frontend
echo "🌐 Building Frontend..."
cd "$PROJECT_ROOT/frontend"
npm install
npm run build

# 8. Permissions for Nginx
echo "🔑 Fixing folder permissions for Nginx..."
# Nginx needs +x on all parent directories to reach the 'dist' folder
PARENT_DIR="$PROJECT_ROOT"
while [ "$PARENT_DIR" != "/" ]; do
    sudo chmod o+x "$PARENT_DIR"
    PARENT_DIR=$(dirname "$PARENT_DIR")
done
# Make the dist folder readable
sudo chmod -R o+rX "$PROJECT_ROOT/frontend/dist"

# 9. Setup Systemd Services
echo "📋 Creating Systemd Services..."

sudo tee /etc/systemd/system/rweezy-backend.service > /dev/null <<EOF
[Unit]
Description=Rweezy Rust Backend
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_ROOT/backend-rust
EnvironmentFile=$PROJECT_ROOT/backend-rust/.env
ExecStart=$PROJECT_ROOT/backend-rust/target/release/backend-rust
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
WorkingDirectory=$PROJECT_ROOT/backend-rust/whatsapp-sidecar
ExecStart=/usr/bin/node server.mjs
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable rweezy-backend rweezy-whatsapp
sudo systemctl restart rweezy-backend rweezy-whatsapp

# 10. Configure Nginx
echo "🌐 Configuring Nginx..."
sudo cp "$PROJECT_ROOT/nginx.conf" /etc/nginx/sites-available/rweezy
# Replace path in nginx config to match current PROJECT_ROOT
sudo sed -i "s|root .*;|root $PROJECT_ROOT/frontend/dist;|g" /etc/nginx/sites-available/rweezy

sudo ln -sf /etc/nginx/sites-available/rweezy /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Deployment Complete!"
echo "📍 Your app should now be accessible at http://localhost (or your EC2 IP)."
echo "📜 View backend logs: journalctl -u rweezy-backend -f"
