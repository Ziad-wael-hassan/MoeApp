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

const MESSAGE_LENGTH_THRESHOLD = 300;

// Commands that use recording status instead of typing
const AUDIO_COMMANDS = new Set(['speak']);

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
  }
};


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
// Helper to determine if a command will provide a response
function commandWillRespond(command, args, hasQuotedMsg) {
  switch (command) {
    case 'help':
    case 'toggleai':
    case 'togglecmd':
    case 'logs':
      return true;
    case 'pfp':
      return args.length > 0 || hasQuotedMsg;
    case 'speak':
      return hasQuotedMsg;
    case 'img':
      return args.length > 0;
    case 'msg':
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
            : "This command is currently disabled."
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
        }
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

      if (response.length >= MESSAGE_LENGTH_THRESHOLD) {
        await ChatState.setRecording(chat);
        await generateVoiceIfNeeded(response, message);
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
    logger.info("Message handler started");
  }
}

export const messageHandler = new MessageHandler();
