/**
 * Bac DZ AI — Socket.io Signaling Server
 * ─────────────────────────────────────
 * cd server
 * npm init -y
 * npm install socket.io
 * node index.js
 */

const { createServer } = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3001;

const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      rooms: Object.keys(rooms).length,
      connections: Object.keys(socketMeta).length,
      uptime: process.uptime(),
    }));
    return;
  }
  res.writeHead(200);
  res.end("Bac DZ AI — Socket.io Signaling Server 🚀");
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── State ────────────────────────────────────────────────────────────────────
// rooms[roomId] = { id, name, subject, hostId, hostName, code, maxSeats, seats:{}, viewers:{}, chat:[] }
const rooms = {};
// socketId → { userId, userName, roomId, role }
const socketMeta = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function broadcastRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  io.to(roomId).emit("room-state", {
    seats: room.seats,
    viewers: room.viewers,
    seatCount: Object.keys(room.seats).length,
    viewerCount: Object.keys(room.viewers).length,
  });
}

function handleLeave(socket, roomId, userId) {
  const room = rooms[roomId];
  if (!room) return;

  const wasParticipant = !!room.seats[userId];
  const wasViewer      = !!room.viewers[userId];

  delete room.seats[userId];
  delete room.viewers[userId];

  socket.leave(roomId);
  socket.to(roomId).emit("user-left", { userId });

  broadcastRoomState(roomId);

  const totalLeft =
    Object.keys(room.seats).length + Object.keys(room.viewers).length;

  // Auto-delete empty room when host leaves
  if (room.hostId === userId && totalLeft === 0) {
    io.to(roomId).emit("room-deleted", { roomId });
    delete rooms[roomId];
    console.log(`🗑️  Room auto-deleted (host left): ${roomId}`);
    return;
  }

  if (wasParticipant) console.log(`👋 ${userId} left room ${roomId}`);
  if (wasViewer)      console.log(`👁️  Viewer ${userId} left room ${roomId}`);
}

