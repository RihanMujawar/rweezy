import { restRequest, serviceRoleRestRequest } from "../lib/supabase.mjs";
import { HttpError } from "../lib/http.mjs";
import { cleanText } from "../lib/request-utils.mjs";
import {
  generateDeliveryPin,
  estimateDeliveryAt,
} from "../lib/platform-helpers.mjs";
import { rideBookingSchema, packageBookingSchema } from "../lib/validation.mjs";

function firstRow(rows) {
  return Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);
}

function buildPath(pathname, params = {}) {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    query.set(key, value);
  }

  const qs = query.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function distanceKm(from, to) {
  if (!from || !to) return 0;
  const lat1 = Number(from.lat);
  const lng1 = Number(from.lng);
  const lat2 = Number(to.lat);
  const lng2 = Number(to.lng);

  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return 0;

  const toRad = (value) => (value * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const rideRoutes = [
  {
    method: "POST",
    pattern: /^\/api\/rides$/,
    handler: async ({ token, user, body }) => {
      const validated = rideBookingSchema.parse(body);
      const deliveryPin = generateDeliveryPin();
      const estimatedArrivalAt = estimateDeliveryAt(
        5,
        { lat: validated.pickup_lat, lng: validated.pickup_lng },
        { lat: validated.drop_lat, lng: validated.drop_lng },
        distanceKm,
      );
      const rows = await restRequest(token, buildPath("/rides", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          pickup_lat: validated.pickup_lat,
          pickup_lng: validated.pickup_lng,
          pickup_address: validated.pickup_address,
          drop_lat: validated.drop_lat,
          drop_lng: validated.drop_lng,
          drop_address: validated.drop_address,
          fare_estimate: validated.fare_estimate,
          vehicle_type: validated.vehicle_type,
          notes: validated.notes || null,
          payment_method: validated.payment_method || "cash",
          delivery_pin: deliveryPin,
          estimated_arrival_at: estimatedArrivalAt,
        },
      });

      const ride = firstRow(rows);
      if (ride) {
        void (async () => {
          try {
            const { sendNotification, notifyUsersWithRole } = await import("../lib/notifications.mjs");
            // Notify Customer
            await sendNotification(user.id, {
              title: "Ride Requested",
              body: `Your ride request for ${validated.vehicle_type} has been placed. Searching for a rider nearby.`,
              data: { type: "ride_requested", id: ride.id },
            });
            // Notify Riders (broadcast)
            await notifyUsersWithRole("rider", {
              title: "New Ride Job Available",
              body: `New ${validated.vehicle_type} ride request from ${validated.pickup_address}.`,
              data: { type: "job_available", kind: "ride", id: ride.id },
            });
          } catch (error) {
            console.warn("Failed to send ride notifications:", error.message);
          }
        })();
      }

      return { ride };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/packages$/,
    handler: async ({ token, user, body }) => {
      const validated = packageBookingSchema.parse(body);
      const deliveryPin = generateDeliveryPin();
      const estimatedDeliveryAt = estimateDeliveryAt(
        10,
        { lat: validated.pickup_lat, lng: validated.pickup_lng },
        { lat: validated.drop_lat, lng: validated.drop_lng },
        distanceKm,
      );
      const rows = await restRequest(token, buildPath("/package_deliveries", { select: "*" }), {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          customer_id: user.id,
          pickup_lat: validated.pickup_lat,
          pickup_lng: validated.pickup_lng,
          pickup_address: validated.pickup_address,
          drop_lat: validated.drop_lat,
          drop_lng: validated.drop_lng,
          drop_address: validated.drop_address,
          fare_estimate: validated.fare_estimate,
          package_size: validated.package_size,
          receiver_name: validated.receiver_name,
          receiver_phone: validated.receiver_phone,
          notes: validated.notes || null,
          payment_method: validated.payment_method || "cash",
          delivery_pin: deliveryPin,
          estimated_delivery_at: estimatedDeliveryAt,
        },
      });

      const packageDelivery = firstRow(rows);
      if (packageDelivery) {
        void (async () => {
          try {
            const { sendNotification, notifyUsersWithRole } = await import("../lib/notifications.mjs");
            // Notify Customer
            await sendNotification(user.id, {
              title: "Package Delivery Requested",
              body: "Your package delivery request has been placed. Searching for a rider nearby.",
              data: { type: "package_requested", id: packageDelivery.id },
            });
            // Notify Riders (broadcast)
            await notifyUsersWithRole("rider", {
              title: "New Package Job Available",
              body: `New package delivery request from ${validated.pickup_address}.`,
              data: { type: "job_available", kind: "package", id: packageDelivery.id },
            });
          } catch (error) {
            console.warn("Failed to send package notifications:", error.message);
          }
        })();
      }

      return { packageDelivery };
    },
  },
];
