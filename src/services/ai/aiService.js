import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

export async function generateAIResponse(prompt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    logger.error("AI generation error:", error);
    throw new Error("Failed to generate AI response");
  }
}
