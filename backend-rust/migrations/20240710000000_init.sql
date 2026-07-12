-- Create schema if not exists
CREATE SCHEMA IF NOT EXISTS rweezy;

-- Set search path to rweezy, public
SET search_path TO rweezy, public;

-- Create custom AppRole enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.pg_namespace = n.oid WHERE t.typname = 'approle' AND n.nspname = 'rweezy') THEN
        CREATE TYPE rweezy.AppRole AS ENUM ('customer', 'admin', 'hotel_manager', 'grocery_manager', 'delivery_boy', 'rider');
    END IF;
END$$;

-- Create custom OrderStatus enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.pg_namespace = n.oid WHERE t.typname = 'orderstatus' AND n.nspname = 'rweezy') THEN
        CREATE TYPE rweezy.OrderStatus AS ENUM ('pending', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled');
    END IF;
END$$;

-- Create custom RideStatus enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.pg_namespace = n.oid WHERE t.typname = 'ridestatus' AND n.nspname = 'rweezy') THEN
        CREATE TYPE rweezy.RideStatus AS ENUM ('requested', 'accepted', 'started', 'completed', 'cancelled');
    END IF;
END$$;

-- Create custom ServiceKind enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.pg_namespace = n.oid WHERE t.typname = 'servicekind' AND n.nspname = 'rweezy') THEN
        CREATE TYPE rweezy.ServiceKind AS ENUM ('ride', 'package', 'food', 'grocery');
    END IF;
END$$;

-- Create custom RoleRequestStatus enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.pg_namespace = n.oid WHERE t.typname = 'rolerequeststatus' AND n.nspname = 'rweezy') THEN
        CREATE TYPE rweezy.RoleRequestStatus AS ENUM ('pending', 'approved', 'rejected');
    END IF;
END$$;

-- Create users table
CREATE TABLE IF NOT EXISTS rweezy.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create profiles table
CREATE TABLE IF NOT EXISTS rweezy.profiles (
    id UUID PRIMARY KEY REFERENCES rweezy.users(id) ON DELETE CASCADE,
    full_name TEXT,
    phone TEXT,
    avatar_url TEXT,
    town_name TEXT,
    pincode TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create user_roles table
CREATE TABLE IF NOT EXISTS rweezy.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    role rweezy.AppRole NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT idx_user_roles_user_id_role UNIQUE (user_id, role)
);

-- Create restaurants table
CREATE TABLE IF NOT EXISTS rweezy.restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID UNIQUE REFERENCES rweezy.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    address TEXT,
    image_url TEXT,
    is_open BOOLEAN DEFAULT true NOT NULL,
    town_name TEXT,
    pincode TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create menu_items table
CREATE TABLE IF NOT EXISTS rweezy.menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES rweezy.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url TEXT,
    category TEXT,
    is_available BOOLEAN DEFAULT true NOT NULL,
    is_veg BOOLEAN DEFAULT true NOT NULL,
    prep_time_minutes INT DEFAULT 15 NOT NULL,
    is_special BOOLEAN DEFAULT false NOT NULL,
    modifiers JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create grocery_stores table
CREATE TABLE IF NOT EXISTS rweezy.grocery_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    manager_id UUID UNIQUE REFERENCES rweezy.users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    address TEXT,
    image_url TEXT,
    is_open BOOLEAN DEFAULT true NOT NULL,
    town_name TEXT,
    pincode TEXT,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create grocery_items table
