-- Add all_in_one_partner to AppRole enum when the current role can alter it.
-- Local development databases often use a role that cannot modify enum ownership,
-- so we skip gracefully instead of crashing the backend startup.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_enum
        WHERE enumtypid = 'rweezy.AppRole'::regtype
          AND enumlabel = 'all_in_one_partner'
    ) THEN
        RETURN;
    END IF;

    ALTER TYPE rweezy.AppRole ADD VALUE IF NOT EXISTS 'all_in_one_partner';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping AppRole enum update because the current role cannot alter rweezy.AppRole';
    WHEN undefined_object THEN
        RAISE NOTICE 'Skipping AppRole enum update because rweezy.AppRole is unavailable';
END $$;
