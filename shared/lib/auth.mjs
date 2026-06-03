import {
  getUserFromToken,
  refreshAuthSession,
  restRequest
} from "./supabase.mjs";
import {
  HttpError,
  getBearerToken,
  serializeCookie
} from "./http.mjs";
import { env } from "./env.mjs";

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
  if (!session.accessToken || !session.refreshToken) return [];
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

export async function getRoles(token, userId) {
  const rows = await restRequest(
    token,
    `/user_roles?select=role&user_id=eq.${userId}`
  );
  return (rows ?? []).map((row) => row.role);
}

export async function authenticate(req, res, next) {
  try {
    const bearerToken = getBearerToken(req);
    let accessToken = bearerToken || req.cookies?.[ACCESS_COOKIE];
    const refreshToken = req.cookies?.[REFRESH_COOKIE];

    if (!accessToken && !refreshToken) {
      throw new HttpError(401, "Please sign in to continue");
    }

    try {
      if (!accessToken) throw new HttpError(401, "Missing access token");
      const user = await getUserFromToken(accessToken);
      req.token = accessToken;
      req.user = user;
      next();
    } catch (error) {
      if (!refreshToken) throw error;
      try {
        const refreshed = await refreshAuthSession(refreshToken);
        const session = normalizeAuthSession(refreshed);
        if (!session.accessToken || !session.user) {
          throw new HttpError(401, "Please sign in to continue");
        }
        const cookies = buildSessionCookies(refreshed);
        cookies.forEach(c => res.append("Set-Cookie", c));
        req.token = session.accessToken;
        req.user = session.user;
        next();
      } catch {
        throw new HttpError(401, "Please sign in to continue");
      }
    }
  } catch (error) {
    next(error);
  }
}
