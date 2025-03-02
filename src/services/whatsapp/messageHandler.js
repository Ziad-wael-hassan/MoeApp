// messageHandler.js
import { ShutupUsers, Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import { commandHandlers } from "./commands/index.js";
import { handleMediaExtraction } from "../media/mediaExtractor.js";
import { generateAIResponse } from "../ai/aiService.js";
import { ChatHistoryManager } from "../ai/chatHistoryManager.js";
import { textToSpeech } from "../audio/tts.js";
import WhatsAppWeb from "whatsapp-web.js";
import { whatsappClient } from "./client.js";
import removeMarkdown from "remove-markdown";
import axios from "axios"; // Added missing axios import

const { MessageMedia } = WhatsAppWeb;
const MESSAGE_LENGTH_THRESHOLD = 300;
const AUDIO_COMMANDS = new Set(["speak"]);
const SHUTUP_COOLDOWN = 30000; // 30 seconds
const FASTAPI_URL = "https://elghamazy-text.hf.space";

// Configuration for command responses
const COMMAND_RESPONSE_CONFIG = {
  help: { needsArgs: false, needsQuotedMsg: false, audioResponse: false },
  toggleai: { needsArgs: false, needsQuotedMsg: false, audioResponse: false },
  togglecmd: { needsArgs: false, needsQuotedMsg: false, audioResponse: false },
  logs: { needsArgs: false, needsQuotedMsg: false, audioResponse: false },
  pfp: { needsArgs: true, needsQuotedMsg: true, audioResponse: false },
  speak: { needsArgs: false, needsQuotedMsg: true, audioResponse: true },
  img: { needsArgs: true, needsQuotedMsg: false, audioResponse: false },
  msg: {
    needsArgs: true,
    needsQuotedMsg: false,
    audioResponse: false,
    minArgs: 2,
  },
};

/**
 * Utility for managing chat states (typing, recording, etc.)
 */
const ChatState = {
  async setTyping(chat) {
    await this.setState(chat, "sendStateTyping");
  },

  async setRecording(chat) {
    await this.setState(chat, "sendStateRecording");
  },

  async clear(chat) {
    await this.setState(chat, "clearState");
  },

  async setState(chat, method) {
    try {
      await chat[method]();
    } catch (error) {
      logger.error({ err: error }, `Failed to set chat state: ${method}`);
    }
  },
};

/**
 * Check if AI functionality is enabled
 */
async function isAIEnabled() {
  const setting = await Settings.findOne({ key: "ai_enabled" });
  return setting?.value ?? false;
}

/**
 * Transcribe voice notes using external API
 */
async function handleVoiceNoteTranscription(message) {
  try {
    logger.info(
      `Processing voice note. Message type: ${message.type}, Has media: ${message.hasMedia}`,
    );

    if (!message.hasMedia) {
      logger.info("No media found in message");
      return;
    }

    const media = await message.downloadMedia();
    logger.info(`Downloaded media with mimetype: ${media.mimetype}`);

    logger.info("Sending to transcription API...");
    // Create a FormData object and append the base64 data
    const formData = new FormData();
    formData.append("base64_data", media.data);

    const response = await axios.post(
      `${FASTAPI_URL}/transcribe_file`,
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );

    const transcription = response.data.text;
    logger.info(`Received transcription: ${transcription}`);
    return transcription;
  } catch (error) {
    logger.error(
      {
        err: error,
        url: `${FASTAPI_URL}/transcribe_file`,
        messageType: message.type,
        hasMedia: message.hasMedia,
      },
      "Error transcribing voice note",
    );
    return null;
  }
}

/**
 * Waits for a message to fully load to handle streaming messages
 */
async function waitForCompleteMessage(client, messageId, maxAttempts = 100) {
  let previousMessage = "";
  let sameContentCount = 0;
  let attempt = 0;

  while (attempt < maxAttempts) {
    const currentMessage = await client.getMessageById(messageId);
    const currentContent = currentMessage.body;

    if (currentContent === previousMessage) {
      sameContentCount++;
      if (sameContentCount >= 2) return currentMessage;
    } else {
      sameContentCount = 0;
    }

    previousMessage = currentContent;
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const finalMessage = await client.getMessageById(messageId);
  return finalMessage;
}

/**
 * Generate voice response for Meta AI messages if they exceed threshold length
 */
async function generateVoiceResponse(text, message) {
  try {
    const contact = await message.getContact();
    const isMetaAI =
      contact.name === "Meta AI" || contact.pushname === "Meta AI";
    if (!isMetaAI) return;

    const client = whatsappClient.getClient();
    const reloadedMessage = await waitForCompleteMessage(
      client,
      message.id._serialized,
    );
    text = reloadedMessage.body;

    // Remove the length check and always generate voice response for Meta AI messages
    const chat = await message.getChat();
    await ChatState.setRecording(chat);
    const { base64, mimeType } = await textToSpeech(text);
    const media = new MessageMedia(mimeType, base64);
    await message.reply(media, chat.id._serialized, {
      sendAudioAsVoice: true,
    });
  } catch (error) {
    logger.error({ err: error }, "Error generating voice for message");
  }
}

/**
 * Check if a command will respond based on its requirements
 */
function shouldCommandRespond(command, args, hasQuotedMsg) {
  const config = COMMAND_RESPONSE_CONFIG[command];
  if (!config) return false;

  if (config.needsArgs && args.length === 0 && !hasQuotedMsg) return false;
  if (
    config.needsQuotedMsg &&
    !hasQuotedMsg &&
    (!args.length || !config.needsArgs)
  )
    return false;
  if (config.minArgs && args.length < config.minArgs) return false;

  return true;
}

/**
 * Main message handler class
 */
export class MessageHandler {
  constructor(processingInterval = 1000) {
    this.messageQueue = [];
    this.usersToRespondTo = new Set();
    this.client = null;
    this.processingInterval = processingInterval;
    this.shutupCooldowns = new Map();
  }

  setClient(client) {
    this.client = client;
  }

  async handleMessage(message) {
    if (message?.body || message?.hasMedia) {
      this.messageQueue.push(message);
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

  async processMessage(message) {
    try {
      const chat = await message.getChat();
      const contact = await message.getContact();
      const chatId =
        typeof chat.id === "object" ? chat.id._serialized : chat.id;
      const authorId =
        contact.pushname ||
        contact.name ||
        message.author.split("@")[0] ||
        "unknown";

      const logContext = [
        chatId ? `[Chat: ${chatId}]` : null,
        authorId ? `[Author: ${authorId}]` : null,
      ]
        .filter(Boolean)
        .join(" ");

      // Skip messages that aren't from a group or normal chat
      const isGroupMessage = message.from.includes("@g.us");
      const isNormalChat = message.from.includes("@c.us");
      if (!isGroupMessage && !isNormalChat) return;

      logger.info(
        `${logContext} Processing message: "${message.body?.substring(0, 50) || "[MEDIA]"}"`,
      );

      // Handle command if message starts with !
      if (message.body?.startsWith("!")) {
        logger.info(`${logContext} Processing command`);
        await this.handleCommand(message, chat);
        return;
      }

      // Handle shutup response for tracked users
      await this.handleShutupResponse(message, contact);

      // Check for media extraction
      const mediaResult = await handleMediaExtraction(message);
      if (mediaResult.processed) {
        await ChatState.clear(chat);
        return;
      }

      // Handle bot mention
      const isBotMentioned = this.checkBotMention(message);
      if (!this.usersToRespondTo.has(message.author) && isBotMentioned) {
        this.usersToRespondTo.add(message.author);
        await message.reply("??");
        return;
      }

      // Generate voice response if needed
      await generateVoiceResponse(message.body, message);

      // Handle voice note transcription
      if (
        this.usersToRespondTo.has(message.author) &&
        (message.type === "ptt" || message.type === "voice")
      ) {
        logger.info(
          `${logContext} Received voice message from user in respond list. Type: ${message.type}`,
        );
        await this.handleVoiceMessage(message, chat);
        return;
      }

      // Generate AI response if needed
      const shouldRespond = await this.shouldRespond(message);
      if (shouldRespond) {
        await ChatState.setTyping(chat);
        await this.handleAIResponse(message, chat);
        await ChatState.clear(chat);
      }
    } catch (error) {
      logger.error(`Error processing message:`, error);
      try {
        const chat = await message.getChat();
        await ChatState.clear(chat);
        await message.reply(
          "I encountered an error processing your message. Please try again later.",
        );
      } catch (replyError) {
        logger.error("Failed to send error message:", replyError);
      }
    }
  }

  // New method to specifically handle voice messages
  async handleVoiceMessage(message, chat) {
    try {
      logger.info(`Received voice message. Type: ${message.type}`);
      const isReplyToBot =
        message.hasQuotedMsg &&
        (await message.getQuotedMessage()).from === message.to;

      if (!isReplyToBot) {
        logger.info("Voice note ignored - not a reply to bot message");
        return;
      }

      const transcription = await handleVoiceNoteTranscription(message);

      if (transcription) {
        logger.info(`Successfully transcribed: ${transcription}`);
        // Instead of creating a new object, modify the existing message
        const originalBody = message.body;
        message.body = transcription;

        await this.handleAIResponse(message, chat);

        // Restore original body if needed
        message.body = originalBody;
      } else {
        logger.info("No transcription returned");
        // Use the original message object
        await message.reply(
          "Sorry, I couldn't transcribe your voice note. Please try again.",
        );
      }
    } catch (error) {
      logger.error({ err: error }, "Error handling voice message");
      await message.reply(
        "An error occurred while processing your voice message.",
      );
    }
  }

  async handleShutupResponse(message, contact) {
    // Skip if message is a command
    if (message.body?.startsWith("!")) return;

    const shutupUser = await ShutupUsers.findOne({
      phoneNumber: contact.number,
    });
    if (shutupUser) {
      const now = Date.now();
      const lastTime = this.shutupCooldowns.get(contact.number) || 0;
      if (now - lastTime >= SHUTUP_COOLDOWN) {
        await message.reply(`اسكت يا ${shutupUser.name}`);
        this.shutupCooldowns.set(contact.number, now);
      }
    }
  }

  async shouldRespond(message) {
    try {
      const aiEnabled = await isAIEnabled();
      const isReplyToBot =
        message.hasQuotedMsg &&
        (await message.getQuotedMessage()).from === message.to;
      const isMediaMessage =
        message.hasMedia && message.type !== "ptt" && message.type !== "voice";

      return (
        aiEnabled &&
        this.usersToRespondTo.has(message.author) &&
        !isMediaMessage &&
        (!message.hasQuotedMsg || isReplyToBot)
      );
    } catch (error) {
      logger.error("Error checking if should respond:", error);
      return false;
    }
  }

  checkBotMention(message) {
    const isMentioned = message.mentionedIds?.includes(message.to);
    if (isMentioned) {
      const messageText = message.body?.trim() || "";
      const mentionText = `@${message.to.split("@")[0]}`;

      // Replace the mention with "Hey!" and trim any extra whitespace
      message.body = messageText.replace(mentionText, "Hey!").trim();
      const remainingText = message.body;

      if (
        remainingText.length > 0 ||
        !this.usersToRespondTo.has(message.author)
      ) {
        this.usersToRespondTo.add(message.author);
      }
      return true;
    }
    return false;
  }

  async handleCommand(message, chat, commandFromAI = null) {
    const commandText = commandFromAI || message.body || "";
    if (!commandText.startsWith("!")) return;

    const [command, ...args] = commandText.slice(1).split(" ");
    const commandKey = command.toLowerCase();

    // Special handling for toggleai command
    if (commandKey === "toggleai") {
      ChatHistoryManager.clearAllHistories();
    }

    try {
      // Check if command exists and is enabled
      const commandDoc = await Commands.findOne({ name: commandKey });
      if (!commandDoc || !commandDoc.enabled) {
        await message.reply(
          !commandDoc
            ? "Unknown command. Use !help to see available commands."
            : "This command is currently disabled.",
        );
        return;
      }

      // Set appropriate chat state based on command
      if (shouldCommandRespond(commandKey, args, message.hasQuotedMsg)) {
        const config = COMMAND_RESPONSE_CONFIG[commandKey];
        if (config?.audioResponse) {
          await ChatState.setRecording(chat);
        } else {
          await ChatState.setTyping(chat);
        }
      }

      // Execute command handler
      const handler = commandHandlers[commandKey];
      if (!handler) {
        logger.error({ command: commandKey }, "Command handler not found");
        await message.reply("This command is not implemented yet.");
        return;
      }

      await handler(message, args);

      // Update command usage statistics
      await Commands.updateOne(
        { name: commandKey },
        { $inc: { usageCount: 1 }, $set: { lastUsed: new Date() } },
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
      const userId = message.author;
      const { response, command, terminate } = await generateAIResponse(
        message.body,
        userId,
      );

      await message.reply(response);

      // Handle command if AI generated one
      if (command) {
        await this.handleCommand(message, chat, command);
      }

      // Terminate conversation if requested
      if (terminate) {
        await message.react("✅");
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
}

export const messageHandler = new MessageHandler();
