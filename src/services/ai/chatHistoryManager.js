const userChatHistories = new Map();

export const ChatHistoryManager = {
  // Add a message to a user's chat history
  addToHistory(userId, role, text) {
    if (!userChatHistories.has(userId)) {
      userChatHistories.set(userId, []);
    }
    
    const userHistory = userChatHistories.get(userId);
    userHistory.push({
      role: role,
      parts: [{ text: text }]
    });

    // Limit history size to prevent excessive memory usage
    if (userHistory.length > 10) {
      userHistory.shift(); // Remove the oldest message
    }
  },

  // Get chat history for a specific user
  getHistory(userId) {
    return userChatHistories.get(userId) || [];
  },

  // Clear chat history for a specific user
  clearHistory(userId) {
    userChatHistories.delete(userId);
  },

  // Clear all user histories (e.g., when AI is toggled off)
  clearAllHistories() {
    userChatHistories.clear();
  }
};
