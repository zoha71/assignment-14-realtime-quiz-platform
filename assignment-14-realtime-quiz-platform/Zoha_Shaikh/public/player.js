/**
 * Player Screen Logic - 4-Color Gamepad Interface
 */

document.addEventListener('DOMContentLoaded', () => {
  const socket = window.initSocket();

  // State
  let currentPin = '';
  let myPlayerName = '';
  let myScore = 0;
  let selectedOption = null;
  let questionStartLocalTime = 0;
  let timerInterval = null;
  let lastPointsAwarded = 0;

  // DOM Elements - Views
  const viewJoin = document.getElementById('player-view-join');
  const viewLobby = document.getElementById('player-view-lobby');
  const viewGamepad = document.getElementById('player-view-gamepad');
  const viewFeedback = document.getElementById('player-view-feedback');
  const viewGameOver = document.getElementById('player-view-gameover');

  // DOM Elements - Header
  const playerStatusBadge = document.getElementById('player-status-badge');
  const playerScoreBadge = document.getElementById('player-score-badge');
  const headerPlayerName = document.getElementById('header-player-name');
  const headerPlayerScore = document.getElementById('header-player-score');

  // DOM Elements - Join Form
  const formJoin = document.getElementById('form-join-game');
  const inputPin = document.getElementById('input-pin');
  const inputPlayerName = document.getElementById('input-player-name');

  // DOM Elements - Lobby
  const playerLobbyRoster = document.getElementById('player-lobby-roster');

  // DOM Elements - Gamepad
  const playerQNum = document.getElementById('player-q-num');
  const playerTimerBadge = document.getElementById('player-timer-badge');
  const playerQPrompt = document.getElementById('player-q-prompt');
  const playerLockedIndicator = document.getElementById('player-locked-indicator');
  const gamepadBtns = [
    document.getElementById('btn-opt-0'),
    document.getElementById('btn-opt-1'),
    document.getElementById('btn-opt-2'),
    document.getElementById('btn-opt-3')
  ];
  const labelOpts = [
    document.getElementById('label-opt-0'),
    document.getElementById('label-opt-1'),
    document.getElementById('label-opt-2'),
    document.getElementById('label-opt-3')
  ];

  // DOM Elements - Feedback
  const feedbackBanner = document.getElementById('feedback-banner');
  const feedbackIcon = document.getElementById('feedback-icon');
  const feedbackTitle = document.getElementById('feedback-title');
  const feedbackPoints = document.getElementById('feedback-points');
  const feedbackMsg = document.getElementById('feedback-msg');
  const playerPersonalRank = document.getElementById('player-personal-rank');
  const playerCumulativeScore = document.getElementById('player-cumulative-score');

  // DOM Elements - Game Over
  const playerFinalIcon = document.getElementById('player-final-icon');
  const playerFinalHeading = document.getElementById('player-final-heading');
  const playerFinalRankBadge = document.getElementById('player-final-rank-badge');
  const playerFinalTotalScore = document.getElementById('player-final-total-score');
  const playerWinnerDeclaration = document.getElementById('player-winner-declaration');
  const btnPlayerReplay = document.getElementById('btn-player-replay');

  /**
   * Helper: Switch visible section
   */
  function showView(viewToShow) {
    [viewJoin, viewLobby, viewGamepad, viewFeedback, viewGameOver].forEach(view => {
      if (view) view.style.display = 'none';
    });
    if (viewToShow) viewToShow.style.display = 'block';
  }

  /**
   * 1. Join Game Form Submission
   */
  formJoin.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = inputPin.value.trim();
    const name = inputPlayerName.value.trim();

    if (!pin || pin.length !== 4) {
      window.showToast('Please enter a valid 4-digit PIN.', 'error');
      return;
    }
    if (!name) {
      window.showToast('Please enter your nickname.', 'error');
      return;
    }

    currentPin = pin;
    myPlayerName = name;

    socket.emit('quiz:join', { pin, playerName: name });
  });

  /**
   * 2. Successfully Joined Lobby
   */
  socket.on('quiz:joined', (data) => {
    headerPlayerName.textContent = data.playerName;
    headerPlayerScore.textContent = data.currentScore || 0;
    playerStatusBadge.style.display = 'inline-flex';
    playerScoreBadge.style.display = 'inline-flex';

    showView(viewLobby);
    window.showToast(`Joined lobby PIN ${data.pin}!`, 'success');
  });

  /**
   * 3. Lobby Roster Update
   */
  socket.on('lobby:update', (data) => {
    const players = (data && data.players) || [];
    playerLobbyRoster.innerHTML = '';
    players.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'badge';
      chip.style.fontSize = '0.9rem';
      chip.innerHTML = `${p.name === myPlayerName ? '⭐ ' : '🎮 '}${window.escapeHtml(p.name)}`;
      playerLobbyRoster.appendChild(chip);
    });
  });

  /**
   * 4. Question Round Start
   */
  socket.on('question:start', (data) => {
    selectedOption = null;
    lastPointsAwarded = 0;
    questionStartLocalTime = Date.now();

    playerQNum.textContent = `Q${data.questionIndex} / ${data.totalQuestions}`;
    playerQPrompt.textContent = data.question || 'Select your answer!';

    // Reset and enable gamepad buttons
    gamepadBtns.forEach((btn, index) => {
      btn.disabled = false;
      btn.classList.remove('selected');
      if (labelOpts[index]) {
        labelOpts[index].textContent = (data.options && data.options[index]) ? data.options[index] : `Option ${index + 1}`;
      }
    });

    playerLockedIndicator.style.display = 'none';

    // Start cosmetic countdown timer
    let remaining = Number(data.timeLimitSeconds) || 15;
    playerTimerBadge.textContent = `⏱️ ${remaining}s`;

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        remaining = 0;
        // Lock buttons if time runs out
        gamepadBtns.forEach(btn => btn.disabled = true);
      }
      playerTimerBadge.textContent = `⏱️ ${remaining}s`;
    }, 1000);

    showView(viewGamepad);
  });

  /**
   * 5. Gamepad Button Taps
   */
  gamepadBtns.forEach((btn, index) => {
    btn.addEventListener('click', () => {
      if (selectedOption !== null || btn.disabled) return;

      const timeTakenMs = Date.now() - questionStartLocalTime;
      selectedOption = index;

      // Immediately lock buttons to prevent duplicate taps
      gamepadBtns.forEach(b => b.disabled = true);
      btn.classList.add('selected');
      playerLockedIndicator.style.display = 'block';

      // Emit answer to authoritative server
      socket.emit('answer:submit', {
        pin: currentPin,
        selectedOption: index,
        timeTakenMs: timeTakenMs
      });
    });
  });

  /**
   * 6. Private Answer Accepted Acknowledgment
   */
  socket.on('answer:accepted', (data) => {
    lastPointsAwarded = data.pointsAwarded || 0;
  });

  /**
   * 7. Round Time Up & Feedback Reveal
   */
  socket.on('question:time_up', (data) => {
    if (timerInterval) clearInterval(timerInterval);

    const correctIndex = data.correctOption;

    if (selectedOption === null) {
      // Player did not answer in time
      feedbackBanner.className = 'player-feedback-card incorrect';
      feedbackIcon.textContent = '⏳';
      feedbackTitle.textContent = "TIME'S UP!";
      feedbackPoints.textContent = '+0 pts';
      feedbackMsg.textContent = 'You ran out of time to answer.';
    } else if (selectedOption === correctIndex) {
      // Correct Answer!
      feedbackBanner.className = 'player-feedback-card correct';
      feedbackIcon.textContent = '🎉';
      feedbackTitle.textContent = 'CORRECT!';
      feedbackPoints.textContent = `+${lastPointsAwarded} pts`;
      feedbackMsg.textContent = 'Awesome speed! Points added to your total.';
    } else {
      // Incorrect Answer
      feedbackBanner.className = 'player-feedback-card incorrect';
      feedbackIcon.textContent = '❌';
      feedbackTitle.textContent = 'INCORRECT';
      feedbackPoints.textContent = '+0 pts';
      feedbackMsg.textContent = 'Better luck next question!';
    }

    showView(viewFeedback);
  });

  /**
   * 8. Leaderboard Update
   */
  socket.on('leaderboard:update', (data) => {
    const list = (data && data.leaderboard) || [];
    const myEntry = list.find(p => p.name.toLowerCase() === myPlayerName.toLowerCase());

    if (myEntry) {
      myScore = myEntry.score;
      headerPlayerScore.textContent = myScore;
      playerPersonalRank.textContent = `Rank #${myEntry.rank} of ${list.length}`;
      playerCumulativeScore.textContent = `Total Score: ${myScore} pts`;
    }
  });

  /**
   * 9. Quiz Ended - Final Winner
   */
  socket.on('quiz:ended', (data) => {
    if (timerInterval) clearInterval(timerInterval);

    const finalRanks = data.finalRanks || [];
    const myFinal = finalRanks.find(p => p.name.toLowerCase() === myPlayerName.toLowerCase());
    const isWinner = data.winner && data.winner.name.toLowerCase() === myPlayerName.toLowerCase();

    if (isWinner) {
      playerFinalIcon.textContent = '👑';
      playerFinalHeading.textContent = 'VICTORY! You Won!';
      playerFinalRankBadge.textContent = '🏆 1st Place Champion';
    } else if (myFinal) {
      playerFinalIcon.textContent = '🎖️';
      playerFinalHeading.textContent = 'Battle Concluded';
      playerFinalRankBadge.textContent = `Final Rank: #${myFinal.rank}`;
    }

    playerFinalTotalScore.textContent = `${myScore} pts`;
    playerWinnerDeclaration.textContent = data.winner
      ? `Winner: ${data.winner.name} (${data.winner.score} pts)`
      : 'No overall winner.';

    showView(viewGameOver);
  });

  /**
   * 10. Play Again Button
   */
  btnPlayerReplay.addEventListener('click', () => {
    window.location.reload();
  });
});
