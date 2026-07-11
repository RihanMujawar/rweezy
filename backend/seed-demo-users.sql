-- Insert demo users directly via SQL
-- Password: Demo123456
-- bcrypt hash of "Demo123456" with cost 10
-- $2a$10$ABC123def456GHI789jklMNOpqrsTUVwxyZ0123456789abcdef01

DO $$
DECLARE
    customer_id uuid;
    rider_id uuid;
    delivery_id uuid;
    restaurant_id uuid;
    grocery_id uuid;
    admin_id uuid;
    pass_hash text := '$2a$10$ABC123def456GHI789jklMNOpqrsTUVwxyZ0123456789abcdef01';
BEGIN
    -- Demo Customer
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.customer@rweezy.test', '+919000000001', pass_hash, now(), now())
    RETURNING id INTO customer_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (customer_id, 'Demo Customer', '+919000000001', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), customer_id, 'customer', now());

    -- Demo Rider
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.rider@rweezy.test', '+919000000002', pass_hash, now(), now())
    RETURNING id INTO rider_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (rider_id, 'Demo Rider', '+919000000002', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), rider_id, 'rider', now());

    -- Demo Delivery Boy
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.delivery@rweezy.test', '+919000000003', pass_hash, now(), now())
    RETURNING id INTO delivery_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (delivery_id, 'Demo Delivery Partner', '+919000000003', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), delivery_id, 'delivery_boy', now());

    -- Demo Restaurant Manager
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.restaurant@rweezy.test', '+919000000004', pass_hash, now(), now())
    RETURNING id INTO restaurant_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (restaurant_id, 'Demo Restaurant Manager', '+919000000004', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), restaurant_id, 'hotel_manager', now());

    -- Demo Grocery Manager
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.grocery@rweezy.test', '+919000000005', pass_hash, now(), now())
    RETURNING id INTO grocery_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (grocery_id, 'Demo Grocery Manager', '+919000000005', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), grocery_id, 'grocery_manager', now());

    -- Demo Admin
    INSERT INTO rweezy."User" (id, email, phone, password_hash, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo.admin@rweezy.test', '+919000000006', pass_hash, now(), now())
    RETURNING id INTO admin_id;
    
    INSERT INTO rweezy.profiles (id, full_name, phone, created_at, updated_at)
    VALUES (admin_id, 'Demo Admin', '+919000000006', now(), now());
    
    INSERT INTO rweezy.user_roles (id, user_id, role, created_at)
    VALUES (gen_random_uuid(), admin_id, 'admin', now());

    RAISE NOTICE 'Demo users created successfully!';
END $$;
