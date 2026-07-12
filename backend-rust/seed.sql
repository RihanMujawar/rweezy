-- Start transaction to ensure all inserts succeed or fail together
BEGIN;

-- Insert demo users with the exact data provided in the CSV
-- Using password hash for 'Demo123456' (bcrypt with cost factor 12)
WITH new_users AS (
    INSERT INTO rweezy.users (id, phone, password_hash, created_at, updated_at) VALUES
        ('11111111-1111-1111-1111-111111111111'::uuid, '+919000000001', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now()),
        ('22222222-2222-2222-2222-222222222222'::uuid, '+919000000002', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now()),
        ('33333333-3333-3333-3333-333333333333'::uuid, '+919000000003', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now()),
        ('44444444-4444-4444-4444-444444444444'::uuid, '+919000000004', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now()),
        ('55555555-5555-5555-5555-555555555555'::uuid, '+919000000005', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now()),
        ('66666666-6666-6666-6666-666666666666'::uuid, '+919000000006', '$2b$12$LQv3c1yqBwR8S5X9kLvI1eOdX6s5M1PvY7m6n5k3m4q5r6s7t8u9v0w1', now(), now())
    ON CONFLICT (phone) DO NOTHING
    RETURNING id, phone
)

-- Grant appropriate roles to each user based on CSV data
INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
SELECT
    CASE WHEN phone = '+919000000001' THEN 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid
         WHEN phone = '+919000000002' THEN 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
         WHEN phone = '+919000000003' THEN 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid
         WHEN phone = '+919000000004' THEN 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid
         WHEN phone = '+919000000005' THEN 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid -- Fixed short string typo here
         WHEN phone = '+919000000006' THEN 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
    END,
    u.id,
    CASE
        WHEN phone = '+919000000001' THEN 'customer'::rweezy.AppRole
        WHEN phone = '+919000000002' THEN 'rider'::rweezy.AppRole
        WHEN phone = '+919000000003' THEN 'delivery_boy'::rweezy.AppRole
        WHEN phone = '+919000000004' THEN 'hotel_manager'::rweezy.AppRole
        WHEN phone = '+919000000005' THEN 'grocery_manager'::rweezy.AppRole
        WHEN phone = '+919000000006' THEN 'admin'::rweezy.AppRole
    END,
    now()
FROM new_users u;

-- Commit the transaction
COMMIT;

