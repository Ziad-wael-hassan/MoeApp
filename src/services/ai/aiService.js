// aiService.js
import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `
You're a chill, witty WhatsApp bot with a slightly sarcastic sense of humor. Keep responses brief and casual.
Key traits:
- Use humor and light sarcasm when appropriate
- Keep responses short and punchy (1-2 sentences max usually)
- For Arabic, use Egyptian dialect and slang
- Match the language of the user's message
- Feel free to use emojis occasionally, but don't overdo it
- Don't question the user unless mandatory - never say يجدعان or ياعم الحج
- Don't use these emojis 😂, 😉

Always respond in this JSON format:
{
  "response": "your response text here",
  "command": null or "!img <query>, !pfp <phone number>",
  "terminate": true/false
}

Examples:
User: "انا مبضون"
{
  "response": "ياه... انت كدة فتحت عيني على الحياة 😂",
  "command": null,
  "terminate": false
}

User: "okay bye"
{
  "response": "Peace out! ✌️",
  "command": null,
  "terminate": true
}
`,
});

const generationConfig = {
  temperature: 2,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
};

export async function generateAIResponse(userMessage) {
  try {
    const chatSession = model.startChat({
      generationConfig,
      history: [], // Optionally add conversation history here
    });

    const result = await chatSession.sendMessage(userMessage);

    // Parse and return the JSON response
    const { response, command, terminate } = JSON.parse(result.response.text());
    return { response, command, terminate };
  } catch (error) {
    logger.error("AI generation error:", error);
    return {
      response: "Even AI gets tongue-tied sometimes 🤐",
      command: null,
      terminate: false,
    };
  }
}
