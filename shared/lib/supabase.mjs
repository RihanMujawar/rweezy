import { env } from "./env.mjs";
import { HttpError } from "./http.mjs";

function buildHeaders(extraHeaders = {}, token) {
  return {
    apikey: env.supabasePublishableKey,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders,
  };
}

function buildAdminHeaders(extraHeaders = {}) {
  return {
    apikey: env.supabaseServiceRoleKey,
    Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
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
  if (payload.error_code === "over_email_send_rate_limit") {
    return "Email signup is temporarily rate limited. Please wait a few minutes and try again.";
  }
  if (payload.message) return payload.message;
  if (payload.msg) return payload.msg;
  if (payload.error_description) return payload.error_description;
  if (payload.error) return payload.error;
  return fallback;
}

function isNetworkError(error) {
  return error instanceof TypeError || error?.name === "AbortError" || error?.name === "TimeoutError";
}

async function supabaseFetch(url, options = {}) {
  const method = options.method ?? "GET";
  const maxAttempts = method === "GET" || method === "HEAD" ? 2 : 1;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error) || attempt === maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const causeCode = lastError?.cause?.code;
  const timedOut = lastError?.name === "TimeoutError" || causeCode === "UND_ERR_CONNECT_TIMEOUT";
  throw new HttpError(
    504,
    timedOut
      ? "Supabase connection timed out. Check your internet connection or Supabase project availability."
      : "Unable to connect to Supabase. Check your internet connection or Supabase project URL.",
  );
}

async function authRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    token,
  } = options;

  const response = await supabaseFetch(`${env.supabaseUrl}/auth/v1${path}`, {
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
    const fallback = response.status === 429
      ? "Too many signup attempts. Please wait a few minutes and try again."
      : `Supabase auth request failed: ${method} ${path}`;
    throw new HttpError(response.status, errorMessage(payload, fallback));
  }

  return payload;
}

async function adminAuthRequest(path, options = {}) {
  if (!env.supabaseServiceRoleKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add your Supabase service_role key to backend .env and restart the server.",
    );
  }

  const {
    method = "GET",
    body,
  } = options;

  const response = await supabaseFetch(`${env.supabaseUrl}/auth/v1/admin${path}`, {
    method,
    headers: buildAdminHeaders({
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(payload, `Supabase admin request failed: ${method} ${path}`));
  }

  return payload;
}

export async function signInWithPassword(identifier, password) {
  const value = typeof identifier === "string" ? { email: identifier } : identifier;
  return authRequest("/token?grant_type=password", {
    method: "POST",
    body: {
      ...value,
      password,
    },
  });
}

export async function signUpWithPassword(email, password, fullName, metadata = {}) {
  return authRequest("/signup", {
    method: "POST",
    body: {
      email,
      password,
      data: {
        full_name: fullName,
        ...metadata,
      },
    },
  });
}

export async function createConfirmedUserWithPassword(email, password, fullName, metadata = {}) {
  return adminAuthRequest("/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        ...metadata,
      },
    },
  });
}

export async function createSessionForEmail(email) {
  const link = await adminAuthRequest("/generate_link", {
    method: "POST",
    body: {
      type: "magiclink",
      email,
    },
  });

  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!tokenHash) {
    throw new HttpError(500, "Unable to start a phone login session");
  }

  return authRequest("/verify", {
    method: "POST",
    body: {
      type: "magiclink",
      token_hash: tokenHash,
    },
  });
}

export async function resendSignupConfirmation(email) {
  return authRequest("/resend", {
    method: "POST",
    body: {
      type: "signup",
      email,
    },
  });
}

export async function sendPasswordRecoveryEmail(email) {
  return authRequest("/recover", {
    method: "POST",
    body: { email },
  });
}

export async function verifyRecoveryToken(tokenHash) {
  return authRequest("/verify", {
    method: "POST",
    body: {
      type: "recovery",
      token_hash: tokenHash,
    },
  });
}

export async function updatePasswordWithAccessToken(accessToken, password) {
  return authRequest("/user", {
    method: "PUT",
    token: accessToken,
    body: { password },
  });
}

export async function updateUserPassword(userId, password) {
  return adminAuthRequest(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: { password },
  });
}

export async function findUserByEmail(email) {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalizedEmail) return null;

  for (let page = 1; page <= 10; page += 1) {
    const payload = await adminAuthRequest(`/users?page=${page}&per_page=100`);
    const users = Array.isArray(payload?.users) ? payload.users : [];

    const found = users.find((user) => {
      const userEmail = typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
      return userEmail === normalizedEmail;
    });

    if (found) return found;
    if (users.length < 100) break;
  }

  return null;
}

export async function findUserEmailByPhone(phone) {
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  if (!normalizedPhone) return null;

  for (let page = 1; page <= 10; page += 1) {
    const payload = await adminAuthRequest(`/users?page=${page}&per_page=100`);
    const users = Array.isArray(payload?.users) ? payload.users : [];

    const found = users.find((user) => {
      const metadataPhone = typeof user?.user_metadata?.phone === "string"
        ? user.user_metadata.phone.trim()
        : "";
      const authPhone = typeof user?.phone === "string" ? user.phone.trim() : "";
      return metadataPhone === normalizedPhone || authPhone === normalizedPhone;
    });

    if (found?.email) return found.email;
    if (users.length < 100) break;
  }

  return null;
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
  const response = await supabaseFetch(`${env.supabaseUrl}/auth/v1/user`, {
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

  const response = await supabaseFetch(`${env.supabaseUrl}/rest/v1${path}`, {
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

export async function serviceRoleRestRequest(path, options = {}) {
  if (!env.supabaseServiceRoleKey) {
    throw new HttpError(
      500,
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add your Supabase service_role key to backend .env and restart the server.",
    );
  }

  const {
    method = "GET",
    body,
    headers = {},
  } = options;

  const response = await supabaseFetch(`${env.supabaseUrl}/rest/v1${path}`, {
    method,
    headers: buildAdminHeaders({
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new HttpError(response.status, errorMessage(payload, `Supabase service request failed: ${method} ${path}`));
  }

  return payload;
}
