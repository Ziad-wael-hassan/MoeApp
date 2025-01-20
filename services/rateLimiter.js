const rateLimitMap = new Map();
const RATE_LIMIT = { WINDOW_MS: 60000, MAX_REQUESTS: 5 };

export function isRateLimited(chatId, handler) {
  const now = Date.now();
  const userRequests = rateLimitMap.get(chatId) || [];

  const validRequests = userRequests.filter(
    (time) => now - time < RATE_LIMIT.WINDOW_MS,
  );

  if (validRequests.length >= RATE_LIMIT.MAX_REQUESTS) {
    handler.stats.rateLimitHits++;
    return true;
  }

  validRequests.push(now);
  rateLimitMap.set(chatId, validRequests);
  return false;
}
