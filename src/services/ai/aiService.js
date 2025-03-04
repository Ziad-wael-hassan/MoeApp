import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { AI_CONFIG } from "../../config/aiConfig.js";

export async function generateAIResponse(userMessage, userId) {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model.name,
    generationConfig: AI_CONFIG.model.config,
  });

  try {
    // Get the user's chat history
    const chatHistory = getChatHistory(userId);

    const chatSession = model.startChat({
      history: chatHistory,
      responseSchema: AI_CONFIG.prompt.responseSchema,
    });

    const result = await chatSession.sendMessage(
      `${AI_CONFIG.prompt.base}\n\n${JSON.stringify(AI_CONFIG.prompt.examples, null, 2)}\n\nUser: "${userMessage}"`,
    );

    return processResponse(result, userMessage, userId);
  } catch (error) {
    logger.error("AI generation error:", error);
    return getErrorResponse();
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
    return getErrorResponse();
  }
}

// Add the missing getErrorResponse function
function getErrorResponse() {
  return {
    response: "مش ناقصه صداع بقا",
    command: null,
    terminate: false,
  };
}
