import { Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import { commandHandlers } from "./commands/index.js";
import { handleMediaExtraction } from "../media/mediaExtractor.js";
import { generateAIResponse } from "../ai/aiService.js";
import { textToSpeech } from "../audio/tts.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { env } from "../../config/env.js";
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
    const isMetaAI = contact.name === "Meta AI" || contact.pushname === "Meta AI";

    if (!isMetaAI) {
      return;
    }

    try {
      const client = whatsappClient.getClient();
      const reloadedMessage = await waitForCompleteMessage(
        client,
        message.id._serialized
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
      await message.reply(media, chat.id._serialized, { sendAudioAsVoice: true });
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
    this.processingInterval = processingInterval;
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

    try {
      if (message.body.startsWith("!")) {
        await this.handleCommand(message, chat);
        return;
      }

      // For non-command messages, only show typing if AI is enabled
      if (await shouldUseAI()) {
        await ChatState.setTyping(chat);
      }

      const mediaResult = await handleMediaExtraction(message);
      if (mediaResult.processed) {
        await ChatState.clear(chat);
        return;
      }

      await generateVoiceIfNeeded(message.body, message);

      if (await shouldUseAI()) {
        await this.handleAIResponse(message, chat);
      }

      await ChatState.clear(chat);
    } catch (error) {
      await ChatState.clear(chat);
      logger.error({ err: error }, "Error processing message");
      await message.reply("Sorry, there was an error processing your message.");
    }
  }

  async handleCommand(message, chat) {
    const [command, ...args] = message.body.slice(1).split(" ");
    const commandKey = command.toLowerCase();

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
      const response = await generateAIResponse(message.body);

      await message.reply(response);
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
