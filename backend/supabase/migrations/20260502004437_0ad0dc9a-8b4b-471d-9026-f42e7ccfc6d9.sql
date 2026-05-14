-- Allow grocery managers to insert their own store (mirror restaurants policy)
CREATE POLICY "Stores manager self insert"
ON public.grocery_stores
FOR INSERT
WITH CHECK (manager_id = auth.uid() AND public.has_role(auth.uid(), 'grocery_manager'));

-- One store per grocery manager
CREATE UNIQUE INDEX IF NOT EXISTS grocery_stores_manager_unique
ON public.grocery_stores(manager_id)
WHERE manager_id IS NOT NULL;