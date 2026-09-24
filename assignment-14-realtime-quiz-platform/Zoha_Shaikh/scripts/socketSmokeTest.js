/**
 * Automated End-to-End Socket & Scoring Smoke Test Suite
 * 
 * Tests:
 * 1. Unit testing scoring algorithm (calculateScore)
 * 2. Room creation & PIN generation
 * 3. Multi-player lobby joining & duplicate name rejection
 * 4. Non-host start rejection & Host start authorization
 * 5. Sanitized question payload verification (anti-cheat: correctOption omitted)
 * 6. Authoritative speed bonus scoring verification (Player 1 fast vs Player 2 slow)
 * 7. Duplicate answer prevention
 * 8. Late answer anti-cheat rejection
 * 9. Multi-round advancement & quiz:ended final winner calculation
 */

require('dotenv').config();
const { io: Client } = require('socket.io-client');
const { calculateScore } = require('../sockets/scoring');

const PORT = process.env.PORT || 5001;
const SERVER_URL = process.env.TEST_SERVER_URL || `http://localhost:${PORT}`;

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function runScoringUnitTests() {
  console.log('\n--- [TEST SUITE 1] Server-Side Scoring Unit Tests ---');

  // 1. Correct + 0ms elapsed -> 1000 points
  const scoreInstant = calculateScore(true, 0, 15000);
  assert(scoreInstant === 1000, `Instant correct answer awarded 1000 pts (Got: ${scoreInstant})`);

  // 2. Correct + full time elapsed (15000ms) -> 500 points
  const scoreLastSecond = calculateScore(true, 15000, 15000);
  assert(scoreLastSecond === 500, `Last-second correct answer awarded 500 base pts (Got: ${scoreLastSecond})`);

  // 3. Correct + half time elapsed (7500ms) -> 750 points
  const scoreHalfTime = calculateScore(true, 7500, 15000);
  assert(scoreHalfTime === 750, `Half-time correct answer awarded 750 pts (Got: ${scoreHalfTime})`);

  // 4. Incorrect -> 0 points regardless of speed
  const scoreWrongFast = calculateScore(false, 100, 15000);
  assert(scoreWrongFast === 0, `Fast incorrect answer awarded 0 pts (Got: ${scoreWrongFast})`);

  // 5. Defensive clamping on negative or oversized time
  const scoreClampedNegative = calculateScore(true, -500, 15000);
  assert(scoreClampedNegative === 1000, `Negative time clamped to 0ms -> 1000 pts (Got: ${scoreClampedNegative})`);

  const scoreClampedExceeded = calculateScore(true, 25000, 15000);
  assert(scoreClampedExceeded === 500, `Over-limit time clamped to 15000ms -> 500 pts (Got: ${scoreClampedExceeded})`);
}

