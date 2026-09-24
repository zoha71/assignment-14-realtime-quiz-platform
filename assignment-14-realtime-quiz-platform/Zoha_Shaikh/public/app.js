/**
 * Shared Client Utilities & Socket Initialization
 */

// Global Socket Instance
let socket = null;

/**
 * Initializes same-origin Socket.io connection
 * @returns {import('socket.io-client').Socket}
 */
function initSocket() {
  if (socket) return socket;

  // Same-origin connection (auto connects to window.location.origin)
  socket = io();

  socket.on('connect', () => {
    console.log('[Socket] Connected with ID:', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
    if (reason === 'io server disconnect') {
      socket.connect();
    }
  });

  // Global Error Handler
  socket.on('error:message', (data) => {
    const msg = (data && data.message) ? data.message : 'An unexpected error occurred.';
    showToast(msg, 'error');
  });

  return socket;
}

/**
 * Displays a toast notification in the UI
 * @param {string} message - Message to display
 * @param {'error' | 'success' | 'info'} type - Toast type
 * @param {number} duration - Display duration in ms (default 4000ms)
 */
function showToast(message, type = 'error', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : (type === 'info' ? 'ℹ️' : '⚠️');
  toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, duration);
}

/**
 * Escapes HTML characters to prevent XSS
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Attach utilities to window for global access
window.initSocket = initSocket;
window.showToast = showToast;
window.escapeHtml = escapeHtml;
