class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string = "";
  private listeners: Map<string, Set<Function>> = new Map();
  private reconnectTimeout: number = 2000;
  private maxReconnectTimeout: number = 30000;
  private currentReconnectTimeout: number = 2000;
  private offlineQueue: string[] = [];
  private joinedRooms: Set<string> = new Set();
  public connected: boolean = false;
  private heartbeatInterval: number | null = null;

  constructor() {
    this.connect();
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        if (!this.connected) {
          this.connect();
        }
      });
    }
  }

  private getSocketUrl(): string {
    const getCookie = (name: string): string | null => {
      if (typeof document === "undefined") return null;
      const nameEQ = name + "=";
      const ca = document.cookie.split(";");
      for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === " ") c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
      }
      return null;
    };

    const apiUrl = import.meta.env.VITE_API_URL || "";
    let base = "";
    if (apiUrl) {
      base = apiUrl.replace(/^http/, "ws");
    } else {
      const loc = window.location;
      const proto = loc.protocol === "https:" ? "wss" : "ws";
      base = `${proto}://${loc.host}`;
    }
    const token = getCookie("rweezy_access_token") || "";
    return `${base}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      this.url = this.getSocketUrl();
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.connected = true;
        this.currentReconnectTimeout = this.reconnectTimeout;
        this.trigger("connect", null);

        // Rejoin rooms on reconnection
        this.joinedRooms.forEach((room) => {
          this.ws?.send(JSON.stringify({ type: "join", room }));
        });

        // Flush offline message queue
        while (this.offlineQueue.length > 0) {
          const msg = this.offlineQueue.shift();
          if (msg) this.ws.send(msg);
        }

        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message && typeof message === "object") {
            const { type, room, payload } = message;

            // Trigger specific event name (like "order_updated", "chat_message", "notification", etc.)
            this.trigger(type, payload);

            // Trigger events with room context if present
            if (room) {
              this.trigger(`${type}:${room}`, payload);
            }

            // Also trigger global event
            this.trigger("message", message);
          }
        } catch (e) {
          // Ignore
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch (e) {
      this.handleDisconnect();
    }
  }

  private handleDisconnect() {
    this.connected = false;
    this.trigger("disconnect", null);
    this.stopHeartbeat();

    setTimeout(() => {
      this.connect();
      this.currentReconnectTimeout = Math.min(this.currentReconnectTimeout * 1.5, this.maxReconnectTimeout);
    }, this.currentReconnectTimeout);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = window.setInterval(() => {
      this.emit("heartbeat", {});
    }, 25000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
  }

  public off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback);
  }

  private trigger(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch (e) {
        console.error(`Error in socket listener for ${event}:`, e);
      }
    });
  }

  public emit(event: string, ...args: any[]) {
    if (event === "join_order") {
      const orderId = args[0];
      this.joinedRooms.add(orderId);
      this.send({ type: "join", room: orderId });
      return;
    }

    const payload = args[0] || {};
    const room = args[1];
    this.send({ type: event, room, payload });
  }

  public send(message: any) {
    const raw = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else {
      this.offlineQueue.push(raw);
    }
  }

  public join(room: string) {
    this.joinedRooms.add(room);
    this.send({ type: "join", room });
  }

  public leave(room: string) {
    this.joinedRooms.delete(room);
    this.send({ type: "leave", room });
  }
}

export const socket = new WebSocketClient();
export default socket;
