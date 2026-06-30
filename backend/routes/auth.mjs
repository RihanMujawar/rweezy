import {
  createConfirmedUserWithPassword,
  createSessionForEmail,
  findUserByEmail,
  findUserByPhone,
  getUserFromToken,
  getRoles,
  refreshAuthSession,
  resendSignupConfirmation,
  revokeSession,
  serviceRoleRestRequest,
  signInWithPassword,
  signUpWithPassword,
  updateUserPassword,
} from "../lib/supabase.mjs";
import {
  createPhoneVerificationToken,
  verifyPhoneVerificationToken,
} from "../lib/phone-verification.mjs";
import {
  sendWhatsAppOtp,
  verifyWhatsAppOtp,
} from "../lib/whatsapp-otp.mjs";
import { verifyFirebaseToken } from "../lib/firebase-admin.mjs";
import { HttpError, parseCookies, getBearerToken, serializeCookie, isMissingTableError } from "../lib/http.mjs";
import { env } from "../lib/env.mjs";
import { normalizeIndianPhone } from "../lib/request-utils.mjs";
import {
  loginSchema,
  phoneOtpSendSchema,
  phoneOtpVerifySchema,
  passwordResetRequestSchema,
  passwordResetCompleteSchema,
  registerSchema,
} from "../lib/validation.mjs";
import { z } from "zod";

const ACCESS_COOKIE = "rweezy_access_token";
const REFRESH_COOKIE = "rweezy_refresh_token";

export function normalizeAuthSession(payload) {
  const session = payload?.session ?? payload;

  return {
    accessToken: session?.access_token ?? null,
    refreshToken: session?.refresh_token ?? null,
    expiresIn: Number(session?.expires_in ?? 3600),
    user: payload?.user ?? session?.user ?? null,
  };
}

