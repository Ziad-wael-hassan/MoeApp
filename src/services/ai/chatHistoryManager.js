// src/services/chat/chatHistoryManager.js
export const ChatHistoryManager = {
  // Internal storage for chat histories
  histories: new Map(),
  maxHistorySize: 10,

  // Add a message to a user's chat history
  addToHistory(userId, role, text) {
    if (!this.histories.has(userId)) {
      this.histories.set(userId, []);
    }

    const userHistory = this.histories.get(userId);
    userHistory.push({
      role: role,
      parts: [{ text: text }]
    });

    // Limit history size to prevent excessive memory usage
    if (userHistory.length > this.maxHistorySize) {
      userHistory.shift(); // Remove oldest message
    }
  },

  // Get chat history for a specific user
  getHistory(userId) {
    return this.histories.get(userId) || [];
  },

  // Clear chat history for a specific user
  clearHistory(userId) {
    this.histories.delete(userId);
  },

  // Clear all user histories
  clearAllHistories() {
    this.histories.clear();
  }
};
