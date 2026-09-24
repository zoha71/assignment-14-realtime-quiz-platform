/**
 * Server Entry Point - Assignment 14: Real-Time Multiplayer Live Quiz Battle
 */

require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const { registerLobbyHandlers } = require('./sockets/lobbyHandler');
const { registerGameEngineHandlers } = require('./sockets/gameEngine');
const { getActiveRoomCount } = require('./sockets/roomStore');

// Configuration
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Initialize Express App
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Serve Static Frontend Assets
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Load Question Bank at Startup (Fail-Fast)
const questionsPath = path.join(__dirname, 'data', 'questions.json');
let questionBank = [];

try {
  if (!fs.existsSync(questionsPath)) {
    throw new Error(`Questions file not found at ${questionsPath}`);
  }
  const rawData = fs.readFileSync(questionsPath, 'utf8');
  questionBank = JSON.parse(rawData);
  if (!Array.isArray(questionBank) || questionBank.length === 0) {
    throw new Error('Questions file must contain a non-empty array of questions.');
  }
  console.log(`[Startup] Loaded ${questionBank.length} questions across categories:`, 
    [...new Set(questionBank.map(q => q.category || 'General'))]
  );
} catch (err) {
  console.error('[Startup Error] Failed to load question bank:', err.message);
  process.exit(1);
}

// Health Check Endpoint (Required by Render & Monitoring)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: NODE_ENV,
    activeRooms: getActiveRoomCount(),
    totalQuestions: questionBank.length,
    timestamp: new Date().toISOString()
  });
});

// Categories API for Host Room Creation
app.get('/api/categories', (req, res) => {
  const categories = ['All', ...new Set(questionBank.map(q => q.category).filter(Boolean))];
  res.json({ categories });
});

// Explicit Static HTML Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/host.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'host.html'));
});

app.get('/player.html', (req, res) => {
  res.sendFile(path.join(publicDir, 'player.html'));
});

// Create HTTP Server & Attach Socket.io
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST']
  },
  pingTimeout: 20000,
  pingInterval: 10000
});

// Socket.io Connection Lifecycle
io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Register Handlers with try/catch isolation
  try {
    registerLobbyHandlers(io, socket, questionBank);
    registerGameEngineHandlers(io, socket);
  } catch (err) {
    console.error(`[Socket Error] Registration failed for ${socket.id}:`, err);
  }

  socket.on('error', (err) => {
    console.error(`[Socket Error] Socket ${socket.id} error:`, err);
  });
});

// Start Server on 0.0.0.0 for host/Render compatibility
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 Live Quiz Battle Arena Server Running!`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🎮 Host Portal: http://localhost:${PORT}/host.html`);
  console.log(`📱 Player Portal: http://localhost:${PORT}/player.html`);
  console.log(`💓 Health: http://localhost:${PORT}/health`);
  console.log(`⚙️  Environment: ${NODE_ENV}`);
  console.log(`====================================================`);
});

module.exports = { app, httpServer, io };
