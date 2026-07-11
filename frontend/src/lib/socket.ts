import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL || ""; // Empty string for same-origin

export const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
});

export default socket;
