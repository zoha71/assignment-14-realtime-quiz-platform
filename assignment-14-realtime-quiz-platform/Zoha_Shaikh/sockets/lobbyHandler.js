/**
 * Lobby & Room Initialization Socket Handlers
 */

const {
  sanitizeHtml,
  generatePin,
  shuffleArray,
  createRoom,
  getRoom,
  getSanitizedRoster
} = require('./roomStore');

/**
 * Registers lobby-related socket events
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 * @param {Array} questionBank
 */
function registerLobbyHandlers(io, socket, questionBank) {

  /**
   * Host initializes a quiz room
   * Payload: { hostName: string, category?: string }
   */
  socket.on('quiz:create', (payload = {}) => {
    try {
      const rawHostName = (payload.hostName || '').toString().trim();
      const rawCategory = (payload.category || '').toString().trim();

      if (!rawHostName) {
        return socket.emit('error:message', { message: 'Host name is required to create a quiz.' });
      }

      if (rawHostName.length > 30) {
        return socket.emit('error:message', { message: 'Host name cannot exceed 30 characters.' });
      }

      const hostName = sanitizeHtml(rawHostName);

      // Filter questions by category if specified and not 'All'
      let selectedQuestions = [];
      if (rawCategory && rawCategory.toLowerCase() !== 'all' && rawCategory.toLowerCase() !== 'general') {
        selectedQuestions = questionBank.filter(
          q => q.category && q.category.toLowerCase() === rawCategory.toLowerCase()
        );
        if (selectedQuestions.length === 0) {
          return socket.emit('error:message', { message: `No questions found for category: "${rawCategory}".` });
        }
      } else {
        selectedQuestions = [...questionBank];
      }

      if (selectedQuestions.length === 0) {
        return socket.emit('error:message', { message: 'Question bank is empty.' });
      }

      // Shuffle question order
      const shuffledQuestions = shuffleArray(selectedQuestions);

      // Generate unique PIN and create room
      const pin = generatePin();
      const room = createRoom(pin, socket.id, hostName, rawCategory || 'All', shuffledQuestions);

      socket.join(room.roomId);
      socket.data.roomId = room.roomId;
      socket.data.pin = pin;
      socket.data.isHost = true;

      // Emit quiz:created to host only
      socket.emit('quiz:created', {
        pin: room.pin,
        roomId: room.roomId,
        hostName: room.hostName,
        category: room.category,
        totalQuestions: room.questions.length
      });

      console.log(`[Lobby] Room created: PIN ${pin} by Host "${hostName}" (${selectedQuestions.length} questions)`);
    } catch (err) {
      console.error('[Lobby] Error in quiz:create:', err);
      socket.emit('error:message', { message: 'Failed to create quiz room: ' + err.message });
    }
  });

  /**
   * Player joins an active lobby using PIN
   * Payload: { pin: string, playerName: string }
   */
  socket.on('quiz:join', (payload = {}) => {
    try {
      const rawPin = (payload.pin || '').toString().trim();
      const rawPlayerName = (payload.playerName || '').toString().trim();

      if (!rawPin) {
        return socket.emit('error:message', { message: '4-digit PIN is required.' });
      }

      if (!rawPlayerName) {
        return socket.emit('error:message', { message: 'Player name is required.' });
      }

      if (rawPlayerName.length > 20) {
        return socket.emit('error:message', { message: 'Player name cannot exceed 20 characters.' });
      }

      const room = getRoom(rawPin);
      if (!room) {
        return socket.emit('error:message', { message: 'Invalid PIN. Room not found.' });
      }

      const playerName = sanitizeHtml(rawPlayerName);
      const nameKey = playerName.toLowerCase();

      // Check if player is reconnecting with an existing name
      let existingPlayer = null;
      for (const p of Object.values(room.players)) {
        if (p.name.toLowerCase() === nameKey) {
          existingPlayer = p;
          break;
        }
      }

      if (existingPlayer) {
        if (existingPlayer.connected) {
          return socket.emit('error:message', { message: 'Name already taken in this room.' });
        }
        // Player reconnecting: restore state and link to new socket
        delete room.players[existingPlayer.socketId];
        existingPlayer.socketId = socket.id;
        existingPlayer.connected = true;
        room.players[socket.id] = existingPlayer;

        socket.join(room.roomId);
        socket.data.roomId = room.roomId;
        socket.data.pin = room.pin;
        socket.data.playerName = existingPlayer.name;
        socket.data.isHost = false;

        // Broadcast updated lobby roster
        io.to(room.roomId).emit('lobby:update', {
          players: getSanitizedRoster(room)
        });

        socket.emit('quiz:joined', {
          pin: room.pin,
          playerName: existingPlayer.name,
          currentScore: existingPlayer.score,
          state: room.state
        });

        console.log(`[Lobby] Player reconnected: "${existingPlayer.name}" in room ${room.pin}`);
        return;
      }

      // If joining mid-game is attempted by a brand-new player, reject
      if (room.state !== 'lobby') {
        return socket.emit('error:message', { message: 'Quiz already in progress. Cannot join mid-game.' });
      }

      // Add new player to room
      room.players[socket.id] = {
        name: playerName,
        score: 0,
        socketId: socket.id,
        connected: true
      };

      socket.join(room.roomId);
      socket.data.roomId = room.roomId;
      socket.data.pin = room.pin;
      socket.data.playerName = playerName;
      socket.data.isHost = false;

      // Broadcast lobby update to everyone in room (including host)
      io.to(room.roomId).emit('lobby:update', {
        players: getSanitizedRoster(room)
      });

      socket.emit('quiz:joined', {
        pin: room.pin,
        playerName: playerName,
        currentScore: 0,
        state: room.state
      });

      console.log(`[Lobby] Player joined: "${playerName}" in room ${room.pin}`);
    } catch (err) {
      console.error('[Lobby] Error in quiz:join:', err);
      socket.emit('error:message', { message: 'Failed to join quiz: ' + err.message });
    }
  });
}

module.exports = {
  registerLobbyHandlers
};
