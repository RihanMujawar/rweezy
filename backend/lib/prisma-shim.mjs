import { prisma } from "./prisma.mjs";
import jwt from "jsonwebtoken";
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
} from "./auth.mjs";
import {
  verifyPhoneVerificationToken
} from "./phone-verification.mjs";
import {
  verifyPhoneVerificationCode
} from "./twilio.mjs";
import {
  verifyPasswordResetEmailOtp
} from "./email-otp.mjs";
import { HttpError } from "./http.mjs";
import { env } from "./env.mjs";

export async function signInWithPassword(identifier, password) {
  const email = identifier.email?.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: { profile: true }
  });

  if (!user) throw new HttpError(401, "Invalid email or password");

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) throw new HttpError(401, "Invalid email or password");

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: {
        full_name: user.profile?.fullName,
        phone: user.profile?.phone
      }
    }
  };
}

export async function signUpWithPassword(email, password, fullName, metadata = {}) {
  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      passwordHash,
      profile: {
        create: {
          fullName,
          phone: metadata.phone
        }
      },
      roles: {
        create: {
          role: metadata.role || 'customer'
        }
      }
    },
    include: { profile: true }
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      user_metadata: {
        full_name: user.profile?.fullName,
        phone: user.profile?.phone,
        ...metadata
      }
    }
  };
}

export async function createConfirmedUserWithPassword(email, password, fullName, metadata = {}) {
  return signUpWithPassword(email, password, fullName, metadata);
}

export async function createSessionForEmail(email) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { profile: true }
  });

  if (!user) throw new HttpError(404, "User not found");

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: {
        full_name: user.profile?.fullName,
        phone: user.profile?.phone
      }
    }
  };
}

export async function resendSignupConfirmation(email) {
  return { ok: true };
}

export async function updateUserPassword(userId, password) {
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });
}

export async function findUserByEmail(email) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { profile: true }
  });
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    user_metadata: {
      full_name: user.profile?.fullName,
      phone: user.profile?.phone
    }
  };
}

export async function findUserEmailByPhone(phone) {
  const user = await prisma.user.findFirst({
    where: { profile: { phone } },
    select: { email: true }
  });
  return user?.email || null;
}

export async function refreshAuthSession(refreshToken) {
  try {
    const decoded = jwt.verify(refreshToken, env.refreshSecret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { profile: true }
    });
    if (!user) throw new Error("User not found");

    const accessToken = generateAccessToken(user);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: {
          full_name: user.profile?.fullName,
          phone: user.profile?.phone
        }
      }
    };
  } catch (e) {
    throw new HttpError(401, "Invalid refresh token");
  }
}

export async function revokeSession(accessToken) {
  return { ok: true };
}

export async function getUserFromToken(token) {
  try {
    const decoded = jwt.verify(token, env.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { profile: true }
    });
    if (!user) throw new Error("User not found");
    return {
        id: user.id,
        email: user.email,
        user_metadata: {
            full_name: user.profile?.fullName,
            phone: user.profile?.phone
        }
    };
  } catch (e) {
    throw new HttpError(401, "Invalid token");
  }
}

export async function restRequest(token, path, options = {}) {
    const url = new URL(path, "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);
    const table = segments[0];
    const method = options.method || "GET";
    const body = options.body;
    const params = Object.fromEntries(url.searchParams.entries());

    if (table === "profiles") {
        if (method === "GET") {
            const id = params.id?.replace("eq.", "");
            if (id) return [await prisma.profile.findUnique({ where: { id } })];
            return await prisma.profile.findMany();
        }
        if (method === "PATCH") {
            const id = params.id?.replace("eq.", "");
            return [await prisma.profile.update({ where: { id }, data: body })];
        }
    }

    if (table === "user_roles") {
        if (method === "GET") {
            const userId = params.user_id?.replace("eq.", "");
            return (await prisma.userRole.findMany({ where: { userId } })).map(r => ({ role: r.role }));
        }
        if (method === "POST") {
            return [await prisma.userRole.create({ data: body })];
        }
    }

    if (table === "restaurants") {
        if (method === "GET") {
            const id = params.id?.replace("eq.", "");
            if (id) return [await prisma.restaurant.findUnique({ where: { id } })];
            return await prisma.restaurant.findMany({ orderBy: { createdAt: 'desc' } });
        }
    }

    if (table === "food_orders") {
        if (method === "GET") {
            const id = params.id?.replace("eq.", "");
            if (id) return [await prisma.foodOrder.findUnique({ where: { id }, include: { items: true } })];
            const customerId = params.customer_id?.replace("eq.", "");
            if (customerId) return await prisma.foodOrder.findMany({ where: { customerId }, orderBy: { createdAt: 'desc' } });
            return await prisma.foodOrder.findMany();
        }
        if (method === "POST") {
            return [await prisma.foodOrder.create({ data: body })];
        }
        if (method === "PATCH") {
             const id = params.id?.replace("eq.", "");
             return [await prisma.foodOrder.update({ where: { id }, data: body })];
        }
    }

    if (table === "platform_settings") {
        if (method === "GET") {
            const key = params.key?.replace("eq.", "");
            if (key) return [await prisma.platformSetting.findUnique({ where: { key } })];
            return await prisma.platformSetting.findMany();
        }
        if (method === "POST") {
            return [await prisma.platformSetting.upsert({
                where: { key: body.key },
                update: { value: body.value },
                create: { key: body.key, value: body.value }
            })];
        }
    }

    console.warn(`Shim: Unhandled restRequest: ${method} ${path}`);
    return [];
}

export async function serviceRoleRestRequest(path, options = {}) {
    return restRequest(null, path, options);
}
