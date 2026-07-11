import { WebSocketServer, WebSocket } from "ws";
import { parseCookies } from "./http.mjs";
import { verifyToken } from "./auth.mjs";
import { prisma } from "./prisma.mjs";
import { env } from "./env.mjs";
import { logEvent } from "./logger.mjs";

const ACCESS_COOKIE = "rweezy_access_token";

// Connection IP and Socket tracking
const activeConnections = new Map(); // ws -> { userId, roles, ip, lastActivity, joinedRooms: Set }
const ipConnectionsCount = new Map(); // ip -> count
const roomClients = new Map(); // roomName -> Set of ws

// Message rate limiting configs: max 30 messages per 10 seconds per connection
const RATE_LIMIT_WINDOW_MS = 10000;
const RATE_LIMIT_MAX_MESSAGES = 30;
const messageTimestamps = new Map(); // ws -> Array of timestamps

// Max message size in bytes (32 KB)
const MAX_MESSAGE_SIZE = 32 * 1024;

/**
 * Sanitize string values to reduce stored XSS risks
 */
function sanitizeString(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload.map(item => sanitizePayload(item));
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string") {
      sanitized[key] = sanitizeString(value);
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizePayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Check if the user has database access to a specific order ID or room.
 */
async function checkOrderAccess(userId, roles, id) {
  if (roles.includes("admin")) return true;

  try {
    const [food, grocery, ride, pkg] = await Promise.all([
      prisma.foodOrder.findUnique({
        where: { id },
        include: { restaurant: { select: { manager_id: true } } },
      }).catch(() => null),
      prisma.groceryOrder.findUnique({
        where: { id },
        include: { store: { select: { manager_id: true } } },
      }).catch(() => null),
      prisma.ride.findUnique({ where: { id } }).catch(() => null),
      prisma.packageDelivery.findUnique({ where: { id } }).catch(() => null),
    ]);

    if (food) {
      return food.customer_id === userId ||
             food.delivery_boy_id === userId ||
             food.restaurant?.manager_id === userId;
    }
    if (grocery) {
      return grocery.customer_id === userId ||
             grocery.delivery_boy_id === userId ||
             grocery.store?.manager_id === userId;
    }
    if (ride) {
      return ride.customer_id === userId || ride.rider_id === userId;
    }
    if (pkg) {
      return pkg.customer_id === userId || pkg.rider_id === userId;
    }
  } catch (error) {
    logEvent("error", "room_auth_query_failed", { error: error.message, id });
  }

  return false;
}

/**
 * Server-side room validation. Ensures clients can't subscribe to arbitrary rooms.
 */
async function validateRoomAccess(user, roles, room) {
  if (!room || typeof room !== "string") return false;

  // Global room and self notification room
  if (room === "global" || room === "notifications") {
    return true;
  }

  // Personal user room: "user:<userId>"
  if (room.startsWith("user:")) {
    const targetUserId = room.slice(5);
    return user.id === targetUserId;
  }

  // Role room: "role:<roleName>"
  if (room.startsWith("role:")) {
    const roleName = room.slice(5);
    return roles.includes(roleName);
  }

  // Check if room format is "order:<id>", "chat:<id>", or raw order ID (36 char uuid)
  let targetId = room;
  if (room.startsWith("order:")) {
    targetId = room.slice(6);
  } else if (room.startsWith("chat:")) {
    targetId = room.slice(5);
  }

  // Validate UUID structure
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(targetId)) {
    return await checkOrderAccess(user.id, roles, targetId);
  }

  return false;
}

/**
 * Handle origin validation for websocket handshakes.
 */
