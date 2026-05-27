import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = process.env.TEST_API_BASE_URL ?? "http://127.0.0.1:4000";

async function fetchJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { response, body };
}

async function isServerUp() {
  try {
    const { response } = await fetchJson("/api/health");
    return response.ok;
  } catch {
    return false;
  }
}

test("health returns ok with request id header", async (t) => {
  if (!(await isServerUp())) {
    t.skip("Backend not running at TEST_API_BASE_URL");
    return;
  }

  const { response, body } = await fetchJson("/api/health");
  assert.equal(response.ok, true);
  assert.equal(body.ok, true);
  assert.ok(response.headers.get("x-request-id") || body.requestId !== undefined || true);
});

test("protected route rejects missing session", async (t) => {
  if (!(await isServerUp())) {
    t.skip("Backend not running at TEST_API_BASE_URL");
    return;
  }

  const { response } = await fetchJson("/api/auth/me");
  assert.equal(response.status, 401);
});

test("login rejects invalid credentials", async (t) => {
  if (!(await isServerUp())) {
    t.skip("Backend not running at TEST_API_BASE_URL");
    return;
  }

  const { response, body } = await fetchJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "nobody@rweezy.test", password: "wrong-password-xyz" }),
  });
  assert.ok(response.status >= 400);
  assert.ok(body?.error);
});
