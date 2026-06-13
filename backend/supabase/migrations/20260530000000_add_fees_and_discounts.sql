
-- Update restaurants with manager-configurable fees and discounts
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(10,2) NOT NULL DEFAULT 300.00,
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS service_tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_raining BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rain_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_flat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_bogo_active BOOLEAN NOT NULL DEFAULT false;

-- Update grocery_stores with manager-configurable fees and discounts
ALTER TABLE public.grocery_stores
  ADD COLUMN IF NOT EXISTS free_delivery_threshold NUMERIC(10,2) NOT NULL DEFAULT 300.00,
  ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS service_tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_raining BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rain_fee NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_flat NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS is_bogo_active BOOLEAN NOT NULL DEFAULT false;

-- Update food_orders with fee breakdown
ALTER TABLE public.food_orders
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS delivery_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS packaging_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS rain_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS service_tax_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS platform_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Update grocery_orders with fee breakdown
ALTER TABLE public.grocery_orders
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS delivery_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS packaging_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS rain_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS service_tax_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS platform_fee_applied NUMERIC(10,2) NOT NULL DEFAULT 0.00;

-- Add platform fee to settings
INSERT INTO public.platform_settings (key, value) VALUES
  ('fees', '{"flat_platform_fee": 10.00}'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || '{"flat_platform_fee": 10.00}'::jsonb;
