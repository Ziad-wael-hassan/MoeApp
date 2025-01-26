import { Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import chalk from "chalk";
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
const AUDIO_COMMANDS = new Set(["speak"]);

const ChatState = {
  async setTyping(chat) {
    await this.setState(chat, "sendStateTyping", "typing");
  },
  async setRecording(chat) {
    await this.setState(chat, "sendStateRecording", "recording");
  },
  async clear(chat) {
    await this.setState(chat, "clearState", "clear");
  },
  async setState(chat, method, state) {
    try {
      await chat[method]();
    } catch (error) {
      logger.error({ err: error }, `Failed to set ${state} state`);
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
    if (!isMetaAI) return;

    const client = whatsappClient.getClient();
    const reloadedMessage = await waitForCompleteMessage(
      client,
      message.id._serialized,
    );
    text = reloadedMessage.body;

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

async function waitForCompleteMessage(client, messageId, maxAttempts = 10) {
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
  return removeMarkdown(finalMessage);
}

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
    if (message && message.body) {
      this.messageQueue.push(message);
    }
  }

  async processMessage(message) {
    const chat = await message.getChat();
    const contact = await message.getContact();
    const chatId = typeof chat.id === "object" ? chat.id._serialized : chat.id;
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

    const isGroupMessage = message.from.includes("@g.us");
    const isNormalChat = message.from.includes("@c.us");
    const isBotMentioned = this.checkBotMention(message);

    if (!isGroupMessage && !isNormalChat) return;

    logger.info(
      `${logContext} Processing message: "${message.body.substring(0, 50)}"`,
    );

    try {
      if (message.body.startsWith("!")) {
        logger.info(`${logContext} Processing command`);
        await this.handleCommand(message, chat);
        return;
      }

      const mediaResult = await handleMediaExtraction(message);
      if (mediaResult.processed) {
        await ChatState.clear(chat);
        return;
      }

      if (!this.usersToRespondTo.has(message.author) && isBotMentioned) {
        this.usersToRespondTo.add(message.author);
        await message.reply("Hello! How can I assist you?");
        return;
      }

      await generateVoiceIfNeeded(message.body, message);

      const shouldRespond = await this.shouldRespond(message);
      if (shouldRespond) {
        await ChatState.setTyping(chat);
        await this.handleAIResponse(message, chat);
      }

      await ChatState.clear(chat);
    } catch (error) {
      logger.error(`${logContext} Fatal error processing message:`, error);
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
      logger.error("Error checking if should respond:", error);
      return false;
    }
  }

  checkBotMention(message) {
    const isMentioned = message.mentionedIds?.includes(message.to);
    if (isMentioned) {
      const messageText = message.body.trim();
      const mentionText = `@${message.to.split("@")[0]}`;
      const remainingText = messageText.replace(mentionText, "").trim();
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
    const commandParts = commandFromAI
      ? commandFromAI.slice(1).split(" ")
      : message.body.slice(1).split(" ");
    const [command, ...args] = commandParts;
    const commandKey = command.toLowerCase();
    if (commandKey === "toggleai") {
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

      if (command) {
        await this.handleCommand(message, chat, command);
      }

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
