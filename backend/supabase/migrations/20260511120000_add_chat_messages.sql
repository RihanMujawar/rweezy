CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_kind TEXT NOT NULL CHECK (service_kind IN ('ride', 'package', 'food', 'grocery')),
  service_id UUID NOT NULL,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_service
  ON public.chat_messages (service_kind, service_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_messages_sender
  ON public.chat_messages (sender_id);

CREATE POLICY "Chat participants select" ON public.chat_messages FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      service_kind = 'ride'
      AND EXISTS (
        SELECT 1 FROM public.rides r
        WHERE r.id = service_id
          AND (r.customer_id = auth.uid() OR r.rider_id = auth.uid())
      )
    )
    OR (
      service_kind = 'package'
      AND EXISTS (
        SELECT 1 FROM public.package_deliveries p
        WHERE p.id = service_id
          AND (p.customer_id = auth.uid() OR p.rider_id = auth.uid())
      )
    )
    OR (
      service_kind = 'food'
      AND EXISTS (
        SELECT 1 FROM public.food_orders f
        WHERE f.id = service_id
          AND (f.customer_id = auth.uid() OR f.delivery_boy_id = auth.uid())
      )
    )
    OR (
      service_kind = 'grocery'
      AND EXISTS (
        SELECT 1 FROM public.grocery_orders g
        WHERE g.id = service_id
          AND (g.customer_id = auth.uid() OR g.delivery_boy_id = auth.uid())
      )
    )
  );

CREATE POLICY "Chat participants insert" ON public.chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        service_kind = 'ride'
        AND EXISTS (
          SELECT 1 FROM public.rides r
          WHERE r.id = service_id
            AND (r.customer_id = auth.uid() OR r.rider_id = auth.uid())
        )
      )
      OR (
        service_kind = 'package'
        AND EXISTS (
          SELECT 1 FROM public.package_deliveries p
          WHERE p.id = service_id
            AND (p.customer_id = auth.uid() OR p.rider_id = auth.uid())
        )
      )
      OR (
        service_kind = 'food'
        AND EXISTS (
          SELECT 1 FROM public.food_orders f
          WHERE f.id = service_id
            AND (f.customer_id = auth.uid() OR f.delivery_boy_id = auth.uid())
        )
      )
      OR (
        service_kind = 'grocery'
        AND EXISTS (
          SELECT 1 FROM public.grocery_orders g
          WHERE g.id = service_id
            AND (g.customer_id = auth.uid() OR g.delivery_boy_id = auth.uid())
        )
      )
    )
  );

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
