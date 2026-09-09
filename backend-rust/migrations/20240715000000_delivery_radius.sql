-- Add delivery_radius_km column to restaurants and grocery_stores tables
ALTER TABLE rweezy.restaurants ADD COLUMN IF NOT EXISTS delivery_radius_km DOUBLE PRECISION DEFAULT 25.0 NOT NULL;
ALTER TABLE rweezy.grocery_stores ADD COLUMN IF NOT EXISTS delivery_radius_km DOUBLE PRECISION DEFAULT 25.0 NOT NULL;
