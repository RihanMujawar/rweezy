
ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS rider_lat double precision,
  ADD COLUMN IF NOT EXISTS rider_lng double precision,
  ADD COLUMN IF NOT EXISTS rider_location_updated_at timestamptz;

ALTER TABLE public.package_deliveries
  ADD COLUMN IF NOT EXISTS rider_lat double precision,
  ADD COLUMN IF NOT EXISTS rider_lng double precision,
  ADD COLUMN IF NOT EXISTS rider_location_updated_at timestamptz;

ALTER TABLE public.food_orders
  ADD COLUMN IF NOT EXISTS rider_lat double precision,
  ADD COLUMN IF NOT EXISTS rider_lng double precision,
  ADD COLUMN IF NOT EXISTS rider_location_updated_at timestamptz;

ALTER TABLE public.grocery_orders
  ADD COLUMN IF NOT EXISTS rider_lat double precision,
  ADD COLUMN IF NOT EXISTS rider_lng double precision,
  ADD COLUMN IF NOT EXISTS rider_location_updated_at timestamptz;

ALTER TABLE public.rides REPLICA IDENTITY FULL;
ALTER TABLE public.package_deliveries REPLICA IDENTITY FULL;
ALTER TABLE public.food_orders REPLICA IDENTITY FULL;
ALTER TABLE public.grocery_orders REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rides; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.package_deliveries; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.food_orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.grocery_orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
