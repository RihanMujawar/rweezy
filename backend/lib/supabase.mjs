import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

function buildHeaders(extraHeaders = {}, token) {
  return {
    apikey: env.supabasePublishableKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

async function parseResponse(response) {
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text);
  }

  return text;
}

function errorMessage(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === "string") return payload;
  if (payload.message) return payload.message;
  if (payload.error_description) return payload.error_description;
  if (payload.error) return payload.error;
  return fallback;
}

async function authRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    token,
  } = options;

  const response = await fetch(`${env.supabaseUrl}/auth/v1${path}`, {
    method,
    headers: buildHeaders(
      {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      token,
    ),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(payload, `Supabase auth request failed: ${method} ${path}`));
  }

  return payload;
}

export async function signInWithPassword(email, password) {
  return authRequest("/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

export async function signUpWithPassword(email, password, fullName) {
  return authRequest("/signup", {
    method: "POST",
    body: {
      email,
      password,
      data: {
        full_name: fullName,
      },
    },
  });
}

export async function refreshAuthSession(refreshToken) {
  return authRequest("/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export async function revokeSession(accessToken) {
  try {
    await authRequest("/logout", {
      method: "POST",
      token: accessToken,
    });
  } catch {
    // Ignore revoke failures and clear the local cookies anyway.
  }
}

export async function getUserFromToken(token) {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: buildHeaders({}, token),
  });

  const payload = await parseResponse(response);

  if (!response.ok || !payload?.id) {
    throw new HttpError(401, errorMessage(payload, "Invalid or expired session"));
  }

  return payload;
}

export async function restRequest(token, path, options = {}) {
  const {
    method = "GET",
    body,
    headers = {},
  } = options;

  const response = await fetch(`${env.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: buildHeaders({
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    }, token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(payload, `Supabase request failed: ${method} ${path}`));
  }

  return payload;
}
