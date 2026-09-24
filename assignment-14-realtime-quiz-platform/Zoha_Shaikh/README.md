# 🧠 Real-Time Multiplayer Live Quiz Battle Arena (Socket.io)

> **ITM Assignment 14** | Author: Kartik Wagh  
> **Tech Stack:** Node.js, Express.js, Socket.io, In-Memory Authoritative Game Engine, CORS  
> **Deployment Target:** Render Web Service

---

## 📌 1. Project Overview & Features

A high-stakes, interactive **Real-Time Multiplayer Trivia & Quiz Battle Arena** (inspired by Kahoot & Quizizz) architected on Node.js and Socket.io. The platform features an **authoritative game server** that synchronizes countdown clocks, evaluates player submissions based on correctness and millisecond speed bonuses, prevents late submission tampering, and broadcasts dynamic leaderboards across all connected participants.

### ✨ Key Features:
- **Asymmetric Role Architecture:**
  - **Host / Admin Dashboard (`host.html`):** Room PIN creation, category selection, live lobby roster, question & options presentation, cosmetic timer ring, live answer counter (`host:answerCount`), correct answer reveal with explanations, and host-controlled "Next Question" advance (`question:next`).
  - **Player Gamepad (`player.html`):** Mobile-optimized 4-color high-contrast tactile keypad (▲ Red, ◆ Blue, ● Yellow, ■ Green), instant single-tap locking (anti-duplicate submission), dynamic round score feedback, personal standing indicator, and game-over trophy screen.
- **Authoritative Server Countdown Clocks:** Server `setTimeout` controls all round transitions; client clocks are purely visual to eliminate clock drift or manipulation.
- **Speed-Based Dynamic Scoring:** Accurate millisecond bonus calculation awarded strictly according to the server's measured elapsed time.
- **Strict Anti-Cheat Verification:** Submissions with timestamp tampering or arriving after server-measured timer expiration are automatically rejected.
- **Deterministic Live Leaderboards:** Real-time re-ranking after each question round sorted by score descending, tie-broken alphabetically.
- **Fault-Tolerant Reconnections:** 30-second grace period for disconnected hosts; seamless player reconnection preserving cumulative score.

---

## 🛠️ 2. Tech Stack & Dependencies

- **Backend Runtime:** Node.js (`>=18`)
- **Web Framework:** Express.js (`4.x`)
- **Real-Time Engine:** Socket.io (`4.x`)
- **Cross-Origin Handling:** CORS (`2.8.x`)
- **Environment Configuration:** Dotenv (`16.x`)
- **Development & Testing:** Nodemon, Socket.io-client

---

## 🚀 3. Setup & Running Locally

### Prerequisites
- Node.js v18+ installed on your machine.

### Installation & Launch
```bash
# 1. Navigate into the project folder
cd Kartik_Wagh

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Start development server with hot-reload
npm run dev

# Or start in standard production mode
npm start
```

