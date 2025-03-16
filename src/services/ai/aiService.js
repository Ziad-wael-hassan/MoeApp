import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { AI_CONFIG, buildPrompt } from "../../config/aiConfig.js";

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000, // Start with 1 second delay
  maxDelay: 5000, // Maximum delay of 5 seconds
  backoffFactor: 2, // Exponential backoff multiplier
  // Status codes that are worth retrying
  retryableStatusCodes: new Set([
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
  ]),
};

// Helper function for delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Calculate exponential backoff delay
function calculateBackoffDelay(retryCount) {
  const backoffDelay =
    RETRY_CONFIG.initialDelay *
    Math.pow(RETRY_CONFIG.backoffFactor, retryCount);
  return Math.min(backoffDelay, RETRY_CONFIG.maxDelay);
}

// Check if error is retryable
function isRetryableError(error) {
  // Check if it's a network error
  if (!error.message.includes("[GoogleGenerativeAI Error]")) {
    return true;
  }

  // Extract status code from error message if possible
  const statusCodeMatch = error.message.match(/\[(\d{3})/);
  if (statusCodeMatch) {
    const statusCode = parseInt(statusCodeMatch[1]);
    return RETRY_CONFIG.retryableStatusCodes.has(statusCode);
  }

  return false;
}

async function sendMessageWithRetry(chatSession, message, retryCount = 0) {
  try {
    return await chatSession.sendMessage(message);
  } catch (error) {
    if (retryCount >= RETRY_CONFIG.maxRetries || !isRetryableError(error)) {
      throw error;
    }

    const backoffDelay = calculateBackoffDelay(retryCount);
    logger.warn(
      `Attempt ${retryCount + 1} failed. Retrying in ${backoffDelay}ms...`,
      {
        error: error.message,
        retryCount,
        backoffDelay,
      },
    );

    await delay(backoffDelay);
    return sendMessageWithRetry(chatSession, message, retryCount + 1);
  }
}

export async function generateAIResponse(userMessage, userId, context = {}) {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model.name,
    generationConfig: AI_CONFIG.model.config,
  });

  try {
    // Get the user's chat history
    const chatHistory = getChatHistory(userId);

    // Build the complete prompt with context
    const promptContext = {
      currentTime: new Date().toISOString(),
      chatHistory: chatHistory,
      quotedMessage: context.quotedMessage,
      isPrivateChat: context.isPrivateChat,
    };

    const fullPrompt = buildPrompt(promptContext);

    const chatSession = model.startChat({
      history: chatHistory,
      responseSchema: AI_CONFIG.prompt.responseSchema,
    });

    // Use the retry wrapper for sending messages
    const result = await sendMessageWithRetry(
      chatSession,
      `${fullPrompt}\n\nUser: "${userMessage}"`,
    );

    return processResponse(result, userMessage, userId);
  } catch (error) {
    logger.error(
      {
        err: error,
        userId,
        message: userMessage,
        retryAttempts: RETRY_CONFIG.maxRetries,
      },
      "AI generation error after all retries",
    );

    return getErrorResponse(error);
  }
}

// Chat history management
const userChatHistories = new Map();

function getChatHistory(userId) {
  return userChatHistories.get(userId) || [];
}

function addToHistory(userId, role, text) {
  if (!userChatHistories.has(userId)) {
    userChatHistories.set(userId, []);
  }

  const history = userChatHistories.get(userId);
  history.push({
    role,
    parts: [{ text }],
  });

  // Limit history size
  if (history.length > 10) {
    history.shift();
  }
}

function processResponse(result, userMessage, userId) {
  try {
    const responseText = result.response.text().trim();
    const parsedResponse = JSON.parse(responseText);

    // Add to chat history
    addToHistory(userId, "user", userMessage);
    addToHistory(userId, "model", parsedResponse.response);

    return {
      response: parsedResponse.response || "خليك كده متكلمنيش 🙄",
      command: parsedResponse.command || null,
      terminate: Boolean(parsedResponse.terminate),
    };
  } catch (error) {
    logger.error("Response processing error:", error);
    return getErrorResponse(error);
  }
}

// Enhanced error response function with more specific messages
function getErrorResponse(error) {
  let errorMessage = "مش ناقصه صداع بقا";

  if (error) {
    if (error.message.includes("502")) {
      errorMessage = "الخدمة مش شغالة دلوقتي جرب تاني بعد شوية";
    } else if (error.message.includes("429")) {
      errorMessage = "استني شوية عشان في ناس كتير بتكلمني";
    } else if (error.message.includes("timeout")) {
      errorMessage = "الرد بطيء شوية جرب تاني";
    }
  }

  return {
    response: errorMessage,
    command: null,
    terminate: false,
  };
}
