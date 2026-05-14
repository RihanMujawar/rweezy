
-- ===== ENUMS =====
CREATE TYPE public.app_role AS ENUM ('customer', 'admin', 'hotel_manager', 'grocery_manager', 'delivery_boy', 'rider');
CREATE TYPE public.order_status AS ENUM ('pending', 'accepted', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled');
CREATE TYPE public.ride_status AS ENUM ('requested', 'accepted', 'started', 'completed', 'cancelled');

-- ===== PROFILES =====
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ===== USER ROLES =====
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ===== has_role security definer function =====
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- ===== Auto-create profile + customer role on signup =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== updated_at helper =====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== RESTAURANTS =====
CREATE TABLE public.restaurants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  image_url TEXT,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_restaurants_updated BEFORE UPDATE ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== MENU ITEMS =====
CREATE TABLE public.menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url TEXT,
  category TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== GROCERY STORES =====
CREATE TABLE public.grocery_stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  image_url TEXT,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grocery_stores ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_grocery_stores_updated BEFORE UPDATE ON public.grocery_stores
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== GROCERY ITEMS =====
CREATE TABLE public.grocery_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES public.grocery_stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  image_url TEXT,
  category TEXT,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grocery_items ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_grocery_items_updated BEFORE UPDATE ON public.grocery_items
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== FOOD ORDERS =====
CREATE TABLE public.food_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  delivery_boy_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'pending',
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_address TEXT NOT NULL,
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.food_orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_food_orders_updated BEFORE UPDATE ON public.food_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.food_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.food_orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.food_order_items ENABLE ROW LEVEL SECURITY;

-- ===== GROCERY ORDERS =====
CREATE TABLE public.grocery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id UUID NOT NULL REFERENCES public.grocery_stores(id) ON DELETE RESTRICT,
  delivery_boy_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.order_status NOT NULL DEFAULT 'pending',
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_address TEXT NOT NULL,
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grocery_orders ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_grocery_orders_updated BEFORE UPDATE ON public.grocery_orders
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.grocery_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.grocery_orders(id) ON DELETE CASCADE,
  grocery_item_id UUID NOT NULL REFERENCES public.grocery_items(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.grocery_order_items ENABLE ROW LEVEL SECURITY;

-- ===== RIDES =====
CREATE TABLE public.rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  drop_address TEXT NOT NULL,
  drop_lat DOUBLE PRECISION NOT NULL,
  drop_lng DOUBLE PRECISION NOT NULL,
  status public.ride_status NOT NULL DEFAULT 'requested',
  fare_estimate NUMERIC(10,2),
  notes TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rides ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_rides_updated BEFORE UPDATE ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== PACKAGE DELIVERIES =====
CREATE TABLE public.package_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  drop_address TEXT NOT NULL,
  drop_lat DOUBLE PRECISION NOT NULL,
  drop_lng DOUBLE PRECISION NOT NULL,
  package_size TEXT NOT NULL DEFAULT 'small',
  receiver_name TEXT,
  receiver_phone TEXT,
  notes TEXT,
  status public.ride_status NOT NULL DEFAULT 'requested',
  fare_estimate NUMERIC(10,2),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.package_deliveries ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_packages_updated BEFORE UPDATE ON public.package_deliveries
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===================================================
-- RLS POLICIES
-- ===================================================

-- profiles
CREATE POLICY "Profiles select own or admin" ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Profiles update own or admin" ON public.profiles FOR UPDATE
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Profiles insert self" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- user_roles: users can read own roles; admins manage all
CREATE POLICY "Read own roles" ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manage roles insert" ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manage roles update" ON public.user_roles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin manage roles delete" ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- restaurants: public read; managers update own; admin all
CREATE POLICY "Restaurants public read" ON public.restaurants FOR SELECT USING (true);
CREATE POLICY "Restaurants admin insert" ON public.restaurants FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Restaurants manager or admin update" ON public.restaurants FOR UPDATE
  USING (manager_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Restaurants admin delete" ON public.restaurants FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- menu_items: public read; manager of restaurant or admin write
CREATE POLICY "Menu public read" ON public.menu_items FOR SELECT USING (true);
CREATE POLICY "Menu manager insert" ON public.menu_items FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.manager_id = auth.uid())
  );
CREATE POLICY "Menu manager update" ON public.menu_items FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.manager_id = auth.uid())
  );
