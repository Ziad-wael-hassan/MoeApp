import { Commands, Settings } from "../../config/database.js";
import { logger } from "../../utils/logger.js";
import { commandHandlers } from "./commands/index.js";
import { handleMediaExtraction } from "../media/mediaExtractor.js";
import { generateAIResponse } from "../ai/aiService.js";
import { textToSpeech } from "../audio/tts.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { env } from "../../config/env.js";

const { MessageMedia } = WhatsAppWeb;

const MESSAGE_LENGTH_THRESHOLD = 300; // Messages longer than this will get TTS

async function forwardToWebhooks(message) {
  if (!env.WEBHOOK_URLS?.length) return;

  const webhookData = {
    messageId: message.id,
    from: message.from,
    to: message.to,
    body: message.body,
    timestamp: message.timestamp,
  };

  await Promise.allSettled(
    env.WEBHOOK_URLS.map((url) =>
      axios
        .post(url, webhookData, {
          headers: { "Content-Type": "application/json" },
          timeout: 5000,
        })
        .catch((error) => {
          logger.error({ err: error }, `Webhook delivery failed for ${url}`);
        }),
    ),
  );
}

async function shouldUseAI() {
  const setting = await Settings.findOne({ key: "ai_enabled" });
  return setting?.value ?? false;
}

async function generateVoiceIfNeeded(text, message) {
  if (text.length >= MESSAGE_LENGTH_THRESHOLD) {
    try {
      const { base64, mimeType } = await textToSpeech(text);
      const media = new MessageMedia(mimeType, base64);
      await message.reply(media, { sendAudioAsVoice: true });
    } catch (error) {
      logger.error({ err: error }, "Error generating voice for message");
    }
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
    try {
      // Forward to webhooks
      //await forwardToWebhooks(message);

      // Check if it's a command
      if (message.body.startsWith("!")) {
        await this.handleCommand(message);
        return;
      }

      // Try to handle media links
      const mediaResult = await handleMediaExtraction(message);
      if (mediaResult.processed) {
        return;
      }

      // Generate voice for long messages
      await generateVoiceIfNeeded(message.body, message);

      // If no command or media and AI is enabled, process with AI
      if (await shouldUseAI()) {
        await this.handleAIResponse(message);
      }
    } catch (error) {
      logger.error({ err: error }, "Error processing message");
      await message.reply("Sorry, there was an error processing your message.");
    }
  }

  async handleCommand(message) {
    const [command, ...args] = message.body.slice(1).split(" ");
    const commandKey = command.toLowerCase();

    const commandDoc = await Commands.findOne({
      name: commandKey,
    });

    if (!commandDoc) {
      await message.reply(
        "Unknown command. Use !help to see available commands.",
      );
      return;
    }

    if (!commandDoc.enabled) {
      await message.reply("This command is currently disabled.");
      return;
    }

    const handler = commandHandlers[command];
    if (!handler) {
      logger.error({ command }, "Command handler not found");
      await message.reply("This command is not implemented yet.");
      return;
    }

    try {
      await handler(message, args);
      await Commands.updateOne(
        { name: command },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsed: new Date() },
        },
      );
    } catch (error) {
      logger.error({ err: error }, "Error executing command");
      await message.reply("Error executing command. Please try again later.");
    }
  }

  async handleAIResponse(message) {
    try {
      const response = await generateAIResponse(message.body);
      await message.reply(response);

      // Generate voice for long AI responses
      await generateVoiceIfNeeded(response, message);
    } catch (error) {
      logger.error({ err: error }, "Error generating AI response");
      await message.reply("Sorry, I had trouble generating a response.");
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
    logger.info("Message handler started");
  }
}

export const messageHandler = new MessageHandler();
