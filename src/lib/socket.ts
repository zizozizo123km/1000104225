/**
 * Socket.io Client — Bac DZ AI
 * Connects to the signaling server for WebRTC
 *
 * Server runs on: cd server && npm install && node index.js
 */

import { io, Socket } from "socket.io-client";

// ─── Server URL ───────────────────────────────────────────────────────────────
// Development  → http://localhost:3001
// Production   → set VITE_SOCKET_URL in .env
const SOCKET_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_SOCKET_URL) ||
  "http://localhost:3001";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
    });

    socket.on("connect", () => {
      console.log("🟢 Socket.io connected:", socket?.id);
    });

    socket.on("disconnect", (reason) => {
      console.warn("🔴 Socket.io disconnected:", reason);
    });

    socket.on("connect_error", (err) => {
      console.warn("⚠️ Socket.io error:", err.message);
    });

    socket.on("reconnect", (attempt) => {
      console.log("🔄 Socket.io reconnected after", attempt, "attempts");
    });
  }

  if (!socket.connected) {
    socket.connect();
  }

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

export default getSocket;
