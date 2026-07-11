import { z } from "zod";

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+\d{10,15}$/, "Use a country code, for example +919876543210");

export const loginPhonePasswordSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const loginPhoneSchema = z.object({
  phone: phoneSchema,
});

export const passwordResetRequestSchema = z.object({
  phone: phoneSchema,
});

export const passwordResetCompleteSchema = z
  .object({
    phone: phoneSchema,
    password: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string().min(6, "Confirm your password"),
    phoneVerificationToken: z.string().min(1, "Phone verification is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export const phoneOtpCodeSchema = z.object({
  phone: phoneSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "Enter the verification code sent to your phone"),
});

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, "Enter your full name").max(120),
    phone: phoneSchema,
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Za-z]/, "Password must include at least one letter")
      .regex(/\d/, "Password must include at least one number"),
    confirmPassword: z.string().min(8, "Confirm your password"),
    requestedRole: z.enum([
      "customer",
      "rider",
      "delivery_boy",
      "hotel_manager",
      "grocery_manager",
    ]),
    businessName: z.string().trim().max(160).optional(),
    businessAddress: z.string().trim().max(300).optional(),
    townName: z.string().trim().max(120).optional(),
    pincode: z.string().trim().max(12).optional(),
    businessLocation: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .nullable()
      .optional(),
    roleMessage: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .superRefine((data, ctx) => {
    if (!["hotel_manager", "grocery_manager"].includes(data.requestedRole)) return;
    if (!data.businessName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessName"],
        message: "Enter your restaurant or store name",
      });
    }
    if (!data.businessAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessAddress"],
        message: "Enter the complete business address",
      });
    }
    if (!data.businessLocation) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["businessLocation"],
        message: "Pin the restaurant or store location",
      });
    }
  });

export const checkoutSchema = z.object({
  address: z.string().trim().min(5, "Enter a delivery address"),
  deliveryLocation: z.object(
    { lat: z.number(), lng: z.number() },
    { required_error: "Pin your delivery location" },
  ),
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        price: z.number().min(0),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1, "Add at least one item"),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(120),
  phone: phoneSchema,
});

export const rideBookingSchema = z.object({
  pickupAddress: z.string().trim().min(5, "Enter a pickup address"),
  dropAddress: z.string().trim().min(5, "Enter a drop address"),
  pickupLocation: z.object(
    { lat: z.number(), lng: z.number() },
    { required_error: "Choose a pickup point" },
  ),
  dropLocation: z.object(
    { lat: z.number(), lng: z.number() },
    { required_error: "Choose a drop point" },
  ),
  notes: z.string().trim().max(300).optional().default(""),
  vehicle: z.enum(["bike", "auto", "car"]),
});

export const packageBookingSchema = z.object({
  pickupAddress: z.string().trim().min(5, "Enter a pickup address"),
  dropAddress: z.string().trim().min(5, "Enter a drop address"),
  pickupLocation: z.object(
    { lat: z.number(), lng: z.number() },
    { required_error: "Choose a pickup point" },
  ),
  dropLocation: z.object(
    { lat: z.number(), lng: z.number() },
    { required_error: "Choose a drop point" },
  ),
  receiverName: z.string().trim().min(2, "Enter receiver name").max(120),
  receiverPhone: phoneSchema,
  notes: z.string().trim().max(300).optional().default(""),
  size: z.enum(["small", "medium", "large"]),
});

export const roleRequestSchema = z.object({
  requestedRole: z.enum(["rider", "delivery_boy", "hotel_manager", "grocery_manager"]),
  message: z.string().trim().max(500).optional().default(""),
});

export function fieldErrors(error: z.ZodError) {
  return Object.fromEntries(
    Object.entries(error.flatten().fieldErrors).map(([key, value]) => [
      key,
      value?.[0] ?? "Invalid value",
    ]),
  ) as Record<string, string>;
}
