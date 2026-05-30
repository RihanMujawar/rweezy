ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS town_name TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS town_name TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;

ALTER TABLE public.grocery_stores
  ADD COLUMN IF NOT EXISTS town_name TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role public.app_role;
  requested_role_text TEXT;
BEGIN
  requested_role_text := COALESCE(NEW.raw_user_meta_data ->> 'role', 'customer');
  requested_role := CASE
    WHEN requested_role_text IN ('customer', 'hotel_manager', 'delivery_boy')
      THEN requested_role_text::public.app_role
    ELSE 'customer'::public.app_role
  END;

  INSERT INTO public.profiles (id, full_name, town_name, pincode)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data ->> 'town_name', '')), ''),
    NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data ->> 'pincode', '')), '')
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, requested_role);

  RETURN NEW;
END;
$$;