### Access URLs
- **Main Portal:** [http://localhost:5000](http://localhost:5000)
- **Host View:** [http://localhost:5000/host.html](http://localhost:5000/host.html)
- **Player View:** [http://localhost:5000/player.html](http://localhost:5000/player.html)
- **Health Check:** [http://localhost:5000/health](http://localhost:5000/health)

---

## 📡 4. Real-Time Socket Event Protocol

### 🎪 Lobby & Game Setup Events

| Event Name | Direction | Payload Schema | Server-Side Logic & Description |
|---|:---:|---|---|
| `quiz:create` | `Host -> Server` | `{ "hostName": "Professor X", "category": "Tech" }` | Validates host name and category, shuffles question pool, generates unique 4-digit PIN, initializes room state (`lobby`), joins host socket to room. |
| `quiz:created` | `Server -> Host` | `{ "pin": "8421", "roomId": "quiz_8421", "totalQuestions": 5 }` | Returns assigned 4-digit PIN to the host screen. |
| `quiz:join` | `Player -> Server` | `{ "pin": "8421", "playerName": "Karan" }` | Validates PIN and player name uniqueness. Reconnects disconnected players or registers new player in `room.players`. Rejects if game is in progress. |
| `quiz:joined` | `Server -> Player` | `{ "pin": "8421", "playerName": "Karan", "currentScore": 0 }` | Confirms player join and passes initial score/state. |
| `lobby:update` | `Server -> Room` | `{ "players": [{ "name": "Karan", "score": 0 }] }` | Broadcasts sanitized participant roster to all room members whenever players join or leave. |
| `quiz:start` | `Host -> Server` | `{ "pin": "8421" }` | Validates host authorization and $\ge 1$ player requirement. Transitions room to `in_progress` and launches Round 1. |

### ⏱️ Live Gameplay & Question Round Events

| Event Name | Direction | Payload Schema | Server-Side Logic & Description |
|---|:---:|---|---|
| `question:start` | `Server -> Room` | `{ "questionIndex": 1, "totalQuestions": 5, "question": "...", "options": ["..."], "timeLimitSeconds": 15 }` | Broadcasts round details to the entire room. **Omit `correctOption` and `explanation`** to prevent client-side inspection cheating. Starts server timer. |
| `host:answerCount` | `Server -> Host` | `{ "count": 2, "totalPlayers": 3 }` | Lightweight notification to the host showing running count of submissions for the active round. |
| `answer:submit` | `Player -> Server` | `{ "pin": "8421", "selectedOption": 0, "timeTakenMs": 3200 }` | Server computes elapsed time from internal clock (`Date.now() - questionStartedAt`). Validates anti-cheat cutoff, calculates points via `calculateScore`, updates player score, and records answer. |
| `answer:accepted` | `Server -> Player` | `{ "selectedOption": 0, "pointsAwarded": 893, "isCorrect": true }` | Private confirmation sent to the answering player. |
| `question:time_up` | `Server -> Room` | `{ "correctOption": 0, "explanation": "..." }` | Fired when authoritative timer expires or all players submit. Reveals correct option index and explanation. |
| `leaderboard:update` | `Server -> Room` | `{ "leaderboard": [{ "rank": 1, "name": "Karan", "score": 1420 }] }` | Computes fresh sorted rankings (Score DESC $\rightarrow$ Name ASC) and broadcasts standings to all participants. |
| `question:next` | `Host -> Server` | `{ "pin": "8421" }` | Host-controlled advance trigger. Transitions room to the next question round or calls `quiz:ended`. |
| `quiz:ended` | `Server -> Room` | `{ "winner": { "name": "Karan", "score": 4850 }, "finalRanks": [...] }` | Broadcasts final winner and complete rank roster upon question exhaustion. Schedules room cleanup (60s). |
| `error:message` | `Server -> Client` | `{ "message": "Invalid PIN or quiz not found." }` | Dedicated validation and anti-cheat error channel for rejected actions. |

---

## 🧮 5. Server-Side Authoritative Scoring Algorithm

Scores are computed **strictly on the server** based on answer correctness and the server's measured elapsed time:

$$\text{Total Score} = \begin{cases} 0 & \text{if answer is incorrect} \\ 500 + \text{round}\left(\frac{\text{totalTimeLimitMs} - \text{timeTakenMs}}{\text{totalTimeLimitMs}} \times 500\right) & \text{if answer is correct} \end{cases}$$

```javascript
// sockets/scoring.js
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  
  const clampedTimeTaken = Math.min(Math.max(0, Number(timeTakenMs) || 0), totalTimeLimitMs);
  const timeRemaining = Math.max(0, totalTimeLimitMs - clampedTimeTaken);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500); // Up to 500 bonus points
  const baseScore = 500;
  
  return baseScore + speedBonus; // Total max 1000 points per question
}
```

### 📝 Worked Example:
- Total Question Time Limit: `15,000 ms`
- Server-Measured Elapsed Time: `3,200 ms`
- Time Remaining: $15,000 - 3,200 = 11,800\text{ ms}$
- Speed Bonus: $\text{round}\left(\frac{11,800}{15,000} \times 500\right) = \text{round}(393.33) = 393\text{ pts}$
- Final Round Score: $500 + 393 = \mathbf{893\text{ pts}}$

---

## 🏛️ 6. System Architecture & State Machine

```
               [Host: quiz:create]
                       ⬇
                  [Room: lobby] ⬅ (Players: quiz:join)
                       ⬇
               [Host: quiz:start]
                       ⬇
               [state: in_progress]
                       ⬇
          ┌──> [state: question_active] ──── (15s Server Timer & answer:submit)
          │            ⬇
          │    [state: question_reveal] ─── (Broadcast time_up & leaderboard:update)
          │            ⬇
   More   │    [Host: question:next]
Questions └─── Yes /   \ No
                       ⬇
               [state: ended] ─────────────── (Broadcast winner & 60s memory cleanup)
```

### Architectural Guarantees:
1. **Zero Client-Side Drift:** Client countdown timers are visual indicators. The server's `setTimeout` clock is authoritative.
2. **Anti-Cheat Clock Authority:** Submissions exceeding the question time limit on the server's clock are rejected with `error:message`, preventing packet delay or client-reported timestamp manipulation.
3. **Deterministic Tie-Breaking:** If two players share identical scores, ties are deterministically resolved alphabetically by name.
4. **Disconnect Tolerance:** If the host drops, a 30s grace period pauses termination to allow page reloads. If a player disconnects, their cumulative score is preserved, allowing seamless reconnection.
5. **In-Memory Concurrency:** Active rooms live in an in-memory Map structure (`sockets/roomStore.js`), optimized for single-instance WebSockets without database latency.

---

## 📁 7. Project Directory Structure

```text
Kartik_Wagh/
├── .env.example             # Sample environment variables
├── .env                     # Local environment file (git-ignored)
├── .gitignore               # Ignored dependencies and runtime logs
├── package.json             # NPM dependencies, scripts, and engine requirements
├── server.js                # Express & Socket.io server entry point with /health
├── README.md                # Comprehensive project documentation
├── data/
│   └── questions.json       # Multi-category trivia question bank
├── sockets/
│   ├── scoring.js           # Authoritative calculateScore function
│   ├── roomStore.js         # In-memory shared room registry & utility helpers
│   ├── lobbyHandler.js      # PIN generation, room creation & player joining
│   └── gameEngine.js        # State machine, synchronous clocks & leaderboard sorting
├── scripts/
│   └── socketSmokeTest.js   # Automated end-to-end unit and socket test suite
└── public/
    ├── index.html           # Mode selection portal (Host vs Player)
    ├── host.html            # Host presentation dashboard
    ├── player.html          # Mobile-friendly 4-color gamepad interface
    ├── style.css            # Unified modern stylesheet (Dark/Vibrant theme)
    ├── app.js               # Shared client socket helpers & toast notifications
    ├── host.js              # Host screen state & event handlers
    └── player.js            # Player gamepad state & event handlers
```

---

## 🧪 8. Testing & Verification

### Automated Smoke Tests
Run the end-to-end automated test suite:
```bash
npm test
```
The test suite validates:
1. **Scoring Unit Tests:** Direct assertions on `calculateScore` across instant, half-time, last-second, incorrect, and over-limit inputs.
2. **Room & PIN Generation:** Host creates room and receives a valid 4-digit PIN.
3. **Lobby Updates:** Multiple players join and are broadcast to the roster.
4. **Duplicate Name Prevention:** Third player trying to use an existing name is rejected.
5. **Authorization Security:** Non-host socket attempting `quiz:start` is rejected.
6. **Anti-Cheat Payload Sanitization:** Verifies `question:start` payload contains no `correctOption` or `explanation`.
7. **Speed Scoring Verification:** Verifies fast answering player scores higher than slow answering player.
8. **Anti-Duplicate Submission:** Rejects duplicate answers for the same round.
9. **Full Progression:** Host advances through all rounds to `quiz:ended`.

### Manual Multi-Tab Verification Guide
1. Start the server: `npm start` (Runs on `http://localhost:5000`).
2. Open **Host View** in Tab 1: `http://localhost:5000/host.html`. Enter Host Name, select a category, and click **Create Quiz Room**. Note the 4-digit PIN.
3. Open **Player View** in Tab 2 and Tab 3: `http://localhost:5000/player.html`. Enter the PIN and nicknames **"Player 1"** and **"Player 2"**.
4. Confirm both names appear on the Host Lobby screen.
5. In Tab 1 (Host), click **Start Game**.
6. On Tab 2 (Player 1), tap an answer **immediately** (~1s).
7. On Tab 3 (Player 2), wait **8-10 seconds** before tapping the same answer.
8. When the timer expires, verify on Tab 1 that **Player 1 is ranked #1 with higher points** than Player 2 due to the speed bonus.
9. Click **Next Question** on the Host screen to progress through remaining rounds until the final winner podium appears.

---

## ☁️ 9. Deployment on Render

This application is ready to deploy on **Render Web Service** with zero database setup.

### Render Configuration
| Setting | Value |
|---|---|
| **Service Type** | Web Service |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Health Check Path** | `/health` |
| **Environment Variables** | `NODE_ENV = production`<br>`CORS_ORIGIN = *` |

DEPLOYMENT LINK :
https://assignment-14-realtime-quiz-platform-hipk.onrender.com/
