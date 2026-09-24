/**
 * Real-Time Authoritative Game Engine
 * 
 * Handles:
 * - State machine transitions
 * - Synchronous server timers
 * - Authoritative speed-based scoring & anti-cheat validation
 * - Dynamic leaderboard calculations
 * - Host / player disconnect grace periods
 */

const { calculateScore } = require('./scoring');
const {
  getRoom,
  getRoomBySocketId,
  scheduleRoomCleanup,
  calculateLeaderboard,
  getSanitizedRoster
} = require('./roomStore');

/**
 * Starts the next question round or ends the quiz if questions are exhausted
 * @param {import('socket.io').Server} io
 * @param {Object} room
 */
function startQuestionRound(io, room) {
  // Clear any existing timers
  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }

  room.currentQuestionIndex += 1;

  // Check if all questions are completed
  if (room.currentQuestionIndex >= room.questions.length) {
    return endQuiz(io, room);
  }

  const currentQ = room.questions[room.currentQuestionIndex];
  const timeLimitSeconds = Number(currentQ.timeLimitSeconds) || 15;

  room.state = 'question_active';
  room.questionStartedAt = Date.now();
  room.answersThisRound = {};

  // Broadcast question:start to everyone in the room (Omit correctOption & explanation)
  io.to(room.roomId).emit('question:start', {
    questionIndex: room.currentQuestionIndex + 1, // 1-based index for client display
    totalQuestions: room.questions.length,
    question: currentQ.question,
    options: currentQ.options,
    timeLimitSeconds: timeLimitSeconds
  });

  // Send initial answer count (0) to the host
  const activePlayers = Object.values(room.players).filter(p => p.connected !== false);
  io.to(room.hostSocketId).emit('host:answerCount', {
    count: 0,
    totalPlayers: activePlayers.length
  });

  console.log(`[GameEngine] Q${room.currentQuestionIndex + 1}/${room.questions.length} started in room ${room.pin} (${timeLimitSeconds}s)`);

  // Authoritative server timer for round expiration
  room.questionTimer = setTimeout(() => {
    handleTimeUp(io, room);
  }, timeLimitSeconds * 1000);
}

/**
 * Handles time up for a question round, reveals correct answer and updates leaderboard
 * @param {import('socket.io').Server} io
 * @param {Object} room
 */
function handleTimeUp(io, room) {
  if (room.state !== 'question_active') return;

  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }

  room.state = 'question_reveal';

  const currentQ = room.questions[room.currentQuestionIndex];

  // 1. Broadcast question:time_up with correct option and explanation
  io.to(room.roomId).emit('question:time_up', {
    correctOption: currentQ.correctOption,
    explanation: currentQ.explanation || ''
  });

  // 2. Broadcast updated leaderboard
  const leaderboard = calculateLeaderboard(room);
  io.to(room.roomId).emit('leaderboard:update', {
    leaderboard
  });

  console.log(`[GameEngine] Time up for Q${room.currentQuestionIndex + 1} in room ${room.pin}. Leaderboard broadcasted.`);
}

/**
 * Ends the quiz, broadcasts final winner and rankings, and schedules room cleanup
 * @param {import('socket.io').Server} io
 * @param {Object} room
 */
function endQuiz(io, room) {
  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }
  if (room.hostDisconnectTimer) {
    clearTimeout(room.hostDisconnectTimer);
    room.hostDisconnectTimer = null;
  }

  room.state = 'ended';

  const finalRanks = calculateLeaderboard(room);
  const winner = finalRanks.length > 0 && finalRanks[0].score > 0
    ? { name: finalRanks[0].name, score: finalRanks[0].score }
    : (finalRanks.length > 0 ? { name: finalRanks[0].name, score: 0 } : null);

  io.to(room.roomId).emit('quiz:ended', {
    winner,
    finalRanks
  });

  console.log(`[GameEngine] Quiz ended in room ${room.pin}. Winner:`, winner);

  // Grace period before freeing memory (60s)
  scheduleRoomCleanup(room.pin, 60000);
}

