/**
 * In-Memory Shared Room Store & Utilities
 */

const rooms = new Map();

/**
 * Escapes HTML characters to prevent XSS injection
 * @param {string} str
 * @returns {string}
 */
function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

/**
 * Generates a unique 4-digit PIN (1000-9999)
 * @returns {string}
 */
function generatePin() {
  let pin;
  let attempts = 0;
  do {
    pin = Math.floor(1000 + Math.random() * 9000).toString();
    attempts++;
    if (attempts > 10000) {
      throw new Error('Room capacity reached. Unable to generate unique PIN.');
    }
  } while (rooms.has(pin));
  return pin;
}

/**
 * Shuffles an array using Fisher-Yates algorithm
 * @param {Array} array
 * @returns {Array}
 */
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Creates and registers a new quiz room
 */
function createRoom(pin, hostSocketId, hostName, category, questions) {
  const roomId = `quiz_${pin}`;
  const room = {
    pin,
    roomId,
    hostSocketId,
    hostName: sanitizeHtml(hostName),
    category,
    state: 'lobby', // lobby | in_progress | question_active | question_reveal | ended
    players: {}, // socketId -> { name, score, socketId, connected }
    playerNameToSocketId: {}, // nameLower -> socketId (for quick deduplication and reconnect)
    questions: questions.map(q => ({ ...q })), // Shallow copy
    currentQuestionIndex: -1,
    questionTimer: null,
    questionStartedAt: null,
    answersThisRound: {}, // socketId -> { selectedOption, isCorrect, pointsAwarded, timeTakenMs }
    hostDisconnected: false,
    hostDisconnectTimer: null,
    cleanupTimer: null,
    timerPausedRemainingMs: null
  };

  rooms.set(pin, room);
  return room;
}

/**
 * Retrieves a room by PIN
 * @param {string} pin
 */
function getRoom(pin) {
  if (!pin) return null;
  return rooms.get(pin.toString().trim()) || null;
}

/**
 * Finds a room associated with a socket ID (as host or player)
 * @param {string} socketId
 */
function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === socketId) {
      return { room, isHost: true };
    }
    if (room.players[socketId]) {
      return { room, isHost: false, player: room.players[socketId] };
    }
    // Also check disconnected players matching socketId
    for (const p of Object.values(room.players)) {
      if (p.socketId === socketId) {
        return { room, isHost: false, player: p };
      }
    }
  }
  return { room: null, isHost: false, player: null };
}

/**
 * Schedules memory cleanup of a room after a grace period (e.g. 60s)
 * @param {string} pin
 * @param {number} delayMs
 */
function scheduleRoomCleanup(pin, delayMs = 60000) {
  const room = rooms.get(pin);
  if (!room) return;

  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
  }

  room.cleanupTimer = setTimeout(() => {
    if (room.questionTimer) clearTimeout(room.questionTimer);
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    rooms.delete(pin);
  }, delayMs);
}

/**
 * Deletes a room immediately
 * @param {string} pin
 */
function deleteRoom(pin) {
  const room = rooms.get(pin);
  if (room) {
    if (room.questionTimer) clearTimeout(room.questionTimer);
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    rooms.delete(pin);
  }
}

/**
 * Returns count of active rooms
 */
function getActiveRoomCount() {
  return rooms.size;
}

/**
 * Formats the public roster for lobby:update
 * @param {Object} room
 * @returns {Array<{name: string, score: number}>}
 */
function getSanitizedRoster(room) {
  return Object.values(room.players)
    .filter(p => p.connected !== false || p.score > 0)
    .map(p => ({
      name: p.name,
      score: p.score
    }));
}

/**
 * Computes ranked leaderboard: [{ rank, name, score }, ...]
 * Sorted by score DESC, then tie-broken alphabetically by name ASC.
 * @param {Object} room
 * @returns {Array<{rank: number, name: string, score: number}>}
 */
function calculateLeaderboard(room) {
  const playerList = Object.values(room.players).map(p => ({
    name: p.name,
    score: p.score
  }));

  // Sort descending by score, ascending by name for deterministic ties
  playerList.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.name.localeCompare(b.name);
  });

  return playerList.map((p, index) => ({
    rank: index + 1,
    name: p.name,
    score: p.score
  }));
}

module.exports = {
  rooms,
  sanitizeHtml,
  generatePin,
  shuffleArray,
  createRoom,
  getRoom,
  getRoomBySocketId,
  scheduleRoomCleanup,
  deleteRoom,
  getActiveRoomCount,
  getSanitizedRoster,
  calculateLeaderboard
};
