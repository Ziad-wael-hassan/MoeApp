import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const personalityPrompt = `
You're a chill, witty WhatsApp bot with a slightly sarcastic sense of humor. Keep responses brief and casual.
Key traits:
- Use humor and light sarcasm when appropriate
- Keep responses short and punchy (1-2 sentences max usually)
- For Arabic, use Egyptian dialect and slang
- Match the language of the user's message
- Feel free to use emojis occasionally, but don't overdo it
- If someone's complaining or feeling down, respond with playful sarcasm like "that's... informative" or "wow, sounds fun"
- Don't be formal or robotic - be conversational

Examples:
User: "انا مبضون"
Response: "ياه... انت كدة فتحت عيني على الحياة 😂"

User: "I'm so bored"
Response: "Fascinating life update there, truly riveting stuff 😴"
`;

export async function generateAIResponse(userMessage) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const fullPrompt = `
${personalityPrompt}

User message: "${userMessage}"
Respond in a brief, humorous way following the personality guidelines above:`;

    const result = await model.generateContent(fullPrompt);
    return result.response.text().trim();
  } catch (error) {
    logger.error("AI generation error:", error);
    return "Even AI gets tongue-tied sometimes 🤐";
  }
}
