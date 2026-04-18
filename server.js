const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const waitingQueues = new Map();
const partners = new Map();

function getQueue(topic) {
  if (!waitingQueues.has(topic)) {
    waitingQueues.set(topic, []);
  }
  return waitingQueues.get(topic);
}

function removeFromQueue(socketId, topic) {
  const queue = waitingQueues.get(topic);
  if (!queue) return;
  waitingQueues.set(topic, queue.filter((id) => id !== socketId));
}

function cleanupPartner(socketId) {
  const partnerId = partners.get(socketId);
  if (partnerId) {
    partners.delete(partnerId);
    partners.delete(socketId);
    return partnerId;
  }
  return null;
}

function sanitizeMessage(text) {
  const bannedWords = [/fuck/gi, /shit/gi, /damn/gi, /bitch/gi, /asshole/gi];
  return bannedWords.reduce(
    (value, pattern) => value.replace(pattern, (match) => "*".repeat(match.length)),
    String(text)
  );
}

function findPartner(topic, socketId) {
  const queue = getQueue(topic);
  while (queue.length) {
    const partnerId = queue.shift();
    if (partnerId === socketId) continue;
    const partnerSocket = io.sockets.sockets.get(partnerId);
    if (partnerSocket && !partners.has(partnerId)) {
      return partnerId;
    }
  }
  return null;
}

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("findPartner", ({ nickname, topic = "random" } = {}) => {
    socket.data.nickname = nickname?.trim() || `Guest${Math.floor(Math.random() * 9000 + 1000)}`;
    socket.data.topic = topic || "random";
    socket.data.waiting = false;

    const partnerId = findPartner(socket.data.topic, socket.id);
    if (partnerId) {
      partners.set(socket.id, partnerId);
      partners.set(partnerId, socket.id);
      socket.data.waiting = false;

      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) partnerSocket.data.waiting = false;

      socket.emit("partnerFound", {
        topic: socket.data.topic,
        partnerName: partnerSocket?.data.nickname || "Stranger",
      });
      if (partnerSocket) {
        partnerSocket.emit("partnerFound", {
          topic: socket.data.topic,
          partnerName: socket.data.nickname,
        });
      }
      console.log(`Paired ${socket.id} with ${partnerId} on topic ${socket.data.topic}`);
    } else {
      getQueue(socket.data.topic).push(socket.id);
      socket.data.waiting = true;
      socket.emit("waiting", { topic: socket.data.topic });
      console.log(`Waiting for partner: ${socket.id} on topic ${socket.data.topic}`);
    }
  });

  socket.on("message", (message) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      let payload;
      if (typeof message === "string") {
        payload = {
          text: sanitizeMessage(message),
          author: socket.data.nickname,
          timestamp: Date.now(),
        };
      } else {
        payload = {
          ...message,
          author: message.author || socket.data.nickname,
          text: typeof message.text === "string" ? sanitizeMessage(message.text) : message.text,
          timestamp: message.timestamp || Date.now(),
        };
      }
      io.to(partnerId).emit("message", payload);
    }
  });

  socket.on("file", (fileData) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("file", {
        ...fileData,
        author: socket.data.nickname,
      });
    }
  });

  socket.on("typing", () => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("typing");
    }
  });

  socket.on("stopTyping", () => {
    const partnerId = partners.get(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("stopTyping");
    }
  });

  socket.on("leave", () => {
    if (socket.data.waiting) {
      removeFromQueue(socket.id, socket.data.topic);
      socket.data.waiting = false;
    }
    const partnerId = cleanupPartner(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partnerDisconnected");
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    if (socket.data.waiting) {
      removeFromQueue(socket.id, socket.data.topic);
    }
    const partnerId = cleanupPartner(socket.id);
    if (partnerId) {
      io.to(partnerId).emit("partnerDisconnected");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
