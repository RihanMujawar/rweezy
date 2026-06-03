import http from "node:http";
import httpProxy from "http-proxy";
import { env } from "../../shared/lib/env.mjs";
import { getCorsHeaders } from "../../shared/lib/http.mjs";

const proxy = httpProxy.createProxyServer({});

const SERVICES = {
  auth: "http://auth-service:3001",
  food: "http://food-service:3002",
  grocery: "http://grocery-service:3003",
  ride: "http://ride-service:3004",
  package: "http://package-service:3005",
  chat: "http://chat-service:3006",
  notification: "http://notification-service:3007",
};

function resolveCorsOrigin(requestOrigin) {
  if (env.corsAllowAll) return requestOrigin || "*";
  if (requestOrigin && env.corsAllowedOrigins.includes(requestOrigin)) return requestOrigin;
  return "null";
}

function corsHeadersForRequest(req) {
  const resolvedOrigin = resolveCorsOrigin(req.headers.origin);
  const allowCredentials = resolvedOrigin !== "*" && resolvedOrigin !== "null";
  return getCorsHeaders(resolvedOrigin, allowCredentials);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const corsHeaders = corsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }

  let target;
  const path = url.pathname;

  if (path.startsWith("/api/auth") || path.startsWith("/api/profile") || path.startsWith("/api/role-requests") || path.startsWith("/api/admin/users") || path.startsWith("/api/admin/stats") || path.startsWith("/api/admin/health")) {
    target = SERVICES.auth;
  } else if (path.startsWith("/api/catalog/restaurants") || path.startsWith("/api/catalog/items/food") || path.startsWith("/api/orders/food") || path.startsWith("/api/hotel") || path.startsWith("/api/admin/restaurants")) {
    target = SERVICES.food;
  } else if (path.startsWith("/api/catalog/stores") || path.startsWith("/api/catalog/items/grocery") || path.startsWith("/api/orders/grocery") || path.startsWith("/api/grocery") || path.startsWith("/api/admin/stores")) {
    target = SERVICES.grocery;
  } else if (path.startsWith("/api/rides") || path.startsWith("/api/track/ride") || path.startsWith("/api/rider/rides")) {
    target = SERVICES.ride;
  } else if (path.startsWith("/api/packages") || path.startsWith("/api/track/package") || path.startsWith("/api/rider/packages")) {
    target = SERVICES.package;
  } else if (path.startsWith("/api/chat")) {
    target = SERVICES.chat;
  } else if (path.startsWith("/api/notifications") || path.startsWith("/api/admin/notifications")) {
    target = SERVICES.notification;
  } else if (path.startsWith("/api/delivery")) {
      // Shared delivery boy routes might need better handling
      target = SERVICES.food;
  } else if (path.startsWith("/api/admin/analytics") || path.startsWith("/api/admin/commissions") || path.startsWith("/api/admin/catalog-settings")) {
      target = SERVICES.auth; // Defaulting for general admin
  }

  if (target) {
    proxy.web(req, res, { target }, (e) => {
      console.error(`Proxy error: ${e.message}`);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end("Bad Gateway");
      }
    });
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

const PORT = 3000;
server.listen(PORT, () => console.log(`API Gateway listening on port ${PORT}`));
