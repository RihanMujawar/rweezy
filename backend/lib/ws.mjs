import { WebSocketServer } from "ws";
import url from "node:url";
import { getUserFromToken } from "./supabase.mjs";
import { parseCookies } from "./http.mjs";

const clients = new Map(); // ws client -> { user, subscriptions: Set<string> }

export function initWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", async (req, socket, head) => {
    try {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;

      if (pathname !== "/ws") {
        // Only handle WebSocket connections at /ws route
        return;
      }

      // 1. Resolve token from query param, cookies, or Sec-WebSocket-Protocol
      let token = parsedUrl.query?.token;

      if (!token) {
        const cookies = parseCookies(req);
        token = cookies["rweezy_access_token"];
      }

      if (!token) {
        const protocol = req.headers["sec-websocket-protocol"];
        if (protocol) {
          // Supports "Bearer, JWT" format or "Bearer_JWT" or standard JWT
          const parts = protocol.split(",").map((p) => p.trim());
          const bearerPart = parts.find((p) => p.toLowerCase().startsWith("bearer"));
          if (bearerPart) {
            token = bearerPart.split(" ")[1] || bearerPart.split("_")[1] || bearerPart;
          } else {
            token = parts[0];
          }
        }
      }

      if (!token) {
        console.warn("[WebSocket] Connection rejected: No authentication token found.");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // 2. Validate token (JWT verification)
      let user;
      try {
        user = await getUserFromToken(token);
      } catch (err) {
        console.warn("[WebSocket] Authentication failed: JWT invalid or expired.", err.message);
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      if (!user || !user.id) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      // 3. Complete Handshake & Upgrade connection
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, user);
      });
    } catch (err) {
      console.error("[WebSocket] Exception during connection upgrade:", err);
      try {
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      } catch {
        // ignore
      }
    }
  });

  wss.on("connection", (ws, req, user) => {
    console.log(`[WebSocket] User ${user.id} (${user.email || "phone-auth"}) connected successfully.`);

    const clientState = {
      user,
      subscriptions: new Set(),
      isAlive: true,
    };
    clients.set(ws, clientState);

    // Welcome handshake confirm
    ws.send(JSON.stringify({ type: "connected", userId: user.id }));

    ws.on("message", (message) => {
      try {
        const payload = JSON.parse(message.toString());

        if (payload.type === "subscribe" && payload.topic) {
          clientState.subscriptions.add(payload.topic);
          ws.send(JSON.stringify({ type: "subscribed", topic: payload.topic }));
        } else if (payload.type === "unsubscribe" && payload.topic) {
          clientState.subscriptions.delete(payload.topic);
          ws.send(JSON.stringify({ type: "unsubscribed", topic: payload.topic }));
        } else if (payload.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch (err) {
        console.error("[WebSocket] Message parse/processing failed:", err);
      }
    });

    ws.on("pong", () => {
      clientState.isAlive = true;
    });

    ws.on("close", () => {
      console.log(`[WebSocket] Connection closed for user ${user.id}`);
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error(`[WebSocket] Error for user ${user.id}:`, err);
      clients.delete(ws);
    });
  });

  // Heartbeat interval to prune stale/disconnected clients
  const interval = setInterval(() => {
    for (const [ws, state] of clients.entries()) {
      if (state.isAlive === false) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      state.isAlive = false;
      ws.ping();
    }
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });
}

/**
 * Broadcasts an update message to all connected clients that are subscribed to the specific topic.
 * @param {string} topic - The topic string (e.g. "chat:food:order-id")
 * @param {any} data - The payload to send
 */
export function broadcastUpdate(topic, data) {
  const payload = JSON.stringify({ type: "update", topic, data });
  let count = 0;

  for (const [ws, state] of clients.entries()) {
    if (ws.readyState === 1 && state.subscriptions.has(topic)) {
      ws.send(payload);
      count++;
    }
  }

  if (count > 0) {
    console.log(`[WebSocket] Broadcasted update to topic "${topic}" to ${count} active subscriber(s).`);
  }
}
