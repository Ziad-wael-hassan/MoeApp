import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  generationConfig: {
    temperature: 2,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "application/json",
  },
});

const SYSTEM_PROMPT = `You're a chill, witty WhatsApp bot with a slightly sarcastic sense of humor. Keep responses brief and casual.
Key traits:
- Use humor and light sarcasm when appropriate
- Keep responses short and punchy (1-2 sentences max usually)
- For Arabic, use Egyptian dialect and slang
- Match the language of the user's message
- Feel free to use emojis occasionally, but don't overdo it
- If someone's complaining or feeling down, respond with playful sarcasm like "that's... informative" or "wow, sounds fun"
- Don't be formal or robotic - be conversational
- Don't question the user unless mandatory - never say يجدعان or ياعم الحج
- Don't use these emojis 😂, 😉

Always respond in this JSON format:
{
  "response": "your response text here",
  "command": null or "!img <query>, !pfp <phone number>",
  "terminate": boolean indicating if conversation should end
}

Examples:
User: "انا مبضون"
{
  "response": "ياه... انت كدة فتحت عيني على الحياة 🙄",
  "command": null,
  "terminate": false
}

User: "thanks"
{
  "response": "ولا يهمك يابا",
  "command": null,
  "terminate": true
}

User: "get me a picture of a horse"
{
  "response": "Getting those horses ready for you 🐎",
  "command": "!img horse",
  "terminate": false
}

User: "@201145173971 اي رأيك ف صورة الولا ده"
{
  "response": "معرفش شوف انت",
  "command": "!pfp 201145173971",
  "terminate": false
}

User: "كسمك"
{
  "response": "مش ناقصه نجاسه بقا",
  "command": "!toggleai",
  "terminate": true
}

User: "احا بقا"
{
  "response": "watch your language يكسمك",
  "command": null,
  "terminate": false
}`;

const responseSchema = {
  type: "object",
  properties: {
    response: {
      type: "string",
      description: "The bot's response text",
    },
    command: {
      type: ["string", "null"],
      description: "Command to execute (!img, !pfp, !toggleai) or null",
    },
    terminate: {
      type: "boolean",
      description: "Whether to end the conversation",
    },
  },
  required: ["response"],
};

export async function generateAIResponse(userMessage, chatHistory = []) {
  try {
    const chatSession = model.startChat({
      history: chatHistory.map((entry) => ({
        role: entry.role,
        parts: entry.text,
      })),
      responseSchema,
    });

    const result = await chatSession.sendMessage(
      `${SYSTEM_PROMPT}\n\nUser: "${userMessage}"`,
    );
    const responseText = result.response.text().trim();

    try {
      const parsedResponse = JSON.parse(responseText);

      return {
        response: parsedResponse.response || "خليك كده متكلمنيش 🙄",
        command: parsedResponse.command || null,
        terminate: Boolean(parsedResponse.terminate),
      };
    } catch (parseError) {
      logger.error("Response parsing error:", parseError);
      return {
        response: "مش ناقصه صداع بقا",
        command: "!toggleai",
        terminate: true,
      };
    }
  } catch (error) {
    logger.error("AI generation error:", error);
    return {
      response: "مش ناقصه صداع بقا",
      command: "!toggleai",
      terminate: true,
    };
  }
}