export function buildSessionCookies(payload) {
  const session = normalizeAuthSession(payload);

  if (!session.accessToken || !session.refreshToken) {
    return [];
  }

  return [
    serializeCookie(ACCESS_COOKIE, session.accessToken, {
      maxAge: session.expiresIn,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
    serializeCookie(REFRESH_COOKIE, session.refreshToken, {
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
  ];
}

export function clearSessionCookies() {
  return [
    serializeCookie(ACCESS_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
    serializeCookie(REFRESH_COOKIE, "", {
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
  ];
}

async function resolveAccountForPasswordReset(email) {
  const user = await findUserByEmail(email);
  if (!user?.id) return null;

  const rows = await serviceRoleRestRequest(
    `/profiles?select=phone&id=eq.${user.id}&limit=1`,
  );
  const profilePhone = typeof rows?.[0]?.phone === "string" ? rows[0].phone.trim() : "";
  const metadataPhone =
    typeof user?.user_metadata?.phone === "string" ? user.user_metadata.phone.trim() : "";
  const authPhone = typeof user?.phone === "string" ? user.phone.trim() : "";
  const phone = profilePhone || metadataPhone || authPhone;

  return {
    userId: user.id,
    email: user.email?.toLowerCase() ?? email,
    phone: phone || null,
  };
}

async function assertPhoneAvailable(phone) {
  const rows = await serviceRoleRestRequest(
    `/profiles?select=id&phone=eq.${phone}&limit=1`,
  );
  if (rows?.length) {
    throw new HttpError(409, "This phone number is already registered");
  }
}

async function assertEmailAvailable(email) {
  const existingUser = await findUserByEmail(email);
  if (existingUser?.id) {
    throw new HttpError(409, "This email address is already registered");
  }
}

async function completeUserRegistration({
  email,
  fullName,
  password,
  phone,
  phoneVerificationToken,
  requestedRole,
  businessName,
  businessAddress,
  businessLat,
  businessLng,
  townName,
  pincode,
  roleMessage,
}) {
  const isStoreRole = ["hotel_manager", "grocery_manager"].includes(requestedRole);

  if (isStoreRole && !businessName) {
    throw new HttpError(400, "Restaurant or store name is required");
  }
  if (isStoreRole && !businessAddress) {
    throw new HttpError(400, "Business address is required");
  }
  if (
    isStoreRole &&
    (!Number.isFinite(businessLat) ||
      businessLat < -90 ||
      businessLat > 90 ||
      !Number.isFinite(businessLng) ||
      businessLng < -180 ||
      businessLng > 180)
  ) {
    throw new HttpError(400, "Pin a valid restaurant or store location");
  }

  verifyPhoneVerificationToken(phoneVerificationToken, phone);
  if (email) await assertEmailAvailable(email);
  await assertPhoneAvailable(phone);

  const role = "customer";
  let createdUserId = null;
  let emailVerificationRequired = email ? env.authRequireEmailVerification : false;

  if (emailVerificationRequired) {
    const signup = await signUpWithPassword(email, password, fullName, {
      role,
      phone,
      requested_role: requestedRole,
    });
    createdUserId = signup?.user?.id ?? signup?.id ?? null;
    if (!createdUserId) {
      throw new HttpError(500, "Account was created but no user id was returned");
    }
  } else {
    const createdUser = await createConfirmedUserWithPassword(email, password, fullName, {
      role,
      phone,
      requested_role: requestedRole,
    });
    createdUserId = createdUser?.id ?? createdUser?.user?.id;
    emailVerificationRequired = false;
    if (!createdUserId) {
      throw new HttpError(500, "Account was created but no user id was returned");
    }
  }

  await serviceRoleRestRequest(`/profiles?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: {
      id: createdUserId,
      full_name: fullName,
      phone,
    },
  });

  await serviceRoleRestRequest(`/user_roles?on_conflict=user_id,role`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates" },
    body: {
      user_id: createdUserId,
      role,
    },
  });

  let roleRequestPending = false;
  let roleRequestWarning = null;

  if (requestedRole) {
    try {
      const roleRequestRows = await serviceRoleRestRequest("/role_requests", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          user_id: createdUserId,
          requested_role: requestedRole,
          business_name: businessName || null,
          business_address: businessAddress || null,
          business_lat: isStoreRole ? businessLat : null,
          business_lng: isStoreRole ? businessLng : null,
          town_name: townName || null,
          pincode: pincode || null,
          message: roleMessage || "Requested during registration",
        },
      });
      roleRequestPending = true;

      // Notify Admins
      void (async () => {
        try {
          const { notifyUsersWithRole } = await import("../lib/notifications.mjs");
          const roleLabel = requestedRole.replace(/_/g, " ");
          await notifyUsersWithRole("admin", {
            title: "New Role Request",
            body: `${fullName} has requested the ${roleLabel} role.`,
            data: { type: "new_role_request", user_id: createdUserId, role: requestedRole },
          });
        } catch (error) {
          console.warn("Failed to send admin role request notification:", error.message);
        }
      })();
    } catch (error) {
      if (!isMissingTableError(error, "role_requests")) throw error;
      roleRequestWarning = "Account created, but role request storage is not available.";
      console.warn(`Role request skipped: ${error.message}`);
    }
  }

  if (emailVerificationRequired) {
    return {
      user: { id: createdUserId, email: email || null },
      roles: [role],
      authenticated: false,
      emailVerificationRequired: true,
      roleRequestPending,
      roleRequestWarning,
    };
  }

  const session = await signInWithPassword(email ? { email } : { phone }, password);
  const normalized = normalizeAuthSession(session);
  const roles =
    normalized.accessToken && normalized.user
      ? await getRoles(normalized.accessToken, normalized.user.id)
      : [role];

  return {
    user: normalized.user,
    roles,
    authenticated: Boolean(normalized.accessToken),
    emailVerificationRequired: false,
    roleRequestPending,
    roleRequestWarning,
    __responseHeaders: {
      "Set-Cookie": buildSessionCookies(session),
    },
  };
}

export const authRoutes = [
  {
    method: "POST",
    pattern: /^\/api\/auth\/phone\/send-otp$/,
    handler: async ({ body }) => {
      const { phone, purpose, email } = phoneOtpSendSchema.parse(body);

      if (purpose === "login") {
        const user = await findUserByPhone(phone);
        if (!user) {
          throw new HttpError(404, "No account found for this phone number");
        }
      } else if (purpose === "reset_password") {
        if (!email) {
          throw new HttpError(400, "Email is required for password reset");
        }
        const account = await resolveAccountForPasswordReset(email);
        if (!account?.phone) {
          throw new HttpError(404, "No account found for this email, or no phone on file");
        }
        if (account.phone !== phone) {
          throw new HttpError(400, "Phone number does not match the account for this email");
        }
      } else {
        await assertPhoneAvailable(phone);
      }

      await sendWhatsAppOtp(phone);

      return {
        ok: true,
        purpose,
        provider: "whatsapp",
        message: "Verification code sent to your WhatsApp",
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/phone\/verify-otp$/,
    handler: async ({ body }) => {
      const { phone, code, purpose } = phoneOtpVerifySchema.parse(body);

      verifyWhatsAppOtp(phone, code);

      if (purpose === "register" || purpose === "reset_password") {
        return {
          ok: true,
          phoneVerificationToken: createPhoneVerificationToken(phone),
        };
      }

      const user = await findUserByPhone(phone);
      if (!user) {
        throw new HttpError(404, "No account found for this phone number");
      }

      if (!user.email) {
        throw new HttpError(400, "This account does not have an email address for passwordless sign-in. Please use your password.");
      }

      const session = await createSessionForEmail(user.email);
      const normalized = normalizeAuthSession(session);
      if (!normalized.user) {
        throw new HttpError(401, "Unable to sign in with this phone number");
      }

      const roles = normalized.accessToken
        ? await getRoles(normalized.accessToken, normalized.user.id)
        : [];

      return {
        user: normalized.user,
        roles,
        __responseHeaders: {
          "Set-Cookie": buildSessionCookies(session),
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/password-reset\/request$/,
    handler: async ({ body }) => {
      const { phone } = passwordResetRequestSchema.parse(body);

      const user = await findUserByPhone(phone);
      if (!user) {
        throw new HttpError(404, "No account found for this phone number");
      }

      await sendWhatsAppOtp(phone);

      return {
        ok: true,
        message: "Verification code sent to your WhatsApp",
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/password-reset\/complete$/,
    handler: async ({ body }) => {
      const { phone, phone_verification_token, password } = passwordResetCompleteSchema.parse(body);

      verifyPhoneVerificationToken(phone_verification_token, phone);

      const user = await findUserByPhone(phone);
      if (!user) throw new HttpError(404, "Account not found");

      await updateUserPassword(user.id, password);

      const identifier = user.email ? { email: user.email } : { phone };
      const session = await signInWithPassword(identifier, password);
      const normalized = normalizeAuthSession(session);
      if (!normalized.accessToken || !normalized.user?.id) {
        throw new HttpError(500, "Password updated, but sign-in session could not be created");
      }
      const roles = await getRoles(normalized.accessToken, normalized.user.id);

      return {
        ok: true,
        user: normalized.user,
        roles,
        message: "Password updated. You are now signed in.",
        __responseHeaders: {
          "Set-Cookie": buildSessionCookies(session),
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/email\/resend-verification$/,
    handler: async ({ body }) => {
      const email = z.string().trim().email().parse(body.email);

      await resendSignupConfirmation(email);
      return {
        ok: true,
        message: "Verification email sent. Check your inbox and spam folder.",
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/login$/,
    handler: async ({ body }) => {
      const { email, phone, password } = loginSchema.parse(body);
      let identifier = email ? { email } : { phone };

      if (phone && !email) {
        const user = await findUserByPhone(phone);
        if (!user) {
          throw new HttpError(404, "No account found for this phone number");
        }
        if (user.email) {
          identifier = { email: user.email };
        }
      }

      let session;
      try {
        session = await signInWithPassword(identifier, password);
      } catch (error) {
        if (error instanceof HttpError && /confirm/i.test(error.message)) {
          throw new HttpError(
            403,
            "Verify your email before signing in. Check your inbox or request a new verification email.",
          );
        }
        throw error;
      }
      const normalized = normalizeAuthSession(session);

      if (!normalized.user) {
        throw new HttpError(401, "Unable to sign in");
      }

      const roles = normalized.accessToken
        ? await getRoles(normalized.accessToken, normalized.user.id)
        : [];

      return {
        user: normalized.user,
        roles,
        __responseHeaders: {
          "Set-Cookie": buildSessionCookies(session),
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/register$/,
    handler: async ({ body }) => {
      const validated = registerSchema.parse(body);

      return completeUserRegistration({
        email: validated.email,
        fullName: validated.full_name,
        password: validated.password,
        phone: validated.phone,
        phoneVerificationToken: validated.phone_verification_token,
        requestedRole: validated.requested_role,
        businessName: validated.business_name,
        businessAddress: validated.business_address,
        businessLat: validated.business_lat,
        businessLng: validated.business_lng,
        townName: validated.town_name,
        pincode: validated.pincode,
        roleMessage: validated.role_message,
      });
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/firebase-google$/,
    handler: async ({ body }) => {
      const idToken = z.string().min(1).parse(body.id_token);

      let decoded;
      try {
        decoded = await verifyFirebaseToken(idToken);
      } catch (error) {
        throw new HttpError(401, `Invalid Firebase token: ${error.message}`);
      }

      const email = decoded.email?.toLowerCase();
      if (!email) throw new HttpError(400, "Google account must have an email address");

      let user = await findUserByEmail(email);
      let session;

      if (!user) {
        user = await createConfirmedUserWithPassword(email, crypto.randomUUID(), decoded.name || "Google User", {
          role: "customer",
          provider: "google",
        });

        const userId = user?.id ?? user?.user?.id;
        if (userId) {
          await serviceRoleRestRequest(`/profiles?on_conflict=id`, {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates" },
            body: {
              id: userId,
              full_name: decoded.name || "Google User",
            },
          });

          await serviceRoleRestRequest(`/user_roles?on_conflict=user_id,role`, {
            method: "POST",
            headers: { Prefer: "resolution=ignore-duplicates" },
            body: {
              user_id: userId,
              role: "customer",
            },
          });
        }
      }

      session = await createSessionForEmail(email);
      const normalized = normalizeAuthSession(session);
      const roles = normalized.accessToken
        ? await getRoles(normalized.accessToken, normalized.user.id)
        : ["customer"];

      return {
        user: normalized.user,
        roles,
        __responseHeaders: {
          "Set-Cookie": buildSessionCookies(session),
        },
      };
    },
  },
  {
    method: "POST",
    pattern: /^\/api\/auth\/logout$/,
    handler: async ({ req }) => {
      const bearerToken = getBearerToken(req);
      const cookies = parseCookies(req);
      const accessToken = bearerToken || cookies[ACCESS_COOKIE];

      if (accessToken) {
        await revokeSession(accessToken);
      }

      return {
        ok: true,
        __responseHeaders: {
          "Set-Cookie": clearSessionCookies(),
        },
      };
    },
  },
  {
    method: "GET",
    pattern: /^\/api\/auth\/me$/,
    handler: async ({ token, user }) => {
      const roles = await getRoles(token, user.id);
      return { user, roles };
    },
  },
];
