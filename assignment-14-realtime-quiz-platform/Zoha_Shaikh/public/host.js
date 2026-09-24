/**
 * Host Screen Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = window.initSocket();

  // State
  let currentPin = null;
  let currentOptions = [];
  let totalQuestions = 0;
  let timerInterval = null;
  let activePlayerCount = 0;

  // Shapes & Icons for 4 Options
  const OPTION_SHAPES = ['▲', '◆', '●', '■'];

  // DOM Elements - Views
  const viewCreate = document.getElementById('view-create');
  const viewLobby = document.getElementById('view-lobby');
  const viewQuestion = document.getElementById('view-question');
  const viewReveal = document.getElementById('view-reveal');
  const viewGameOver = document.getElementById('view-gameover');

  // DOM Elements - Create Form
  const formCreateQuiz = document.getElementById('form-create-quiz');
  const inputHostName = document.getElementById('input-host-name');
  const selectCategory = document.getElementById('select-category');

  // DOM Elements - Lobby
  const hostRoomInfo = document.getElementById('host-room-info');
  const headerPinVal = document.getElementById('header-pin-val');
  const displayPin = document.getElementById('display-pin');
  const lobbyCategoryBadge = document.getElementById('lobby-category-badge');
  const lobbyRoster = document.getElementById('lobby-roster');
  const playerCountSpan = document.getElementById('player-count');
  const btnPlayerCount = document.getElementById('btn-player-count');
  const btnStartGame = document.getElementById('btn-start-game');

  // DOM Elements - Active Question
  const badgeQuestionNum = document.getElementById('badge-question-num');
  const answerCountVal = document.getElementById('answer-count-val');
  const answerTotalVal = document.getElementById('answer-total-val');
  const hostTimer = document.getElementById('host-timer');
  const hostQuestionText = document.getElementById('host-question-text');
  const hostOptionsContainer = document.getElementById('host-options-container');

  // DOM Elements - Reveal & Standings
  const btnNextQuestion = document.getElementById('btn-next-question');
  const revealCorrectText = document.getElementById('reveal-correct-text');
  const revealExplanationText = document.getElementById('reveal-explanation-text');
  const hostLeaderboardList = document.getElementById('host-leaderboard-list');

  // DOM Elements - Game Over
  const finalWinnerName = document.getElementById('final-winner-name');
  const finalWinnerScore = document.getElementById('final-winner-score');
  const finalRanksList = document.getElementById('final-ranks-list');
  const btnHostRestart = document.getElementById('btn-host-restart');

  /**
   * Helper: Switch visible section
   */
  function showView(viewToShow) {
    [viewCreate, viewLobby, viewQuestion, viewReveal, viewGameOver].forEach(view => {
      if (view) view.style.display = 'none';
    });
    if (viewToShow) viewToShow.style.display = 'block';
  }

  /**
   * Fetch available categories from server
   */
  fetch('/api/categories')
    .then(res => res.json())
    .then(data => {
      if (data && data.categories) {
        selectCategory.innerHTML = '';
        data.categories.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat;
          opt.textContent = cat === 'All' ? 'All Categories (Random Mix)' : cat;
          selectCategory.appendChild(opt);
        });
      }
    })
    .catch(err => console.warn('[Host] Could not fetch categories:', err));

  /**
   * 1. Create Room Form Submit
   */
  formCreateQuiz.addEventListener('submit', (e) => {
    e.preventDefault();
    const hostName = inputHostName.value.trim();
    const category = selectCategory.value;

    if (!hostName) {
      window.showToast('Please enter a host name.', 'error');
      return;
    }

    socket.emit('quiz:create', { hostName, category });
  });

  /**
   * 2. Room Created by Server
   */
  socket.on('quiz:created', (data) => {
    currentPin = data.pin;
    totalQuestions = data.totalQuestions || 0;

    displayPin.textContent = data.pin;
    headerPinVal.textContent = data.pin;
    hostRoomInfo.style.display = 'inline-flex';
    lobbyCategoryBadge.textContent = (data.category || 'ALL').toUpperCase();

    showView(viewLobby);
    window.showToast(`Quiz room created with PIN ${data.pin}!`, 'success');
  });

  /**
   * 3. Lobby Roster Update
   */
  socket.on('lobby:update', (data) => {
    const players = (data && data.players) || [];
    activePlayerCount = players.length;

    playerCountSpan.textContent = players.length;
    btnPlayerCount.textContent = players.length;

    if (players.length === 0) {
      lobbyRoster.innerHTML = `<p id="empty-roster-msg" style="color: var(--text-muted); font-style: italic;">Waiting for players to join with the PIN...</p>`;
      btnStartGame.disabled = true;
    } else {
      lobbyRoster.innerHTML = '';
      players.forEach(p => {
        const chip = document.createElement('div');
        chip.className = 'player-chip';
        chip.innerHTML = `<span>🎮</span> <span>${window.escapeHtml(p.name)}</span>`;
        lobbyRoster.appendChild(chip);
      });
      btnStartGame.disabled = false;
    }
  });

  /**
   * 4. Start Game Button Click
   */
  btnStartGame.addEventListener('click', () => {
    if (!currentPin) return;
    socket.emit('quiz:start', { pin: currentPin });
  });

  /**
   * 5. Question Round Start
   */
  socket.on('question:start', (data) => {
    currentOptions = data.options || [];
    badgeQuestionNum.textContent = `Question ${data.questionIndex} / ${data.totalQuestions}`;
    hostQuestionText.textContent = data.question;

    answerCountVal.textContent = '0';
    answerTotalVal.textContent = activePlayerCount.toString();

    // Render Options Grid (No correct answer indicator)
    hostOptionsContainer.innerHTML = '';
    currentOptions.forEach((optText, index) => {
      const optDiv = document.createElement('div');
      optDiv.className = `host-option-item opt-${index}`;
      optDiv.id = `host-option-${index}`;
      optDiv.innerHTML = `
        <span class="option-icon">${OPTION_SHAPES[index] || ''}</span>
        <span>${window.escapeHtml(optText)}</span>
      `;
      hostOptionsContainer.appendChild(optDiv);
    });

    // Start Cosmetic Countdown Timer
    let remaining = Number(data.timeLimitSeconds) || 15;
    hostTimer.textContent = remaining;
    hostTimer.classList.remove('warning');

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        remaining = 0;
      }
      hostTimer.textContent = remaining;
      if (remaining <= 5) {
        hostTimer.classList.add('warning');
      }
    }, 1000);

    showView(viewQuestion);
  });

  /**
   * 6. Live Answer Count Update
   */
  socket.on('host:answerCount', (data) => {
    if (data) {
      answerCountVal.textContent = data.count || 0;
      answerTotalVal.textContent = data.totalPlayers || activePlayerCount;
    }
  });

  /**
   * 7. Question Time Up & Answer Reveal
   */
  socket.on('question:time_up', (data) => {
    if (timerInterval) clearInterval(timerInterval);

    const correctIndex = data.correctOption;
    const correctText = currentOptions[correctIndex] || `Option ${correctIndex + 1}`;

    revealCorrectText.textContent = `${OPTION_SHAPES[correctIndex]} ${correctText}`;
    revealExplanationText.textContent = data.explanation || '';

    // Highlight on question options
    currentOptions.forEach((_, idx) => {
      const el = document.getElementById(`host-option-${idx}`);
      if (el) {
        if (idx === correctIndex) {
          el.classList.add('is-correct');
          el.classList.remove('is-dimmed');
        } else {
          el.classList.add('is-dimmed');
          el.classList.remove('is-correct');
        }
      }
    });

    // Switch view to reveal and leaderboard
    showView(viewReveal);
  });

  /**
   * 8. Leaderboard Update
   */
  socket.on('leaderboard:update', (data) => {
    const list = (data && data.leaderboard) || [];
    renderLeaderboard(hostLeaderboardList, list);
  });

  /**
   * 9. Advance to Next Question
   */
  btnNextQuestion.addEventListener('click', () => {
    if (!currentPin) return;
    socket.emit('question:next', { pin: currentPin });
  });

  /**
   * 10. Quiz Ended
   */
  socket.on('quiz:ended', (data) => {
    if (timerInterval) clearInterval(timerInterval);

    if (data.winner) {
      finalWinnerName.textContent = data.winner.name;
      finalWinnerScore.textContent = `${data.winner.score} pts`;
    } else {
      finalWinnerName.textContent = 'No winner';
      finalWinnerScore.textContent = '0 pts';
    }

    renderLeaderboard(finalRanksList, data.finalRanks || []);
    showView(viewGameOver);
  });

  /**
   * 11. Restart Quiz
   */
  btnHostRestart.addEventListener('click', () => {
    window.location.reload();
  });

  /**
   * Helper: Render Leaderboard Table
   */
  function renderLeaderboard(container, leaderboard) {
    container.innerHTML = '';
    if (!leaderboard || leaderboard.length === 0) {
      container.innerHTML = '<p style="color: var(--text-muted); text-align: center;">No scores recorded yet.</p>';
      return;
    }

    leaderboard.forEach(item => {
      const rankBadge = item.rank === 1 ? '🥇 1' : (item.rank === 2 ? '🥈 2' : (item.rank === 3 ? '🥉 3' : `#${item.rank}`));
      const rankClass = item.rank <= 3 ? `rank-${item.rank}` : '';

      const row = document.createElement('div');
      row.className = `leaderboard-item ${rankClass}`;
      row.innerHTML = `
        <div class="leaderboard-rank">${rankBadge}</div>
        <div class="leaderboard-name">${window.escapeHtml(item.name)}</div>
        <div class="leaderboard-score">${item.score} pts</div>
      `;
      container.appendChild(row);
    });
  }
});
