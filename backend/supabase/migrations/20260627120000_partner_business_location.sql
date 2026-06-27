ALTER TABLE public.role_requests
  ADD COLUMN IF NOT EXISTS business_address TEXT,
  ADD COLUMN IF NOT EXISTS business_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS business_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS town_name TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;

ALTER TABLE public.role_requests
  DROP CONSTRAINT IF EXISTS role_requests_business_lat_check,
  DROP CONSTRAINT IF EXISTS role_requests_business_lng_check;

ALTER TABLE public.role_requests
  ADD CONSTRAINT role_requests_business_lat_check
    CHECK (business_lat IS NULL OR business_lat BETWEEN -90 AND 90),
  ADD CONSTRAINT role_requests_business_lng_check
    CHECK (business_lng IS NULL OR business_lng BETWEEN -180 AND 180);

NOTIFY pgrst, 'reload schema';
