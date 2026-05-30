-- Platform settings (commission rates, etc.)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform settings admin read" ON public.platform_settings FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Platform settings admin write" ON public.platform_settings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.platform_settings (key, value) VALUES
  ('commissions', '{"restaurant":10,"grocery":8,"delivery":12}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Delivery verification PIN (4 digits) and ETA
ALTER TABLE public.food_orders
  ADD COLUMN IF NOT EXISTS delivery_pin CHAR(4),
  ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contactless_delivery BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.grocery_orders
  ADD COLUMN IF NOT EXISTS delivery_pin CHAR(4),
  ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contactless_delivery BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS delivery_pin CHAR(4),
  ADD COLUMN IF NOT EXISTS estimated_arrival_at TIMESTAMPTZ;

ALTER TABLE public.package_deliveries
  ADD COLUMN IF NOT EXISTS delivery_pin CHAR(4),
  ADD COLUMN IF NOT EXISTS estimated_delivery_at TIMESTAMPTZ;

-- Grocery unit of measurement
ALTER TABLE public.grocery_items
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'pcs';

-- Order reviews
CREATE TABLE IF NOT EXISTS public.order_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_kind TEXT NOT NULL CHECK (service_kind IN ('food', 'grocery', 'ride', 'package')),
  service_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, service_kind, service_id)
);

ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Reviews select authenticated" ON public.order_reviews FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "Reviews insert own" ON public.order_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_reviews;
