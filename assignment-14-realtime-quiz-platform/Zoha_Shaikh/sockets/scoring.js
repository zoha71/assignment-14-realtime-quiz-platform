/**
 * Server-Side Authoritative Scoring Algorithm
 * 
 * Formula:
 * - Incorrect answer: 0 points
 * - Correct answer: Base Score (500 pts) + Speed Bonus (up to 500 pts based on server-measured remaining time)
 * - Maximum possible score per question: 1000 points
 * 
 * @param {boolean} isCorrect - Whether the submitted answer matches the correct option
 * @param {number} timeTakenMs - Authoritative server-measured elapsed time in milliseconds
 * @param {number} totalTimeLimitMs - Total question time limit in milliseconds (default 15000ms)
 * @returns {number} Points awarded (0 - 1000)
 */
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;

  // Defensive clamping to [0, totalTimeLimitMs]
  const clampedTimeTaken = Math.min(Math.max(0, Number(timeTakenMs) || 0), totalTimeLimitMs);

  const timeRemaining = Math.max(0, totalTimeLimitMs - clampedTimeTaken);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500); // Up to 500 bonus points
  const baseScore = 500;

  return baseScore + speedBonus; // Total max 1000 points per question
}

module.exports = {
  calculateScore
};