function isValidOrigin(originHeader) {
  if (env.corsAllowAll) return true;
  if (!originHeader) return false;

  try {
    const originUrl = new URL(originHeader);
    const origin = originUrl.origin;
    if (env.corsAllowedOrigins.includes(origin) || origin === env.frontendDevUrl) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

let wss = null;

export function initWebSocketServer(server) {
  wss = new WebSocketServer({ noServer: true });

  // Handle upgrade manually for JWT Handshake Auth, CORS verification, and IP limits
  server.on("upgrade", async (req, socket, head) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

    // 1. Origin check
    const origin = req.headers.origin;
    if (!isValidOrigin(origin)) {
      logEvent("warn", "ws_rejected_invalid_origin", { origin, ip });
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // 2. IP concurrent connection limits (Max 15 per IP)
    const currentIpConnections = ipConnectionsCount.get(ip) || 0;
    if (currentIpConnections >= 15) {
      logEvent("warn", "ws_rejected_ip_limit_exceeded", { ip });
      socket.write("HTTP/1.1 429 Too Many Connections\r\n\r\n");
      socket.destroy();
      return;
    }

    // 3. JWT Handshake Authentication
    let token = null;
    const cookies = parseCookies(req);
    if (cookies[ACCESS_COOKIE]) {
      token = cookies[ACCESS_COOKIE];
    } else {
      // Allow passing token in URL query parameter as fallback (?token=...)
      try {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        token = url.searchParams.get("token");
      } catch {
        token = null;
      }
    }

    if (!token) {
      logEvent("warn", "ws_rejected_missing_token", { ip });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      logEvent("warn", "ws_rejected_invalid_token", { ip });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Load roles
    let roles = [];
    try {
      const userRoles = await prisma.userRole.findMany({
        where: { user_id: decoded.id },
        select: { role: true },
      });
      roles = userRoles.map(r => r.role);
    } catch (err) {
      logEvent("error", "ws_roles_fetch_failed", { error: err.message, userId: decoded.id });
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, decoded, roles, ip);
    });
  });

  wss.on("connection", (ws, req, user, roles, ip) => {
    // Register active connection
    activeConnections.set(ws, {
      userId: user.id,
      roles,
      ip,
      lastActivity: Date.now(),
      joinedRooms: new Set(),
      isAlive: true,
    });

    // Update IP connection counts
    ipConnectionsCount.set(ip, (ipConnectionsCount.get(ip) || 0) + 1);

    logEvent("info", "ws_connected", { userId: user.id, roles, ip });

    // Send connection acknowledgement
    sendToSocket(ws, "connected", { userId: user.id, roles });

    // Handle heartbeat pongs
    ws.on("pong", () => {
      const conn = activeConnections.get(ws);
      if (conn) conn.isAlive = true;
    });

    // Handle messages
    ws.on("message", async (rawData) => {
      const conn = activeConnections.get(ws);
      if (!conn) return;

      conn.lastActivity = Date.now();

      // 1. Message size check
      if (rawData.length > MAX_MESSAGE_SIZE) {
        logEvent("warn", "ws_message_size_exceeded", { userId: conn.userId, ip });
        sendToSocket(ws, "error", { message: "Message payload size exceeds limit" });
        return;
      }

      // 2. Connection rate limiting (Max 30 messages per 10s)
      const now = Date.now();
      let timestamps = messageTimestamps.get(ws) || [];
      timestamps = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
      timestamps.push(now);
      messageTimestamps.set(ws, timestamps);

      if (timestamps.length > RATE_LIMIT_MAX_MESSAGES) {
        logEvent("warn", "ws_rate_limit_exceeded", { userId: conn.userId, ip });
        sendToSocket(ws, "error", { message: "Too many messages. Slow down." });
        return;
      }

      // 3. Strict JSON & validation
      let message;
      try {
        message = JSON.parse(rawData.toString());
      } catch {
        sendToSocket(ws, "error", { message: "Invalid JSON format" });
        return;
      }

      if (!message || typeof message !== "object") {
        sendToSocket(ws, "error", { message: "Message must be a valid JSON object" });
        return;
      }

      const { type, room, payload } = message;

      if (!type || typeof type !== "string") {
        sendToSocket(ws, "error", { message: "Missing or invalid message type" });
        return;
      }

      // 4. Handle Join room
      if (type === "join") {
        if (!room || typeof room !== "string") {
          sendToSocket(ws, "error", { message: "Room name is required for joining" });
          return;
        }

        const allowed = await validateRoomAccess(user, roles, room);
        if (!allowed) {
          logEvent("warn", "ws_join_room_denied", { userId: conn.userId, room });
          sendToSocket(ws, "error", { message: `Access denied to room: ${room}` });
          return;
        }

        conn.joinedRooms.add(room);
        if (!roomClients.has(room)) {
          roomClients.set(room, new Set());
        }
        roomClients.get(room).add(ws);

        logEvent("info", "ws_joined_room", { userId: conn.userId, room });
        sendToSocket(ws, "joined", { room });
        return;
      }

      // 5. Handle Leave room
      if (type === "leave") {
        if (!room || typeof room !== "string") {
          sendToSocket(ws, "error", { message: "Room name is required for leaving" });
          return;
        }

        conn.joinedRooms.delete(room);
        if (roomClients.has(room)) {
          roomClients.get(room).delete(ws);
          if (roomClients.get(room).size === 0) {
            roomClients.delete(room);
          }
        }

        logEvent("info", "ws_left_room", { userId: conn.userId, room });
        sendToSocket(ws, "left", { room });
        return;
      }

      // 6. Handle Typing indicators & client-originated typing events
      if (type === "typing") {
        if (!room || typeof room !== "string") {
          sendToSocket(ws, "error", { message: "Room name is required for typing status" });
          return;
        }

        if (!conn.joinedRooms.has(room)) {
          sendToSocket(ws, "error", { message: "Must join the room before broadcasting typing indicators" });
          return;
        }

        const sanitizedPayload = sanitizePayload(payload);
        broadcastToRoom(room, "typing", {
          room,
          senderId: conn.userId,
          isTyping: !!sanitizedPayload?.isTyping,
        }, ws); // exclude sender
        return;
      }

      // 7. Handle Heartbeat ping
      if (type === "heartbeat") {
        sendToSocket(ws, "heartbeat_ack");
        return;
      }

      // Any other custom message handling...
      sendToSocket(ws, "error", { message: `Unhandled event type: ${type}` });
    });

    ws.on("close", () => {
      cleanupConnection(ws);
    });

    ws.on("error", (err) => {
      logEvent("error", "ws_socket_error", { userId: user.id, error: err.message });
      cleanupConnection(ws);
    });
  });

  // Start ping/pong heartbeat interval (every 30 seconds)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const conn = activeConnections.get(ws);
      if (!conn) return;

      if (conn.isAlive === false) {
        logEvent("info", "ws_connection_terminated_dead", { userId: conn.userId });
        ws.terminate();
        cleanupConnection(ws);
        return;
      }

      conn.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });
}

