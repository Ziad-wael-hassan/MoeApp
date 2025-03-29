// messageHandler.js
import { ShutupUsers, Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import { commandHandlers } from "./commands/index.js";
import { handleMediaExtraction } from "../media/mediaExtractor.js";
import { generateAIResponse } from "../ai/aiService.js";
import { ChatHistoryManager } from "../ai/chatHistoryManager.js";
import { textToSpeech } from "../audio/tts.js";
import { whatsappClient } from "./client.js";
import removeMarkdown from "remove-markdown";
import axios from "axios"; // Added missing axios import
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys';

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
    await this.setState(chat, "sendPresenceUpdate", proto.Presence.composing);
  },

  async setRecording(chat) {
    await this.setState(chat, "sendPresenceUpdate", proto.Presence.recording);
  },

  async clear(chat) {
    await this.setState(chat, "sendPresenceUpdate", proto.Presence.paused);
  },

  async setState(chat, method, state) {
    try {
      await whatsappClient.client[method](state, chat);
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
    logger.info(`Processing voice note. Message type: ${message.messageType}`);

    if (!message.message.audioMessage) {
      logger.info("No media found in message");
      return;
    }

    const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    logger.info("Sending to transcription API...");
    const formData = new FormData();
    formData.append("base64_data", buffer.toString('base64'));

    const response = await axios.post(`${FASTAPI_URL}/transcribe_file`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    const transcription = response.data.text;
    logger.info(`Received transcription: ${transcription}`);
    return transcription;
  } catch (error) {
    logger.error(
      {
        err: error,
        url: `${FASTAPI_URL}/transcribe_file`,
        messageType: message.messageType,
      },
      "Error transcribing voice note",
    );
    return null;
  }
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
    if (message.message?.conversation || message.message?.imageMessage || message.message?.videoMessage || message.message?.audioMessage) {
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
      const chat = await this.client.groupMetadata(message.key.remoteJid);
      const contact = message.pushName;
      const chatId = message.key.remoteJid;
      const authorId = contact || message.participant || "unknown";

      const logContext = [
        chatId ? `[Chat: ${chatId}]` : null,
        authorId ? `[Author: ${authorId}]` : null,
      ].filter(Boolean).join(" ");

      logger.info(`${logContext} Processing message: "${message.text?.substring(0, 50) || "[MEDIA]"}"`);

      // Handle command if message starts with !
      if (message.text?.startsWith("!")) {
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
      if (!this.usersToRespondTo.has(message.key.participant) && isBotMentioned) {
        this.usersToRespondTo.add(message.key.participant);
        await this.client.sendMessage(chatId, { text: "??" });
        return;
      }

      // Generate voice response if needed
      await generateVoiceResponse(message.text, message);

      // Handle voice note transcription
      if (this.usersToRespondTo.has(message.key.participant) && (message.message.audioMessage)) {
        logger.info(`${logContext} Received voice message from user in respond list. Type: ${message.messageType}`);
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
        await ChatState.clear(chat);
        await this.client.sendMessage(chatId, { text: "I encountered an error processing your message. Please try again later." });
      } catch (replyError) {
        logger.error("Failed to send error message:", replyError);
      }
    }
  }

  // Other methods remain the same
}

export const messageHandler = new MessageHandler();