// ─── Connection ───────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`✅ Connected: ${socket.id}`);

  // ── Create Room ──────────────────────────────────────────────────────────
  socket.on("create-room", ({ roomId, roomName, subject, hostId, hostName, code, maxSeats }) => {
    rooms[roomId] = {
      id:        roomId,
      name:      roomName,
      subject:   subject || "",
      hostId,
      hostName,
      code:      code.toUpperCase(),
      maxSeats:  maxSeats || 10,
      seats:     {},
      viewers:   {},
      chat:      [],
      createdAt: Date.now(),
    };
    console.log(`🏠 Room created: "${roomName}" [${code}] by ${hostName}`);

    // Notify ALL connected clients
    io.emit("new-room", {
      id:        roomId,
      name:      roomName,
      subject:   subject || "",
      hostName,
      code:      code.toUpperCase(),
      createdAt: Date.now(),
    });

    socket.emit("room-created", { roomId });
  });

  // ── Find Room by Code ────────────────────────────────────────────────────
  socket.on("find-room", ({ code }) => {
    const room = Object.values(rooms).find(
      (r) => r.code === code.toUpperCase().trim()
    );
    if (room) {
      socket.emit("room-found", {
        id:          room.id,
        name:        room.name,
        subject:     room.subject,
        hostName:    room.hostName,
        code:        room.code,
        seatCount:   Object.keys(room.seats).length,
        maxSeats:    room.maxSeats,
        viewerCount: Object.keys(room.viewers).length,
      });
    } else {
      socket.emit("room-not-found");
    }
  });

  // ── Get All Rooms ────────────────────────────────────────────────────────
  socket.on("get-rooms", () => {
    const list = Object.values(rooms).map((r) => ({
      id:          r.id,
      name:        r.name,
      subject:     r.subject,
      hostName:    r.hostName,
      code:        r.code,
      seatCount:   Object.keys(r.seats).length,
      maxSeats:    r.maxSeats,
      viewerCount: Object.keys(r.viewers).length,
      createdAt:   r.createdAt,
    }));
    socket.emit("rooms-list", list);
  });

  // ── Join Room as Participant ─────────────────────────────────────────────
  socket.on("join-room", ({ roomId, userId, userName, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("join-error", "الغرفة غير موجودة");

    const seatCount = Object.keys(room.seats).length;
    if (seatCount >= room.maxSeats) {
      return socket.emit("join-error", "الغرفة ممتلئة — يمكنك المشاهدة فقط");
    }

    room.seats[userId] = {
      userId,
      userName,
      micOn:    micOn !== false,
      camOn:    camOn !== false,
      joinedAt: Date.now(),
      socketId: socket.id,
    };
    socketMeta[socket.id] = { userId, userName, roomId, role: "participant" };

    socket.join(roomId);

    // Tell existing participants a new user joined so they initiate WebRTC
    socket.to(roomId).emit("user-joined", {
      userId,
      userName,
      socketId: socket.id,
    });

    // Send full state to new joiner
    socket.emit("join-success", {
      roomId,
      seats:   room.seats,
      viewers: room.viewers,
      chat:    room.chat.slice(-50),
    });

    broadcastRoomState(roomId);
    console.log(`👤 ${userName} joined room "${room.name}"`);
  });

  // ── Join Room as Viewer ──────────────────────────────────────────────────
  socket.on("join-viewer", ({ roomId, userId, userName }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("join-error", "الغرفة غير موجودة");

    room.viewers[userId] = {
      userId,
      userName,
      joinedAt: Date.now(),
      socketId: socket.id,
    };
    socketMeta[socket.id] = { userId, userName, roomId, role: "viewer" };

    socket.join(roomId);

    socket.emit("join-success", {
      roomId,
      seats:   room.seats,
      viewers: room.viewers,
      chat:    room.chat.slice(-50),
    });

    broadcastRoomState(roomId);
    console.log(`👁️  ${userName} watching room "${room.name}"`);
  });

  // ── WebRTC Signaling: Offer ──────────────────────────────────────────────
  socket.on("signal-offer", ({ toUserId, fromUserId, fromUserName, sdp, roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.seats[toUserId];
    if (target?.socketId) {
      io.to(target.socketId).emit("signal-offer", {
        fromUserId,
        fromUserName,
        sdp,
        roomId,
      });
      console.log(`📡 Offer: ${fromUserId} → ${toUserId}`);
    }
  });

  // ── WebRTC Signaling: Answer ─────────────────────────────────────────────
  socket.on("signal-answer", ({ toUserId, fromUserId, sdp, roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.seats[toUserId];
    if (target?.socketId) {
      io.to(target.socketId).emit("signal-answer", { fromUserId, sdp });
      console.log(`📡 Answer: ${fromUserId} → ${toUserId}`);
    }
  });

  // ── WebRTC Signaling: ICE Candidate ─────────────────────────────────────
  socket.on("signal-ice", ({ toUserId, fromUserId, candidate, roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    const target = room.seats[toUserId];
    if (target?.socketId) {
      io.to(target.socketId).emit("signal-ice", { fromUserId, candidate });
    }
  });

  // ── Media Toggle ─────────────────────────────────────────────────────────
  socket.on("toggle-media", ({ roomId, userId, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room || !room.seats[userId]) return;
    room.seats[userId].micOn = micOn;
    room.seats[userId].camOn = camOn;
    socket.to(roomId).emit("media-updated", { userId, micOn, camOn });
    broadcastRoomState(roomId);
  });

  // ── Chat Message ─────────────────────────────────────────────────────────
  socket.on("chat-message", ({ roomId, userId, userName, text, isViewer }) => {
    const room = rooms[roomId];
    if (!room) return;
    const msg = {
      id:        `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      userId,
      userName,
      text,
      isViewer:  isViewer || false,
      timestamp: Date.now(),
    };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat = room.chat.slice(-200);
    io.to(roomId).emit("chat-message", msg);
  });

  // ── Leave Room ───────────────────────────────────────────────────────────
  socket.on("leave-room", ({ roomId, userId }) => {
    handleLeave(socket, roomId, userId);
  });

  // ── Delete Room ──────────────────────────────────────────────────────────
  socket.on("delete-room", ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== userId) return;
    io.to(roomId).emit("room-deleted", { roomId });
    delete rooms[roomId];
    console.log(`🗑️  Room deleted by host: ${roomId}`);
  });

  // ── Disconnect ───────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const meta = socketMeta[socket.id];
    if (meta) {
      handleLeave(socket, meta.roomId, meta.userId);
      delete socketMeta[socket.id];
    }
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════╗");
  console.log(`  ║  🚀 Bac DZ AI — Signaling Server     ║`);
  console.log(`  ║  📡 Port: ${PORT}                        ║`);
  console.log("  ║  🔗 CORS: * (all origins)            ║");
  console.log("  ║  ✅ WebRTC Signaling Ready            ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log("");
});
