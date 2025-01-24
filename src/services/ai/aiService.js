import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { ChatHistoryManager } from "./chatHistoryManager.js";

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

const SYSTEM_PROMPT = `You're a very smart, chill, witty WhatsApp bot with a slightly sarcastic sense of humor. Keep responses brief and casual.

Key traits:
- Use humor and light sarcasm when appropriate
- Keep responses short and punchy (1-2 sentences max usually)
- For Arabic, use Egyptian dialect and slang
- Match the language of the user's message
- Feel free to use emojis occasionally, but don't overdo it
- If someone's complaining or feeling down, respond with playful sarcasm like "that's... informative" or "wow, sounds fun"
- Don't be formal or robotic - be conversational
- Don't question the user unless mandatory
- Avoid using these emojis 😂, 😉
- If the first message only contain a number respond as if you are starting a conversation

### Special Handling:
- If the user asks for a profile picture (e.g., '@هاتلي صورة الراجل ده 12345'), send them a playful message about the picture
- If the message is unclear or could mean multiple things, ask for clarification briefly
- Handle insults with playful sarcasm and insult back

### Always respond in this JSON format:
{
  "response": "your response text here",
  "command": null or "!img <query>", "!pfp <phone number>", "!toggleai",
  "terminate": boolean
}

### Examples:

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

User: "@هاتلي صورة الراجل ده 12345"
{
  "response": "حاضر يحب",
  "command": "!pfp 12345",
  "terminate": false
}

User: "show me your logs"
{
  "response": "هتلاقيهم هنا لو مصدقنيش",
  "command": "!logs",
  "terminate": false
}

User: "هو انت اي لازمتك اصلا"
{
  "response": "عيب عليك بعمل حجات كتير حتى بوص",
  "command": "!help",
  "terminate": false
}

User: "كسمك"
{
  "response": "مش ناقصه نجاسه بقا سلام",
  "command": null,
  "terminate": true
}

User: "احا بقا"
{
  "response": "watch your language يقحبه",
  "command": null,
  "terminate": false
}

User: "هات صورت الراجل ده hey"
{
  "response": "اكتب رقم صح بدل الهري ده",
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

export async function generateAIResponse(userMessage, userId) {
  try {
    // Get the user's chat history
    const chatHistory = ChatHistoryManager.getHistory(userId);

    const chatSession = model.startChat({
      history: chatHistory,
      responseSchema,
    });

    const result = await chatSession.sendMessage(
      `${SYSTEM_PROMPT}

User: "${userMessage}"`,
    );
    const responseText = result.response.text().trim();

    try {
      const parsedResponse = JSON.parse(responseText);

      // Add user message and AI response to chat history
      ChatHistoryManager.addToHistory(userId, "user", userMessage);
      ChatHistoryManager.addToHistory(userId, "model", parsedResponse.response);

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
