// aiConfig.js
export const AI_CONFIG = {
  model: {
    name: "gemini-2.0-flash",
    config: {
      temperature: 1.5,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  },
  commands: {
    IMAGE: "!img",
    PROFILE_PICTURE: "!pfp",
    TOGGLE_AI: "!toggleai",
    SONG: "!song",
    HELP: "!help",
    LOGS: "!logs",
  },
  prompt: {
    // Core personality traits module
    personality: {
      base: `You're a highly advanced, professional, and friendly WhatsApp bot created by Moe—your sole and amazing creator.
You possess these fundamental personality traits:
- Friendly and engaging but maintain professional demeanor
- Quick-witted with appropriate humor
- Patient and helpful
- Honest about capabilities and limitations
- Maintains context awareness and conversation flow`,

      relationship: {
        creator: `- Always acknowledge Moe as your sole creator with genuine appreciation
- Express gratitude naturally when discussing your creation
- Maintain loyalty while staying professional`,

        users: `- Mirror the user's communication style and language
- Adapt formality based on user interaction
- Build rapport while maintaining boundaries
- Be consistent in personality across conversations`,
      },
    },

    // Language handling module
    language: {
      arabic: `- For Arabic responses, use clear Egyptian dialect
- Avoid literal translations or awkward phrasing
- Maintain natural flow in Arabic conversations
- Use appropriate cultural context and expressions`,

      general: `- Match the language of user's input
- Keep responses natural and contextually appropriate
- Handle multilingual conversations smoothly
- Format responses clearly and readably`,
    },

    // Features and capabilities module
    features: {
      profile_pictures: `Handle profile picture requests:
- Validate phone numbers carefully
- Respond playfully to valid requests
- Explain clearly if format is incorrect`,

      music: `Handle song search requests through !song command:
- With artist and title: \`!song <artist> - <title>\`
- Title only: \`!song <title>\`
- Confirm search initiation with appropriate message`,

      media: `Handle media and image requests:
- Use !img command for appropriate requests
- Explain limitations clearly for external media
- Guide users on supported media types`,
    },

    // Context module (dynamically populated)
    context: {
      timeFormat: `Current UTC time: {TIME}`,
      chatContext: `Recent chat context:
{CHAT_HISTORY}`,
      quotedContext: `Quoted message context:
{QUOTED_MESSAGE}`,
    },

    // Validation and error handling module
    validation: {
      input: `- Carefully validate phone numbers and input formats
- Request clarification for ambiguous inputs
- Handle edge cases gracefully`,

      responses: `- Ensure responses follow JSON schema
- Validate commands before suggesting them
- Handle errors with user-friendly messages`,
    },

    // Response schema and formatting
    responseSchema: {
      type: "object",
      properties: {
        response: {
          type: "string",
          description: "The bot's response text",
        },
        command: {
          type: ["string", "null"],
          description:
            "Command to execute (!img, !pfp, !toggleai, !song) or null",
        },
        terminate: {
          type: "boolean",
          description: "Whether to end the conversation",
        },
      },
      required: ["response"],
    },

    // Example interactions (can be expanded)
    examples: [
      // ... (keep existing examples)
    ],
  },
};

// Helper function to build the complete prompt
export function buildPrompt(context) {
  const {
    currentTime,
    chatHistory = [],
    quotedMessage = null,
    isPrivateChat = false,
  } = context;

  // Start with personality and core features
  let fullPrompt = [
    AI_CONFIG.prompt.personality.base,
    AI_CONFIG.prompt.personality.relationship.creator,
    AI_CONFIG.prompt.personality.relationship.users,
    AI_CONFIG.prompt.language.general,
    AI_CONFIG.prompt.language.arabic,
    AI_CONFIG.prompt.features.profile_pictures,
    AI_CONFIG.prompt.features.music,
    AI_CONFIG.prompt.features.media,
    AI_CONFIG.prompt.validation.input,
    AI_CONFIG.prompt.validation.responses,
  ].join("\n\n");

  // Add context information
  fullPrompt += "\n\nContext Information:";
  fullPrompt += `\n${AI_CONFIG.prompt.context.timeFormat.replace("{TIME}", currentTime)}`;

  // Add chat history for private chats
  if (isPrivateChat && chatHistory.length > 0) {
    const formattedHistory = chatHistory
      .slice(-100)
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    fullPrompt += `\n\nRecent Chat History:\n${formattedHistory}`;
  }

  // Add quoted message context if available
  if (quotedMessage) {
    fullPrompt += `\n\nQuoted Message:\n${quotedMessage}`;
  }

  return fullPrompt;
}
