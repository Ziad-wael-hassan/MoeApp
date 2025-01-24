import { Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import { commandHandlers } from "./commands/index.js";
import { handleMediaExtraction } from "../media/mediaExtractor.js";
import { generateAIResponse } from "../ai/aiService.js";
import { ChatHistoryManager } from "../ai/chatHistoryManager.js";
import { textToSpeech } from "../audio/tts.js";
import WhatsAppWeb from "whatsapp-web.js";
import { whatsappClient } from "./client.js";
import removeMarkdown from "remove-markdown";


const { MessageMedia } = WhatsAppWeb;

const MESSAGE_LENGTH_THRESHOLD = 300;

// Commands that use recording status instead of typing
const AUDIO_COMMANDS = new Set(["speak"]);

// Helper for managing chat states
const ChatState = {
  async setTyping(chat) {
    try {
      await chat.sendStateTyping();
    } catch (error) {
      logger.error({ err: error }, "Failed to set typing state");
    }
  },

  async setRecording(chat) {
    try {
      await chat.sendStateRecording();
    } catch (error) {
      logger.error({ err: error }, "Failed to set recording state");
    }
  },

  async clear(chat) {
    try {
      await chat.clearState();
    } catch (error) {
      logger.error({ err: error }, "Failed to clear chat state");
    }
  },
};

async function shouldUseAI() {
  const setting = await Settings.findOne({ key: "ai_enabled" });
  return setting?.value ?? false;
}

async function generateVoiceIfNeeded(text, message) {
  try {
    const contact = await message.getContact();
    const isMetaAI =
      contact.name === "Meta AI" || contact.pushname === "Meta AI";

    if (!isMetaAI) {
      return;
    }

    try {
      const client = whatsappClient.getClient();
      const reloadedMessage = await waitForCompleteMessage(
        client,
        message.id._serialized,
      );
      text = reloadedMessage.body;
    } catch (error) {
      logger.error({ err: error }, "Error waiting for complete message");
      return;
    }

    if (text.length >= MESSAGE_LENGTH_THRESHOLD) {
      const chat = await message.getChat();
      await chat.sendStateRecording();
      const { base64, mimeType } = await textToSpeech(text);
      const media = new MessageMedia(mimeType, base64);
      await message.reply(media, chat.id._serialized, {
        sendAudioAsVoice: true,
      });
    }
  } catch (error) {
    logger.error({ err: error }, "Error generating voice for message");
  }
}

// Helper function to wait for complete message
async function waitForCompleteMessage(client, messageId, maxAttempts = 10) {
  let previousMessage = "";
  let sameContentCount = 0;
  let attempt = 0;

  while (attempt < maxAttempts) {
    // Get the current state of the message
    const currentMessage = await client.getMessageById(messageId);
    const currentContent = currentMessage.body;

    // If the content hasn't changed from the previous check
    if (currentContent === previousMessage) {
      sameContentCount++;
      // If content remained the same for 2 consecutive checks, assume it's complete
      if (sameContentCount >= 2) {
        return currentMessage;
      }
    } else {
      // Reset the counter if content changed
      sameContentCount = 0;
    }

    previousMessage = currentContent;
    attempt++;

    // Wait for a shorter interval between checks
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const finalMessage = await client.getMessageById(messageId);
  const cleanedMessage = removeMarkdown(finalMessage);

  return cleanedMessage;
}

// Helper to determine if a command will provide a response
function commandWillRespond(command, args, hasQuotedMsg) {
  switch (command) {
    case "help":
    case "toggleai":
    case "togglecmd":
    case "logs":
      return true;
    case "pfp":
      return args.length > 0 || hasQuotedMsg;
    case "speak":
      return hasQuotedMsg;
    case "img":
      return args.length > 0;
    case "msg":
      return args.length >= 2;
    default:
      return false;
  }
}

export class MessageHandler {
  constructor(processingInterval = 1000) {
    this.messageQueue = [];
    this.usersToRespondTo = new Set();
    this.client = null;
    this.processingInterval = processingInterval;
  }

  setClient(client) {
    this.client = client;
  }

  async handleMessage(message) {
    try {
      if (!message || !message.body) {
        return;
      }
      this.messageQueue.push(message);
    } catch (error) {
      logger.error({ err: error }, "Error handling message");
    }
  }

  async processMessage(message) {
    const chat = await message.getChat();
    const chatId = typeof chat.id === "object" ? chat.id._serialized : chat.id;
    const authorId = message.author ? message.author.split("@")[0] : "unknown";
    const logContext = `[Chat: ${chatId} | Author: ${authorId}]`;
    const isGroupMessage = message.from.includes("@g.us");
    const isNormalChat = message.from.includes("@c.us");
    const isBotMentioned = this.checkBotMention(message);

    try {
      if (!isGroupMessage && !isNormalChat) return;
      console.log(
        `${logContext} Processing message: ${message.body.substring(0, 50)}...`,
      );

      // Handle commands
      if (message.body.startsWith("!")) {
        console.log(`${logContext} Processing command`);
        await this.handleCommand(message, chat);
        return;
      }

      // Process media
      try {
        const mediaResult = await handleMediaExtraction(message);
        if (mediaResult.processed) {
          console.log(`${logContext} Media processed successfully`);
          await ChatState.clear(chat);
          return;
        }
      } catch (mediaError) {
        console.error(`${logContext} Error processing media:`, mediaError);
      }

      // Check for bot mentions and add user if not already in the set
      if (!this.usersToRespondTo.has(message.author) && isBotMentioned) {
        this.usersToRespondTo.add(message.author);
        await message.reply("Hello! How can I assist you?");
        return; // Prevent further processing
      }
      // Generate voice if needed
      try {
        await generateVoiceIfNeeded(message.body, message);
      } catch (voiceError) {
        console.error(`${logContext} Error generating voice:`, voiceError);
      }

      // Process AI response
      const shouldRespond = await this.shouldRespond(message);
      if (shouldRespond) {
        await ChatState.setTyping(chat);
        try {
          await this.handleAIResponse(message, chat);
        } catch (aiError) {
          console.error(`${logContext} Error generating AI response:`, aiError);
          // Don't throw here, just log the error
        }
      }

      await ChatState.clear(chat);
    } catch (error) {
      console.error(`${logContext} Fatal error processing message:`, error);
      await ChatState.clear(chat);
      await message.reply(
        "I encountered an error processing your message. Please try again later.",
      );
    }
  }
  async shouldRespond(message) {
    try {
      const aiEnabled = await shouldUseAI();
      const isReplyToBot =
        message.hasQuotedMsg &&
        (await message.getQuotedMessage()).from === message.to;
      const isMediaMessage = message.hasMedia;

      return (
        aiEnabled &&
        this.usersToRespondTo.has(message.author) &&
        !isMediaMessage &&
        (!message.hasQuotedMsg || isReplyToBot)
      );
    } catch (error) {
      console.error("Error checking if should respond:", error);
      return false;
    }
  }

  checkBotMention(message) {
    const isMentioned = message.mentionedIds?.includes(message.to);
    if (isMentioned) {
      return true;
    }
  }

  async handleCommand(message, chat, commandFromAI = null) {
    // If command is from AI, use it directly. Otherwise, parse from message
    const commandParts = commandFromAI
      ? commandFromAI.slice(1).split(" ")
      : message.body.slice(1).split(" ");

    const [command, ...args] = commandParts;
    const commandKey = command.toLowerCase();
    if (commandKey === 'toggleai') {
      ChatHistoryManager.clearAllHistories();
    }
    try {
      const commandDoc = await Commands.findOne({ name: commandKey });

      if (!commandDoc || !commandDoc.enabled) {
        await message.reply(
          !commandDoc
            ? "Unknown command. Use !help to see available commands."
            : "This command is currently disabled.",
        );
        return;
      }

      // Only set chat state if command will provide a response
      if (commandWillRespond(commandKey, args, message.hasQuotedMsg)) {
        if (AUDIO_COMMANDS.has(commandKey)) {
          await ChatState.setRecording(chat);
        } else {
          await ChatState.setTyping(chat);
        }
      }

      const handler = commandHandlers[commandKey];
      if (!handler) {
        logger.error({ command }, "Command handler not found");
        await message.reply("This command is not implemented yet.");
        return;
      }

      await handler(message, args);
      await Commands.updateOne(
        { name: commandKey },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsed: new Date() },
        },
      );
    } catch (error) {
      logger.error({ err: error }, "Error executing command");
      await message.reply("Error executing command. Please try again later.");
    } finally {
      await ChatState.clear(chat);
    }
  }

  async handleAIResponse(message, chat) {
    try {
      // Use the author's ID as the unique identifier
      const userId = message.author;

      const { response, command, terminate } = await generateAIResponse(
        message.body,
        userId
      );

      await message.reply(response);

      if (command) {
        await this.handleCommand(message, chat, command);
      }

      // If terminate is true, clear this user's chat history
      if (terminate) {
        this.usersToRespondTo.delete(message.author);
        ChatHistoryManager.clearHistory(userId);
      }
    } catch (error) {
      logger.error({ err: error }, "Error generating AI response");
      await message.reply("Sorry, I had trouble generating a response.");
    } finally {
      await ChatState.clear(chat);
    }
  }

  async processQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      await this.processMessage(message);
    }
  }

  start() {
    setInterval(() => this.processQueue(), this.processingInterval);
  }
}

export const messageHandler = new MessageHandler();
