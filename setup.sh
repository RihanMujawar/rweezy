#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend-rust"
SIDECAR_DIR="$BACKEND_DIR/whatsapp-sidecar"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

RUN_AFTER_SETUP=true
SKIP_INSTALL=false
SKIP_ENV=false
DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"
DB_PASSWORD="${DB_PASSWORD:-}"

usage() {
  cat <<'EOF'
Usage: ./setup.sh [options]

Options:
  --setup-only      Install and configure everything but do not start services
  --skip-install    Skip dependency installation steps
  --skip-env        Skip .env creation and environment file updates
  -h, --help        Show this help message
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --setup-only)
      RUN_AFTER_SETUP=false
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --skip-env)
      SKIP_ENV=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

log() {
  echo "[setup] $*"
}

run_as_root_or_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Root privileges are required to install system packages. Please run this script with sudo or as root." >&2
    exit 1
  fi
}

install_packages() {
  local packages="$1"
  if command -v apt-get >/dev/null 2>&1; then
    run_as_root_or_sudo apt-get update
    run_as_root_or_sudo apt-get install -y $packages
  elif command -v brew >/dev/null 2>&1; then
    brew install $packages
  elif command -v pacman >/dev/null 2>&1; then
    run_as_root_or_sudo pacman -Sy --noconfirm $packages
  else
    echo "No supported package manager was found for automatic installation." >&2
    exit 1
  fi
}

ensure_git() {
  if ! command -v git >/dev/null 2>&1; then
    log "Installing git"
    install_packages git
  fi
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local version
    version="$(node --version 2>/dev/null | sed 's/^v//')"
    if [[ -n "$version" ]]; then
      check_version "$version" "20"
      return
    fi
  fi

  log "Installing Node.js 20+"
  if command -v apt-get >/dev/null 2>&1; then
    install_packages "ca-certificates curl gnupg"
    if ! test -f /etc/apt/sources.list.d/nodesource.list; then
      run_as_root_or_sudo mkdir -p /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | run_as_root_or_sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | run_as_root_or_sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    fi
    run_as_root_or_sudo apt-get update
    run_as_root_or_sudo apt-get install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node@20
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
  else
    echo "Unable to install Node.js automatically." >&2
    exit 1
  fi
}

ensure_rust() {
  if command -v cargo >/dev/null 2>&1 && command -v rustc >/dev/null 2>&1; then
    return
  fi

  log "Installing Rust"
  if command -v curl >/dev/null 2>&1; then
    curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal
    export PATH="$HOME/.cargo/bin:$PATH"
  elif command -v apt-get >/dev/null 2>&1; then
    install_packages "cargo rustc"
  else
    echo "Unable to install Rust automatically." >&2
    exit 1
  fi
}

ensure_build_prerequisites() {
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing native build prerequisites for Rust"
    install_packages "build-essential pkg-config libssl-dev"
  elif command -v brew >/dev/null 2>&1; then
    brew install openssl pkg-config
  elif command -v pacman >/dev/null 2>&1; then
    install_packages "base-devel pkgconf openssl"
  fi
}

ensure_postgresql() {
  if command -v psql >/dev/null 2>&1 && command -v createdb >/dev/null 2>&1; then
    return
  fi

  log "Installing PostgreSQL"
  if command -v apt-get >/dev/null 2>&1; then
    install_packages "postgresql postgresql-contrib"
  elif command -v brew >/dev/null 2>&1; then
    brew install postgresql
  elif command -v pacman >/dev/null 2>&1; then
    install_packages "postgresql"
  else
    echo "Unable to install PostgreSQL automatically." >&2
    exit 1
  fi
}

ensure_postgresql_service() {
  if ! command -v psql >/dev/null 2>&1; then
    return
  fi

  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h "${PGHOST:-localhost}" -p "${PGPORT:-5432}" >/dev/null 2>&1; then
      return
    fi
  fi

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl list-unit-files postgresql.service >/dev/null 2>&1; then
      log "Starting PostgreSQL service"
      run_as_root_or_sudo systemctl start postgresql || true
    fi
  elif command -v service >/dev/null 2>&1; then
    log "Starting PostgreSQL service"
    run_as_root_or_sudo service postgresql start || true
  fi
}

