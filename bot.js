// bot.js
const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SECRET_KEY = process.env.SECRET_KEY || "nexusbot-super-secret-2026";

let bot = null;
let isConnected = false;

let config = {
  host: process.env.MC_HOST || "zenith.seedloaf.gg",
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.MC_USERNAME || "rajamc",
  version: process.env.MC_VERSION || "1.21.1",
  auth: process.env.MC_AUTH || "offline"
};

// Database
const adapter = new JSONFile('db.json');
const db = new Low(adapter);

async function initDB() {
  await db.read();
  db.data ||= { users: [] };
  await db.write();
  console.log("✅ Database siap");
}

// Auth Middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return next(new Error('Invalid token'));
    socket.user = user;
    next();
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  await db.read();
  if (db.data.users.find(u => u.username === username)) {
    return res.status(400).json({ error: "Username sudah digunakan" });
  }
  const hashed = await bcrypt.hash(password, 10);
  db.data.users.push({ username, password: hashed, activated: false });
  await db.write();
  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  await db.read();
  const user = db.data.users.find(u => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Username atau password salah" });
  }
  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '7d' });
  res.json({ token, username: user.username, activated: user.activated });
});

// Socket
io.on('connection', (socket) => {
  const isAdmin = socket.user.username.toLowerCase() === 'admin';
  socket.emit('userInfo', { username: socket.user.username, isAdmin });

  socket.on('startBot', () => {
    const user = db.data.users.find(u => u.username === socket.user.username);
    if (!user || !user.activated) {
      return socket.emit('needActivation');
    }
    createBot();
  });

  socket.on('stopBot', () => {
    if (bot) {
      bot.quit();
      bot = null;
      isConnected = false;
      io.emit('status', { connected: false });
    }
  });

  socket.on('sendChat', (msg) => {
    if (bot) bot.chat(msg);
  });

  socket.on('takeScreenshot', () => {
    if (bot) {
      bot.chat("Screenshot diambil oleh owner");
      socket.emit('screenshot', { message: "Command screenshot dikirim" });
    }
  });

  socket.on('submitActivation', async (code) => {
    await db.read();
    const user = db.data.users.find(u => u.username === socket.user.username);
    const validCodes = ["NEXUS2026", "PREMIUM2026", "MCBOT123", "RAJAMC99"];
    
    if (user && validCodes.includes(code.toUpperCase())) {
      user.activated = true;
      await db.write();
      socket.emit('activationSuccess');
    } else {
      socket.emit('activationError', { message: "Kode tidak valid" });
    }
  });

  socket.on('generateActivationCode', () => {
    if (!isAdmin) return;
    const code = 'NEXUS-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    socket.emit('newCode', code);
  });
});

function createBot() {
  bot = mineflayer.createBot(config);
  bot.once('spawn', () => {
    isConnected = true;
    io.emit('status', { connected: true, username: bot.username });
  });
  bot.on('message', (msg) => io.emit('chat', msg.toString()));
  bot.on('end', () => {
    isConnected = false;
    io.emit('status', { connected: false });
  });
}

initDB().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
});
