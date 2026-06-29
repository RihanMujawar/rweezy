import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{10,15}$/, "Enter a valid phone number with country code");

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email").optional(),
  phone: phoneSchema.optional(),
  password: z.string().min(1, "Password is required"),
}).refine(data => data.email || data.phone, {
  message: "Email or phone number is required",
});

export const phoneOtpSendSchema = z.object({
  phone: phoneSchema,
  purpose: z.enum(["login", "register", "reset_password"]),
  email: z.string().trim().email().optional(),
});

export const phoneOtpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{4,10}$/, "Enter the verification code"),
  purpose: z.enum(["login", "register", "reset_password"]),
});

export const passwordResetRequestSchema = z.object({
  phone: phoneSchema,
});

export const passwordResetCompleteSchema = z.object({
  phone: phoneSchema,
  phone_verification_token: z.string().min(1, "Phone verification is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is too short").max(120),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  phone: phoneSchema,
  password: z.string().min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Password must include at least one letter")
    .regex(/\d/, "Password must include at least one number"),
  phone_verification_token: z.string().min(1, "Phone verification is required"),
  requested_role: z.enum(["customer", "rider", "delivery_boy", "hotel_manager", "grocery_manager"]).optional(),
  business_name: z.string().trim().max(160).optional(),
  business_address: z.string().trim().max(300).optional(),
  business_lat: z.number().min(-90).max(90).optional(),
  business_lng: z.number().min(-180).max(180).optional(),
  town_name: z.string().trim().max(120).optional(),
  pincode: z.string().trim().max(12).optional(),
  role_message: z.string().trim().max(500).optional(),
});

export const checkoutSchema = z.object({
  restaurant_id: z.string().uuid().optional(),
  store_id: z.string().uuid().optional(),
  delivery_address: z.string().trim().min(5, "Enter a delivery address"),
  delivery_lat: z.number().min(-90).max(90),
  delivery_lng: z.number().min(-180).max(180),
  items: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    price: z.number().min(0),
    quantity: z.number().int().min(1).max(20),
  })).min(1),
  payment_method: z.string().optional().default("cash"),
  notes: z.string().trim().max(300).optional(),
  contactless_delivery: z.boolean().optional(),
});

export const rideBookingSchema = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  drop_lat: z.number().min(-90).max(90),
  drop_lng: z.number().min(-180).max(180),
  pickup_address: z.string().trim().min(5).max(300),
  drop_address: z.string().trim().min(5).max(300),
  fare_estimate: z.number().min(0),
  vehicle_type: z.enum(["bike", "auto", "car"]),
  notes: z.string().trim().max(300).optional(),
  payment_method: z.string().optional().default("cash"),
});

export const packageBookingSchema = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  drop_lat: z.number().min(-90).max(90),
  drop_lng: z.number().min(-180).max(180),
  pickup_address: z.string().trim().min(5).max(300),
  drop_address: z.string().trim().min(5).max(300),
  receiver_name: z.string().trim().min(2).max(120),
  receiver_phone: z.string().trim().min(10).max(30),
  fare_estimate: z.number().min(0),
  package_size: z.enum(["small", "medium", "large"]),
  notes: z.string().trim().max(300).optional(),
  payment_method: z.string().optional().default("cash"),
});

export const addressSchema = z.object({
  label: z.string().trim().max(80).optional(),
  address: z.string().trim().min(5).max(300),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  is_default: z.boolean().optional(),
});

export const profileUpdateSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  phone: phoneSchema,
});

export const reviewSchema = z.object({
  service_kind: z.enum(["food", "grocery", "ride", "package"]),
  service_id: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});