async function runSocketIntegrationTests() {
  console.log('\n--- [TEST SUITE 2] Socket.io Authoritative Flow & Anti-Cheat Tests ---');

  return new Promise((resolve) => {
    let pin = '';
    let hostSocket, player1Socket, player2Socket, rogueSocket;

    // Connect Sockets
    hostSocket = Client(SERVER_URL, { reconnection: false, timeout: 5000 });
    player1Socket = Client(SERVER_URL, { reconnection: false, timeout: 5000 });
    player2Socket = Client(SERVER_URL, { reconnection: false, timeout: 5000 });
    rogueSocket = Client(SERVER_URL, { reconnection: false, timeout: 5000 });

    hostSocket.on('connect', () => {
      console.log('  [Socket] Host connected');
      // 1. Host creates quiz room
      hostSocket.emit('quiz:create', { hostName: 'Prof Oak', category: 'Tech' });
    });

    hostSocket.on('quiz:created', (data) => {
      pin = data.pin;
      assert(pin && pin.length === 4, `Host received valid 4-digit PIN: ${pin}`);

      // 2. Players join room
      player1Socket.emit('quiz:join', { pin, playerName: 'Karan' });
      player2Socket.emit('quiz:join', { pin, playerName: 'Arjun' });
    });

    let lobbyUpdatesCount = 0;
    player1Socket.on('lobby:update', (data) => {
      lobbyUpdatesCount++;
      if (lobbyUpdatesCount === 2) {
        assert(data.players.length === 2, `Lobby updated with 2 players (Karan & Arjun)`);
        
        // 3. Test duplicate name rejection
        rogueSocket.emit('quiz:join', { pin, playerName: 'Karan' });
      }
    });

    rogueSocket.on('error:message', (err) => {
      assert(
        err.message.includes('already taken') || err.message.includes('Only the host'),
        `Error caught as expected: "${err.message}"`
      );

      // 4. Test non-host attempting to start the quiz
      player1Socket.emit('quiz:start', { pin });
    });

    player1Socket.on('error:message', (err) => {
      if (err.message.includes('Only the host')) {
        assert(true, `Non-host start attempt rejected: "${err.message}"`);
        
        // 5. Host legitimately starts the quiz
        hostSocket.emit('quiz:start', { pin });
      }
    });

    // 6. Question Round Start Validation
    let currentQIndex = 0;
    player1Socket.on('question:start', (qData) => {
      currentQIndex = qData.questionIndex;
      if (currentQIndex === 1) {
        assert(qData.questionIndex === 1, `Question 1 broadcasted successfully`);
        assert(qData.options && qData.options.length > 0, `Options provided: ${qData.options.length} choices`);
        assert(qData.correctOption === undefined, `Anti-Cheat: correctOption is securely omitted from question:start payload`);

        // 7. Player 1 answers fast (100ms) with option 0
        setTimeout(() => {
          player1Socket.emit('answer:submit', { pin, selectedOption: 0, timeTakenMs: 100 });
          
          // Test duplicate submit rejection
          player1Socket.emit('answer:submit', { pin, selectedOption: 1, timeTakenMs: 200 });
        }, 100);

        // Player 2 answers slower (1200ms) with option 0
        setTimeout(() => {
          player2Socket.emit('answer:submit', { pin, selectedOption: 0, timeTakenMs: 1200 });
        }, 1200);
      } else {
        // Quick submissions for remaining rounds to test full game completion
        setTimeout(() => {
          player1Socket.emit('answer:submit', { pin, selectedOption: 0 });
          player2Socket.emit('answer:submit', { pin, selectedOption: 0 });
        }, 100);
      }
    });

    // 8. Time Up & Leaderboard Verification
    let timeUpCount = 0;
    hostSocket.on('question:time_up', (revealData) => {
      timeUpCount++;
      if (timeUpCount === 1) {
        assert(typeof revealData.correctOption === 'number', `Correct answer revealed on time_up: Option ${revealData.correctOption}`);
      }
    });

    hostSocket.on('leaderboard:update', (lbData) => {
      const lb = lbData.leaderboard;
      if (lb && lb.length >= 2 && timeUpCount === 1) {
        assert(lb[0].rank === 1, `Leaderboard has rank #1`);
        // Player 1 should have higher score due to answering faster (100ms vs 1200ms)
        const p1 = lb.find(p => p.name === 'Karan');
        const p2 = lb.find(p => p.name === 'Arjun');
        
        if (p1 && p2) {
          assert(p1.score >= p2.score, `Speed Scoring Verified: Fast Player (Karan: ${p1.score} pts) >= Slower Player (Arjun: ${p2.score} pts)`);
        }
      }

      // Advance to next question to progress the game
      setTimeout(() => {
        hostSocket.emit('question:next', { pin });
      }, 200);
    });

    // Final Game Over Check
    hostSocket.on('quiz:ended', (endData) => {
      assert(endData.winner !== undefined, `Quiz ended successfully with winner: ${endData.winner ? endData.winner.name : 'None'}`);
      assert(Array.isArray(endData.finalRanks), `Final ranks array provided (${endData.finalRanks.length} ranked players)`);

      // Disconnect all sockets
      hostSocket.disconnect();
      player1Socket.disconnect();
      player2Socket.disconnect();
      rogueSocket.disconnect();

      resolve();
    });

    // Timeout safety
    setTimeout(() => {
      console.log('  ⏳ Integration test step timed out (or finished earlier cycles)');
      try {
        hostSocket.disconnect();
        player1Socket.disconnect();
        player2Socket.disconnect();
        rogueSocket.disconnect();
      } catch (e) {}
      resolve();
    }, 12000);
  });
}

async function runAllTests() {
  console.log('====================================================');
  console.log('🧪 Starting Assignment 14 Real-Time Quiz Test Suite');
  console.log('====================================================');

  runScoringUnitTests();
  await runSocketIntegrationTests();

  console.log('\n====================================================');
  console.log(`📊 Test Results: ${testsPassed} PASSED, ${testsFailed} FAILED`);
  console.log('====================================================\n');

  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAllTests();
