import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-context";

type WebSocketContextType = {
  subscribe: (topic: string, callback: (data: any) => void) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const subscriptionsRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const activeSubscriptionsRef = useRef<Set<string>>(new Set());

  // Function to resolve WebSocket URL
  const getWsUrl = (token: string) => {
    const isHttps = window.location.protocol === "https:";
    const wsProtocol = isHttps ? "wss:" : "ws:";
    const host = window.location.host;
    return `${wsProtocol}//${host}/ws?token=${encodeURIComponent(token)}`;
  };

  // Connect function
  const connect = () => {
    if (socketRef.current || reconnectTimeoutRef.current) return;

    // Retrieve JWT from supabase client session or cookies
    // Since cookie Secure option is on and httpOnly is false/local session exists:
    // supabase auth session can provide the current access token
    const token = typeof window !== "undefined" ? localStorage.getItem("sb-yzzbvlwwpegnelthklkz-auth-token") : null;
    let jwtToken = "";
    if (token) {
      try {
        const parsed = JSON.parse(token);
        jwtToken = parsed?.access_token || "";
      } catch {
        // ignore
      }
    }

    if (!jwtToken) {
      // If no token in local storage, try fetching from cookies
      const match = document.cookie.match(/(^|;)\s*rweezy_access_token\s*=\s*([^;]+)/);
      jwtToken = match ? decodeURIComponent(match[2]) : "";
    }

    if (!jwtToken) {
      // Cannot connect without token (never allow anonymous sockets)
      console.warn("[WebSocket] No access token found. Postponing WebSocket connection.");
      // Retry in 3 seconds to see if token is available
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, 3000);
      return;
    }

    console.log("[WebSocket] Connecting to backend server...");
    const ws = new WebSocket(getWsUrl(jwtToken));
    socketRef.current = ws;

    ws.onopen = () => {
      console.log("[WebSocket] Connection established successfully.");
      setIsConnected(true);

      // Resubscribe to all active topics on reconnection
      activeSubscriptionsRef.current.forEach((topic) => {
        ws.send(JSON.stringify({ type: "subscribe", topic }));
      });
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);

        if (payload.type === "update" && payload.topic) {
          const callbacks = subscriptionsRef.current.get(payload.topic);
          if (callbacks) {
            callbacks.forEach((cb) => {
              try {
                cb(payload.data);
              } catch (err) {
                console.error("[WebSocket] Callback execution failed:", err);
              }
            });
          }
        }
      } catch (err) {
        console.error("[WebSocket] Failed to parse message:", err);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WebSocket] Connection closed. Code: ${event.code}. Reconnecting in 3s...`);
      socketRef.current = null;
      setIsConnected(false);

      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        connect();
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error("[WebSocket] Connection error:", err);
      ws.close();
    };
  };

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
  };

  // Handle connection life-cycle based on user auth status
  useEffect(() => {
    if (user) {
      connect();
    } else {
      disconnect();
    }
    return () => disconnect();
  }, [user]);

  // Subscribe/unsubscribe logic
  const subscribe = (topic: string, callback: (data: any) => void) => {
    if (!subscriptionsRef.current.has(topic)) {
      subscriptionsRef.current.set(topic, new Set());
    }

    const set = subscriptionsRef.current.get(topic)!;
    set.add(callback);

    // If this is the first subscription to this topic, send subscription message to WS server
    if (set.size === 1) {
      activeSubscriptionsRef.current.add(topic);
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "subscribe", topic }));
      }
    }

    // Return unsubscribe cleanup function
    return () => {
      const callbacks = subscriptionsRef.current.get(topic);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          subscriptionsRef.current.delete(topic);
          activeSubscriptionsRef.current.delete(topic);
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "unsubscribe", topic }));
          }
        }
      }
    };
  };

  return (
    <WebSocketContext.Provider value={{ subscribe, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  );
}