CREATE POLICY "Menu manager delete" ON public.menu_items FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.manager_id = auth.uid())
  );

-- grocery_stores
CREATE POLICY "Stores public read" ON public.grocery_stores FOR SELECT USING (true);
CREATE POLICY "Stores admin insert" ON public.grocery_stores FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Stores manager or admin update" ON public.grocery_stores FOR UPDATE
  USING (manager_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Stores admin delete" ON public.grocery_stores FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- grocery_items
CREATE POLICY "Grocery items public read" ON public.grocery_items FOR SELECT USING (true);
CREATE POLICY "Grocery items manager insert" ON public.grocery_items FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = store_id AND s.manager_id = auth.uid())
  );
CREATE POLICY "Grocery items manager update" ON public.grocery_items FOR UPDATE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = store_id AND s.manager_id = auth.uid())
  );
CREATE POLICY "Grocery items manager delete" ON public.grocery_items FOR DELETE
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = store_id AND s.manager_id = auth.uid())
  );

-- food_orders
CREATE POLICY "Food orders select" ON public.food_orders FOR SELECT
  USING (
    customer_id = auth.uid()
    OR delivery_boy_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'delivery_boy') AND delivery_boy_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.manager_id = auth.uid())
  );
CREATE POLICY "Food orders customer insert" ON public.food_orders FOR INSERT
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Food orders update" ON public.food_orders FOR UPDATE
  USING (
    customer_id = auth.uid()
    OR delivery_boy_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'delivery_boy') AND delivery_boy_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.manager_id = auth.uid())
  );

-- food_order_items
CREATE POLICY "Food items select via order" ON public.food_order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.food_orders o WHERE o.id = order_id AND (
        o.customer_id = auth.uid()
        OR o.delivery_boy_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'delivery_boy') AND o.delivery_boy_id IS NULL)
        OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.manager_id = auth.uid())
      )
    )
  );
CREATE POLICY "Food items insert via own order" ON public.food_order_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.food_orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
  );

-- grocery_orders (mirror)
CREATE POLICY "Grocery orders select" ON public.grocery_orders FOR SELECT
  USING (
    customer_id = auth.uid()
    OR delivery_boy_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'delivery_boy') AND delivery_boy_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = store_id AND s.manager_id = auth.uid())
  );
CREATE POLICY "Grocery orders customer insert" ON public.grocery_orders FOR INSERT
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Grocery orders update" ON public.grocery_orders FOR UPDATE
  USING (
    customer_id = auth.uid()
    OR delivery_boy_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'delivery_boy') AND delivery_boy_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = store_id AND s.manager_id = auth.uid())
  );

CREATE POLICY "Grocery items select via order" ON public.grocery_order_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.grocery_orders o WHERE o.id = order_id AND (
        o.customer_id = auth.uid()
        OR o.delivery_boy_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR (public.has_role(auth.uid(), 'delivery_boy') AND o.delivery_boy_id IS NULL)
        OR EXISTS (SELECT 1 FROM public.grocery_stores s WHERE s.id = o.store_id AND s.manager_id = auth.uid())
      )
    )
  );
CREATE POLICY "Grocery items insert via own order" ON public.grocery_order_items FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.grocery_orders o WHERE o.id = order_id AND o.customer_id = auth.uid())
  );

-- rides
CREATE POLICY "Rides select" ON public.rides FOR SELECT
  USING (
    customer_id = auth.uid()
    OR rider_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'rider') AND rider_id IS NULL)
  );
CREATE POLICY "Rides customer insert" ON public.rides FOR INSERT
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Rides update" ON public.rides FOR UPDATE
  USING (
    customer_id = auth.uid()
    OR rider_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'rider') AND rider_id IS NULL)
  );

-- packages (mirror)
CREATE POLICY "Packages select" ON public.package_deliveries FOR SELECT
  USING (
    customer_id = auth.uid()
    OR rider_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'rider') AND rider_id IS NULL)
  );
CREATE POLICY "Packages customer insert" ON public.package_deliveries FOR INSERT
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "Packages update" ON public.package_deliveries FOR UPDATE
  USING (
    customer_id = auth.uid()
    OR rider_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'rider') AND rider_id IS NULL)
  );
