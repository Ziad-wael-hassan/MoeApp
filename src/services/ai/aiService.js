import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { AI_CONFIG } from "../../config/aiConfig.js";

export class AIService {
  constructor(apiKey, chatHistoryService) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: AI_CONFIG.model.name,
      generationConfig: AI_CONFIG.model.config,
    });
    this.chatHistoryService = chatHistoryService;
  }

  async generateResponse(userMessage, userId) {
    try {
      const chatHistory = this.chatHistoryService.getHistory(userId);

      const chatSession = this.model.startChat({
        history: chatHistory,
        responseSchema: AI_CONFIG.prompt.responseSchema,
      });

      const result = await chatSession.sendMessage(
        `${AI_CONFIG.prompt.base}\n\n${JSON.stringify(AI_CONFIG.prompt.examples, null, 2)}\n\nUser: "${userMessage}"`,
      );

      return this.processResponse(result, userMessage, userId);
    } catch (error) {
      logger.error("AI generation error:", error);
      return this.getErrorResponse();
    }
  }

  processResponse(result, userMessage, userId) {
    try {
      const responseText = result.response.text().trim();
      const parsedResponse = JSON.parse(responseText);

      this.chatHistoryService.addMessage(userId, "user", userMessage);
      this.chatHistoryService.addMessage(
        userId,
        "model",
        parsedResponse.response,
      );

      return {
        response: parsedResponse.response || "خليك كده متكلمنيش 🙄",
        command: parsedResponse.command || null,
        terminate: Boolean(parsedResponse.terminate),
      };
    } catch (error) {
      logger.error("Response processing error:", error);
      return this.getErrorResponse();
    }
  }

  getErrorResponse() {
    return {
      response: "مش ناقصه صداع بقا",
      command: "!toggleai",
      terminate: true,
    };
  }
}
