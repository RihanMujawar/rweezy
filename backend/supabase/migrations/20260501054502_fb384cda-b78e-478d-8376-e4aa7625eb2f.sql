-- Add veg/non-veg flag to menu items
ALTER TABLE public.menu_items 
ADD COLUMN IF NOT EXISTS is_veg boolean NOT NULL DEFAULT true;

-- Allow hotel_manager to insert their own restaurant (one per manager enforced via unique index)
CREATE UNIQUE INDEX IF NOT EXISTS restaurants_manager_unique 
ON public.restaurants(manager_id) 
WHERE manager_id IS NOT NULL;

-- RLS: hotel manager can insert a restaurant where they are the manager
DROP POLICY IF EXISTS "Restaurants manager self insert" ON public.restaurants;
CREATE POLICY "Restaurants manager self insert"
ON public.restaurants
FOR INSERT
TO public
WITH CHECK (
  manager_id = auth.uid() 
  AND public.has_role(auth.uid(), 'hotel_manager'::app_role)
);