wait_for_postgres() {
  local attempts=0
  while [[ $attempts -lt 15 ]]; do
    if run_psql_as_postgres "SELECT 1" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

run_psql_as_postgres() {
  local sql="$1"
  if command -v sudo >/dev/null 2>&1; then
    sudo -u postgres psql -X -A -t -v ON_ERROR_STOP=1 -d postgres -c "$sql"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- psql -X -A -t -v ON_ERROR_STOP=1 -d postgres -c "$sql"
  elif [[ "$(id -u)" -eq 0 ]]; then
    su postgres -c "psql -X -A -t -v ON_ERROR_STOP=1 -d postgres -c '$sql'"
  else
    echo "Unable to access PostgreSQL as the local postgres account." >&2
    return 1
  fi
}

ensure_python() {
  if ! command -v python3 >/dev/null 2>&1; then
    log "Installing python3"
    install_packages python3
  fi
}

check_version() {
  local version="$1"
  local minimum="$2"
  if [[ "$version" =~ ^v?([0-9]+)\.([0-9]+) ]]; then
    local major="${BASH_REMATCH[1]}"
    local minor="${BASH_REMATCH[2]}"
    local current="$major.$minor"
    if ! printf '%s\n%s\n' "$current" "$minimum" | sort -V -C; then
      echo "Warning: detected version $version, but version $minimum or newer is recommended." >&2
    fi
  fi
}

prompt_for_database_config() {
  if [[ -n "$DB_NAME" && -n "$DB_PASSWORD" ]]; then
    DB_USER="${DB_USER:-${PGUSER:-postgres}}"
    return
  fi

  echo
  log "Please provide PostgreSQL details for local development"
  read -r -p "Database name [rweezy]: " db_name
  DB_NAME="${db_name:-rweezy}"

  read -r -p "Database username [${DB_NAME}]: " db_user
  DB_USER="${db_user:-${DB_NAME}}"

  read -s -p "Database password: " db_password
  echo
  if [[ -z "$db_password" ]]; then
    echo "Password cannot be empty." >&2
    exit 1
  fi
  DB_PASSWORD="$db_password"

  export DB_NAME DB_USER DB_PASSWORD
}

write_env_exports() {
  local export_file="$ROOT_DIR/.env_exports.sh"
  cat > "$export_file" <<EOF
export DB_NAME="${DB_NAME:-rweezy}"
export DB_USER="${DB_USER:-postgres}"
export DB_PASSWORD="${DB_PASSWORD:-}"
export DATABASE_URL="postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-}@${PGHOST:-localhost}:${PGPORT:-5432}/${DB_NAME:-rweezy}"
EOF
  log "Saved shell exports to $export_file"
}

ensure_env_file() {
  if [[ "$SKIP_ENV" == true ]]; then
    return
  fi

  ensure_python

  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    log "Creating environment file from .env.example"
    cp "$ROOT_DIR/.env.example" "$env_file"
  else
    log "Environment file already exists at $env_file"
  fi

  local db_user="${DB_USER:-${PGUSER:-postgres}}"
  local db_password="${DB_PASSWORD:-postgres}"
  local db_name="${DB_NAME:-rweezy}"
  local db_url="${DATABASE_URL:-postgresql://${db_user}:${db_password}@${PGHOST:-localhost}:${PGPORT:-5432}/${db_name}}"
  local jwt_secret="${JWT_SECRET:-rweezy-dev-secret-change-me}"
  local mapbox_token="${MAPBOX_ACCESS_TOKEN:-}"
  local whatsapp_secret="${WHATSAPP_OTP_SECRET:-rweezy-whatsapp-secret}"
  local phone_secret="${PHONE_VERIFICATION_SECRET:-rweezy-phone-secret}"
  local email_secret="${EMAIL_OTP_SECRET:-rweezy-email-secret}"
  local internal_token="${INTERNAL_TOKEN:-rweezy-internal-bypass-secret-12345!}"

  python3 - <<'PY' "$env_file" "$db_url" "$jwt_secret" "$mapbox_token" "$whatsapp_secret" "$phone_secret" "$email_secret" "$internal_token" "$db_name" "$db_user" "$db_password"
import os
import sys
from pathlib import Path

env_path = Path(sys.argv[1])
db_url = sys.argv[2]
jwt_secret = sys.argv[3]
mapbox_token = sys.argv[4]
whatsapp_secret = sys.argv[5]
phone_secret = sys.argv[6]
email_secret = sys.argv[7]
internal_token = sys.argv[8]
db_name = sys.argv[9]
db_user = sys.argv[10]
db_password = sys.argv[11]

lines = env_path.read_text().splitlines()
updates = {
    'DATABASE_URL': f'"{db_url}"',
    'DB_NAME': f'"{sys.argv[9]}"',
    'DB_USER': f'"{sys.argv[10]}"',
    'DB_PASSWORD': f'"{sys.argv[11]}"',
    'JWT_SECRET': f'"{jwt_secret}"',
    'WHATSAPP_OTP_SECRET': f'"{whatsapp_secret}"',
    'PHONE_VERIFICATION_SECRET': f'"{phone_secret}"',
    'EMAIL_OTP_SECRET': f'"{email_secret}"',
    'INTERNAL_TOKEN': f'"{internal_token}"',
}

new_lines = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith('#'):
        new_lines.append(line)
        continue
    key = stripped.split('=', 1)[0]
    if key in updates:
        new_lines.append(f"{key}={updates[key]}")
    else:
        new_lines.append(line)

for key, value in updates.items():
    if not any(line.startswith(f"{key}=") for line in new_lines):
        new_lines.append(f"{key}={value}")

env_path.write_text("\n".join(new_lines) + "\n")
PY
}

print_setup_summary() {
  echo
  echo "========================================"
  echo "Setup complete"
  echo "Database Name     : ${DB_NAME:-rweezy}"
  echo "Database User     : ${DB_USER:-postgres}"
  echo "Database Password : ${DB_PASSWORD:-<not set>}"
  echo "Database URL      : postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-<not set>}@${PGHOST:-localhost}:${PGPORT:-5432}/${DB_NAME:-rweezy}"
  echo "========================================"
}

install_dependencies() {
  if [[ "$SKIP_INSTALL" == true ]]; then
    return
  fi

  log "Checking required tools"
  ensure_git
  ensure_node
  ensure_rust
  ensure_build_prerequisites
  ensure_postgresql
  ensure_postgresql_service
  ensure_python

  log "Installing frontend dependencies"
  (cd "$FRONTEND_DIR" && npm install)

  log "Installing WhatsApp sidecar dependencies"
  (cd "$SIDECAR_DIR" && npm install)

  log "Fetching Rust dependencies"
  (cd "$BACKEND_DIR" && cargo fetch)
}

setup_database() {
  if ! command -v psql >/dev/null 2>&1; then
    log "psql is not available; skipping database initialization"
    return
  fi

  ensure_postgresql_service

  if ! wait_for_postgres; then
    log "PostgreSQL is not reachable; skipping database initialization"
    return
  fi

  local pg_user="${PGUSER:-${DB_USER:-postgres}}"
  local pg_host="${PGHOST:-localhost}"
  local pg_port="${PGPORT:-5432}"
  local db_name="${DB_NAME:-rweezy}"
  local db_password="${DB_PASSWORD:-}"
  local db_exists

  if [[ -n "$db_password" ]]; then
    role_exists="$(run_psql_as_postgres "SELECT 1 FROM pg_roles WHERE rolname = '$pg_user';" 2>/dev/null || true)"
    if [[ "$role_exists" == "1" ]]; then
      if ! run_psql_as_postgres "ALTER ROLE \"$pg_user\" WITH LOGIN PASSWORD '$db_password';" >/dev/null 2>&1; then
        log "Could not update the PostgreSQL role; continuing with the existing role configuration"
      fi
    else
      if ! run_psql_as_postgres "CREATE ROLE \"$pg_user\" WITH LOGIN PASSWORD '$db_password';" >/dev/null 2>&1; then
        log "Could not create the PostgreSQL role; continuing with the existing role configuration"
      fi
    fi
  fi

  db_exists="$(run_psql_as_postgres "SELECT 1 FROM pg_database WHERE datname='$db_name';" 2>/dev/null || true)"
  if [[ "$db_exists" != "1" ]]; then
    log "Creating PostgreSQL database '$db_name'"
    if ! sudo -u postgres createdb -O "$pg_user" "$db_name" >/dev/null 2>&1; then
      log "Database creation skipped because the current PostgreSQL user lacks privileges"
    fi
  else
    log "PostgreSQL database '$db_name' already exists"
  fi

  if [[ -n "$pg_user" ]]; then
    if [[ -n "$db_password" ]]; then
      run_psql_as_postgres "ALTER ROLE \"$pg_user\" WITH LOGIN PASSWORD '$db_password';" >/dev/null 2>&1 || true
    fi

    run_psql_as_postgres "ALTER DATABASE \"$db_name\" OWNER TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "GRANT ALL PRIVILEGES ON DATABASE \"$db_name\" TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "ALTER SCHEMA public OWNER TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "GRANT ALL ON SCHEMA public TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "GRANT CREATE ON SCHEMA public TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "GRANT ALL ON ALL TABLES IN SCHEMA public TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO \"$pg_user\";" >/dev/null 2>&1 || true
    run_psql_as_postgres "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO \"$pg_user\";" >/dev/null 2>&1 || true
  fi
}

start_service() {
  local name="$1"
  local cwd="$2"
  local cmd="$3"
  local logfile="$4"
  local pidfile="$5"

  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    log "$name is already running"
    return
  fi

  log "Starting $name"
  nohup bash -lc "cd '$cwd' && $cmd" >"$logfile" 2>&1 &
  echo $! > "$pidfile"
}

run_services() {
  if [[ "$RUN_AFTER_SETUP" != true ]]; then
    return
  fi

  start_service "Rust backend" "$BACKEND_DIR" "cargo run" "$LOG_DIR/backend.log" "$LOG_DIR/backend.pid"
  start_service "WhatsApp sidecar" "$SIDECAR_DIR" "npm run start" "$LOG_DIR/sidecar.log" "$LOG_DIR/sidecar.pid"
  start_service "Frontend" "$FRONTEND_DIR" "npm run dev -- --host 0.0.0.0" "$LOG_DIR/frontend.log" "$LOG_DIR/frontend.pid"

  log "Setup complete"
  echo
  echo "Services are running:"
  echo "  - Backend: http://127.0.0.1:4000"
  echo "  - Frontend: http://127.0.0.1:3000"
  echo "  - Logs: $LOG_DIR"
  echo
  echo "To stop them later, run:"
  echo "  kill $(cat "$LOG_DIR/backend.pid") $(cat "$LOG_DIR/sidecar.pid") $(cat "$LOG_DIR/frontend.pid") 2>/dev/null || true"
}

log "Preparing Rweezy workspace"
prompt_for_database_config
write_env_exports
ensure_env_file
install_dependencies
setup_database
print_setup_summary
run_services
