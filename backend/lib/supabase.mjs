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
