import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.mjs";
import {
  HttpError,
  serializeCookie
} from "./http.mjs";
import { env } from "./env.mjs";

const ACCESS_COOKIE = "rweezy_access_token";
const REFRESH_COOKIE = "rweezy_refresh_token";

const JWT_SECRET = env.jwtSecret || "rweezy-secret-key-123";
const REFRESH_SECRET = env.refreshSecret || "rweezy-refresh-key-123";

export function generateAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

export function generateRefreshToken(user) {
  return jwt.sign(
    {
      id: user.id
    },
    REFRESH_SECRET,
    { expiresIn: "30d" }
  );
}

export function buildSessionCookies(accessToken, refreshToken) {
  return [
    serializeCookie(ACCESS_COOKIE, accessToken, {
      maxAge: 3600,
      path: "/",
      sameSite: "Lax",
      secure: env.cookieSecure,
    }),
    serializeCookie(REFRESH_COOKIE, refreshToken, {
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

export async function getRoles(userId) {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    select: { role: true }
  });
  return roles.map((r) => r.role);
}

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      token = req.cookies?.[ACCESS_COOKIE];
    }

    if (!token) {
      const refreshToken = req.cookies?.[REFRESH_COOKIE];
      if (!refreshToken) {
        throw new HttpError(401, "Please sign in to continue");
      }

      try {
        const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
          include: { profile: true }
        });

        if (!user) throw new HttpError(401, "User not found");

        const newAccessToken = generateAccessToken(user);
        const cookies = buildSessionCookies(newAccessToken, refreshToken);
        cookies.forEach(c => res.append("Set-Cookie", c));

        req.token = newAccessToken;
        req.user = user;
        return next();
      } catch (err) {
        throw new HttpError(401, "Session expired. Please sign in again.");
      }
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: { profile: true }
      });

      if (!user) throw new HttpError(401, "User not found");

      // Remove sensitive data
      delete user.passwordHash;

      req.token = token;
      req.user = user;
      next();
    } catch (err) {
      if (err.name === "TokenExpiredError") {
         // Try refresh logic if token expired
         const refreshToken = req.cookies?.[REFRESH_COOKIE];
         if (refreshToken) {
            try {
                const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
                const user = await prisma.user.findUnique({
                  where: { id: decoded.id },
                  include: { profile: true }
                });
                if (user) {
                    const newAccessToken = generateAccessToken(user);
                    const cookies = buildSessionCookies(newAccessToken, refreshToken);
                    cookies.forEach(c => res.append("Set-Cookie", c));
                    req.token = newAccessToken;
                    req.user = user;
                    return next();
                }
            } catch (e) {}
         }
      }
      throw new HttpError(401, "Invalid or expired token");
    }
  } catch (error) {
    next(error);
  }
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}
