export class ChatHistoryService {
  constructor(maxHistorySize = 10) {
    this.histories = new Map();
    this.maxHistorySize = maxHistorySize;
  }

  addMessage(userId, role, text) {
    if (!this.histories.has(userId)) {
      this.histories.set(userId, []);
    }

    const history = this.histories.get(userId);
    history.push({
      role,
      parts: [{ text }],
    });

    if (history.length > this.maxHistorySize) {
      history.shift();
    }
  }

  getHistory(userId) {
    return this.histories.get(userId) || [];
  }

  clearHistory(userId) {
    this.histories.delete(userId);
  }

  clearAllHistories() {
    this.histories.clear();
  }
}