function sendToSocket(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type,
      payload: sanitizePayload(payload)
    }));
  }
}

function cleanupConnection(ws) {
  const conn = activeConnections.get(ws);
  if (!conn) return;

  logEvent("info", "ws_closed", { userId: conn.userId, ip: conn.ip });

  // Remove from all joined rooms
  for (const room of conn.joinedRooms) {
    if (roomClients.has(room)) {
      roomClients.get(room).delete(ws);
      if (roomClients.get(room).size === 0) {
        roomClients.delete(room);
      }
    }
  }

  // Update IP counts
  const ipCount = ipConnectionsCount.get(conn.ip) || 1;
  if (ipCount <= 1) {
    ipConnectionsCount.delete(conn.ip);
  } else {
    ipConnectionsCount.set(conn.ip, ipCount - 1);
  }

  activeConnections.delete(ws);
  messageTimestamps.delete(ws);
}

/**
 * Broadcast event to all clients in a room
 * @param {string} room Room name
 * @param {string} type Event type/name
 * @param {object} payload Message payload
 * @param {WebSocket} excludeSocket Option to exclude a specific socket (e.g. sender)
 */
export function broadcastToRoom(room, type, payload = {}, excludeSocket = null) {
  const clients = roomClients.get(room);
  if (!clients) return;

  const serialized = JSON.stringify({
    type,
    room,
    payload: sanitizePayload(payload),
  });

  for (const client of clients) {
    if (client === excludeSocket) continue;
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  }
}

/**
 * Broadcast to a specific authenticated user on all their connections
 */
export function broadcastToUser(userId, type, payload = {}) {
  // Try sending to the personal user room "user:<userId>" first
  const userRoom = `user:${userId}`;
  broadcastToRoom(userRoom, type, payload);

  // Fallback / legacy fallback scan active connections
  for (const [ws, conn] of activeConnections.entries()) {
    if (conn.userId === userId) {
      sendToSocket(ws, type, payload);
    }
  }
}

/**
 * Broadcast to all connections with a specific role
 */
export function broadcastToRole(role, type, payload = {}) {
  // Try sending to role room "role:<role>"
  const roleRoom = `role:${role}`;
  broadcastToRoom(roleRoom, type, payload);

  // Fallback scan active connections
  for (const [ws, conn] of activeConnections.entries()) {
    if (conn.roles.includes(role)) {
      sendToSocket(ws, type, payload);
    }
  }
}