CREATE TABLE IF NOT EXISTS rweezy.grocery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES rweezy.grocery_stores(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    image_url TEXT,
    category TEXT,
    is_available BOOLEAN DEFAULT true NOT NULL,
    stock_quantity INT DEFAULT 0 NOT NULL,
    low_stock_threshold INT DEFAULT 5 NOT NULL,
    expiry_date TIMESTAMPTZ,
    aisle_location TEXT,
    unit TEXT DEFAULT 'pcs' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create food_orders table
CREATE TABLE IF NOT EXISTS rweezy.food_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES rweezy.restaurants(id) ON DELETE RESTRICT,
    delivery_boy_id UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    status rweezy.OrderStatus DEFAULT 'pending' NOT NULL,
    total DECIMAL(10, 2) DEFAULT 0 NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_lat DOUBLE PRECISION,
    delivery_lng DOUBLE PRECISION,
    pickup_address TEXT,
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    notes TEXT,
    payment_method TEXT DEFAULT 'cash' NOT NULL,
    payment_status TEXT DEFAULT 'pending' NOT NULL,
    delivery_pin CHAR(4),
    estimated_delivery_at TIMESTAMPTZ,
    contactless_delivery BOOLEAN DEFAULT false NOT NULL,
    rider_lat DOUBLE PRECISION,
    rider_lng DOUBLE PRECISION,
    rider_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create food_order_items table
CREATE TABLE IF NOT EXISTS rweezy.food_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES rweezy.food_orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES rweezy.menu_items(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create grocery_orders table
CREATE TABLE IF NOT EXISTS rweezy.grocery_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES rweezy.grocery_stores(id) ON DELETE RESTRICT,
    delivery_boy_id UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    status rweezy.OrderStatus DEFAULT 'pending' NOT NULL,
    total DECIMAL(10, 2) DEFAULT 0 NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_lat DOUBLE PRECISION,
    delivery_lng DOUBLE PRECISION,
    pickup_address TEXT,
    pickup_lat DOUBLE PRECISION,
    pickup_lng DOUBLE PRECISION,
    notes TEXT,
    payment_method TEXT DEFAULT 'cash' NOT NULL,
    payment_status TEXT DEFAULT 'pending' NOT NULL,
    delivery_pin CHAR(4),
    estimated_delivery_at TIMESTAMPTZ,
    contactless_delivery BOOLEAN DEFAULT false NOT NULL,
    rider_lat DOUBLE PRECISION,
    rider_lng DOUBLE PRECISION,
    rider_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create grocery_order_items table
CREATE TABLE IF NOT EXISTS rweezy.grocery_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES rweezy.grocery_orders(id) ON DELETE CASCADE,
    grocery_item_id UUID NOT NULL REFERENCES rweezy.grocery_items(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    quantity INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create rides table
CREATE TABLE IF NOT EXISTS rweezy.rides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    rider_id UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    pickup_address TEXT NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    drop_address TEXT NOT NULL,
    drop_lat DOUBLE PRECISION NOT NULL,
    drop_lng DOUBLE PRECISION NOT NULL,
    status rweezy.RideStatus DEFAULT 'requested' NOT NULL,
    fare_estimate DECIMAL(10, 2),
    notes TEXT,
    vehicle_type TEXT DEFAULT 'bike' NOT NULL,
    payment_method TEXT DEFAULT 'cash' NOT NULL,
    payment_status TEXT DEFAULT 'pending' NOT NULL,
    delivery_pin CHAR(4),
    estimated_arrival_at TIMESTAMPTZ,
    rider_lat DOUBLE PRECISION,
    rider_lng DOUBLE PRECISION,
    rider_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create package_deliveries table
CREATE TABLE IF NOT EXISTS rweezy.package_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    rider_id UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    pickup_address TEXT NOT NULL,
    pickup_lat DOUBLE PRECISION NOT NULL,
    pickup_lng DOUBLE PRECISION NOT NULL,
    drop_address TEXT NOT NULL,
    drop_lat DOUBLE PRECISION NOT NULL,
    drop_lng DOUBLE PRECISION NOT NULL,
    package_size TEXT DEFAULT 'small' NOT NULL,
    receiver_name TEXT,
    receiver_phone TEXT,
    notes TEXT,
    status rweezy.RideStatus DEFAULT 'requested' NOT NULL,
    fare_estimate DECIMAL(10, 2),
    payment_method TEXT DEFAULT 'cash' NOT NULL,
    payment_status TEXT DEFAULT 'pending' NOT NULL,
    delivery_pin CHAR(4),
    estimated_delivery_at TIMESTAMPTZ,
    rider_lat DOUBLE PRECISION,
    rider_lng DOUBLE PRECISION,
    rider_location_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS rweezy.chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_kind rweezy.ServiceKind NOT NULL,
    service_id UUID NOT NULL,
    sender_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_service_kind_service_id_created_at ON rweezy.chat_messages(service_kind, service_id, created_at);

-- Create user_push_tokens table
CREATE TABLE IF NOT EXISTS rweezy.user_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    platform TEXT DEFAULT 'web' NOT NULL,
    device_label TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_id ON rweezy.user_push_tokens(user_id);

-- Create saved_addresses table
CREATE TABLE IF NOT EXISTS rweezy.saved_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    is_default BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create role_requests table
CREATE TABLE IF NOT EXISTS rweezy.role_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    requested_role rweezy.AppRole NOT NULL,
    status rweezy.RoleRequestStatus DEFAULT 'pending' NOT NULL,
    business_name TEXT,
    business_address TEXT,
    business_lat DOUBLE PRECISION,
    business_lng DOUBLE PRECISION,
    town_name TEXT,
    pincode TEXT,
    message TEXT,
    reviewed_by UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT idx_role_requests_pending_unique UNIQUE (user_id, requested_role)
);

-- Create platform_settings table
CREATE TABLE IF NOT EXISTS rweezy.platform_settings (
    key TEXT PRIMARY KEY,
    value JSONB DEFAULT '{}'::jsonb NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Create order_reviews table
CREATE TABLE IF NOT EXISTS rweezy.order_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES rweezy.users(id) ON DELETE CASCADE,
    service_kind rweezy.ServiceKind NOT NULL,
    service_id UUID NOT NULL,
    rating INT NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT idx_order_reviews_user_id_service_kind_service_id UNIQUE (user_id, service_kind, service_id)
);

-- Create audit_events table
CREATE TABLE IF NOT EXISTS rweezy.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES rweezy.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    message TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