/**
 * Registers all gameplay socket handlers
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
function registerGameEngineHandlers(io, socket) {

  /**
   * Host starts the quiz
   * Payload: { pin: string }
   */
  socket.on('quiz:start', (payload = {}) => {
    try {
      const pin = (payload.pin || socket.data.pin || '').toString().trim();
      const room = getRoom(pin);

      if (!room) {
        return socket.emit('error:message', { message: 'Room not found.' });
      }

      // Authorization check: only host can start
      if (room.hostSocketId !== socket.id) {
        return socket.emit('error:message', { message: 'Only the host can start the quiz.' });
      }

      // State check
      if (room.state !== 'lobby') {
        return socket.emit('error:message', { message: 'Quiz is already in progress or ended.' });
      }

      // Minimum players check (>= 1)
      const connectedPlayers = Object.values(room.players).filter(p => p.connected !== false);
      if (connectedPlayers.length < 1) {
        return socket.emit('error:message', { message: 'At least 1 player is required to start the quiz.' });
      }

      room.state = 'in_progress';
      console.log(`[GameEngine] Host started quiz in room ${room.pin}`);
      startQuestionRound(io, room);
    } catch (err) {
      console.error('[GameEngine] Error in quiz:start:', err);
      socket.emit('error:message', { message: 'Failed to start quiz: ' + err.message });
    }
  });

  /**
   * Player submits an answer
   * Payload: { pin: string, selectedOption: number, timeTakenMs?: number }
   */
  socket.on('answer:submit', (payload = {}) => {
    try {
      const pin = (payload.pin || socket.data.pin || '').toString().trim();
      const room = getRoom(pin);

      if (!room) {
        return socket.emit('error:message', { message: 'Room not found.' });
      }

      const player = room.players[socket.id];
      if (!player) {
        return socket.emit('error:message', { message: 'Player not registered in this room.' });
      }

      // State check: must be active question
      if (room.state !== 'question_active') {
        return socket.emit('error:message', { message: 'No active question round.' });
      }

      // Single submission check: duplicate answers rejected
      if (room.answersThisRound[socket.id]) {
        return socket.emit('error:message', { message: 'Answer already submitted for this question.' });
      }

      const currentQ = room.questions[room.currentQuestionIndex];
      const totalTimeLimitMs = (Number(currentQ.timeLimitSeconds) || 15) * 1000;

      // Authoritative server clock calculation
      const serverElapsed = Date.now() - room.questionStartedAt;

      // Anti-cheat verification: answers after server timer cutoff are rejected
      // Allowing a tiny 150ms buffer for network transmission latency
      if (serverElapsed > totalTimeLimitMs + 150) {
        return socket.emit('error:message', { message: 'Time expired! Answer rejected.' });
      }

      const selectedOption = Number(payload.selectedOption);
      if (isNaN(selectedOption) || selectedOption < 0 || selectedOption >= currentQ.options.length) {
        return socket.emit('error:message', { message: 'Invalid option selected.' });
      }

      const isCorrect = selectedOption === currentQ.correctOption;

      // Calculate score based on server-measured time (never trust client timeTakenMs)
      const pointsAwarded = calculateScore(isCorrect, serverElapsed, totalTimeLimitMs);

      player.score += pointsAwarded;

      // Record answer for this round
      room.answersThisRound[socket.id] = {
        selectedOption,
        isCorrect,
        pointsAwarded,
        serverTimeTakenMs: serverElapsed
      };

      // Emit private confirmation to the player
      socket.emit('answer:accepted', {
        selectedOption,
        pointsAwarded,
        isCorrect
      });

      // Update host screen with running answer count
      const activePlayers = Object.values(room.players).filter(p => p.connected !== false);
      const answeredCount = Object.keys(room.answersThisRound).length;

      io.to(room.hostSocketId).emit('host:answerCount', {
        count: answeredCount,
        totalPlayers: activePlayers.length
      });

      console.log(`[GameEngine] Player "${player.name}" answered Q${room.currentQuestionIndex + 1} (${isCorrect ? 'CORRECT' : 'INCORRECT'}, +${pointsAwarded} pts, ${serverElapsed}ms)`);

      // If all active connected players have submitted, reveal answer immediately
      if (answeredCount >= activePlayers.length && activePlayers.length > 0) {
        console.log(`[GameEngine] All ${activePlayers.length} players answered in room ${room.pin}. Revealing answer early.`);
        handleTimeUp(io, room);
      }
    } catch (err) {
      console.error('[GameEngine] Error in answer:submit:', err);
      socket.emit('error:message', { message: 'Failed to process answer: ' + err.message });
    }
  });

  /**
   * Host advances to the next question
   * Payload: { pin: string }
   */
  socket.on('question:next', (payload = {}) => {
    try {
      const pin = (payload.pin || socket.data.pin || '').toString().trim();
      const room = getRoom(pin);

      if (!room) {
        return socket.emit('error:message', { message: 'Room not found.' });
      }

      // Authorization check
      if (room.hostSocketId !== socket.id) {
        return socket.emit('error:message', { message: 'Only the host can advance to the next question.' });
      }

      // Must be in reveal state
      if (room.state !== 'question_reveal') {
        return socket.emit('error:message', { message: 'Cannot advance while question is active or quiz is ended.' });
      }

      console.log(`[GameEngine] Host advanced to next round in room ${room.pin}`);
      startQuestionRound(io, room);
    } catch (err) {
      console.error('[GameEngine] Error in question:next:', err);
      socket.emit('error:message', { message: 'Failed to advance question: ' + err.message });
    }
  });

  /**
   * Handle socket disconnection
   */
  socket.on('disconnect', () => {
    try {
      const { room, isHost, player } = getRoomBySocketId(socket.id);
      if (!room) return;

      if (isHost) {
        console.log(`[GameEngine] Host disconnected from room ${room.pin}`);
        room.hostDisconnected = true;

        if (room.state !== 'ended') {
          io.to(room.roomId).emit('host:disconnected', {
            message: 'Host disconnected. Waiting 30s for reconnection...'
          });

          // 30s grace period for host to reconnect
          if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
          room.hostDisconnectTimer = setTimeout(() => {
            if (room.hostDisconnected && room.state !== 'ended') {
              console.log(`[GameEngine] Host did not return to room ${room.pin}. Ending quiz.`);
              endQuiz(io, room);
            }
          }, 30000);
        }
      } else if (player) {
        console.log(`[GameEngine] Player "${player.name}" disconnected from room ${room.pin}`);
        player.connected = false;

        // If in lobby, update lobby roster
        if (room.state === 'lobby') {
          io.to(room.roomId).emit('lobby:update', {
            players: getSanitizedRoster(room)
          });
        }
      }
    } catch (err) {
      console.error('[GameEngine] Error in disconnect handler:', err);
    }
  });
}

module.exports = {
  registerGameEngineHandlers,
  startQuestionRound,
  handleTimeUp,
  endQuiz
};
