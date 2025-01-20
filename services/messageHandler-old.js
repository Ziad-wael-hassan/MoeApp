import { handleAutoDownload } from "../utils/handleAutoDownload.js";
import { textToSpeech } from "../utils/audio/tts.js";
import wwebjs from "whatsapp-web.js";
import axios from "axios";
import gis from "async-g-i-s";
import removeMarkdown from "remove-markdown";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { PROMPTS, SYSTEM_MESSAGES } from "./prompts.js";
import { imageHandler } from "./imageHandler.js";
import { client } from "../index.js";

dotenv.config();
const ADMIN_NUMBERS = process.env.ADMIN
  ? process.env.ADMIN.split(",").map((num) => num.trim())
  : [];

const { MessageMedia } = wwebjs;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Rate limiting configuration
const RATE_LIMIT = {
  WINDOW_MS: 60000, // 1 minute
  MAX_REQUESTS: 5,
};

class MessageHandler {
  #isAIEnabled;
  #areCommandsEnabled;
  #disabledCommands;
  #startTime;
  #stats;
  #webhookUrls;
  #rateLimitMap;
  #messageQueue;
  #isProcessing;

  constructor() {
    this.#webhookUrls = [];
    this.#disabledCommands = new Set();
    this.#isAIEnabled = true;
    this.#areCommandsEnabled = true;
    this.#startTime = Date.now();
    this.#rateLimitMap = new Map();
    this.#isProcessing = false;

    this.#stats = {
      imagesSent: 0,
      audioSent: 0,
      commandsProcessed: 0,
      aiResponses: 0,
      errors: 0,
      processingTimes: [],
      rateLimitHits: 0,
    };
  }

  // Initialize commands after all methods are defined
  initializeCommands() {
    this.commands = {
      "!help": {
        handler: this.handleHelp.bind(this),
        description: "Shows all available commands",
        format: "!help",
        adminOnly: false,
      },
      "!speak": {
        handler: this.handleSpeakCommand.bind(this),
        description: "Converts quoted message to speech",
        format: "!speak! (reply to a message)",
        adminOnly: false,
      },
      "!img": {
        handler: this.handleImageSearch.bind(this),
        description: "Searches and sends image(s)",
        format: "!image [number] <query>",
        adminOnly: false,
      },
      "!toggleai": {
        handler: this.handleToggleAI.bind(this),
        description: "Toggles AI functionality on/off",
        format: "!toggleai",
        adminOnly: true,
      },
      "!togglecmd": {
        handler: this.handleToggleCommands.bind(this),
        description: "Toggles specific or all commands on/off",
        format: "!togglecmd [command]",
        adminOnly: true,
      },
      "!pfp": {
        handler: this.handleProfilePicture.bind(this),
        description: "Get profile picture of a user",
        format:
          "!pic <phone/mention>\nExample: !pic +20 114 517 3971 or !pic @User",
        adminOnly: false,
      },
      "!logs": {
        handler: this.handleLogs.bind(this),
        description: "Shows bot statistics and logs",
        format: "!logs",
        adminOnly: true,
      },
      "!msg": {
        handler: this.handleSendMessage.bind(this),
        description: "Send a private message",
        format:
          '!msg <phone/mention> "message"\nExample: !msg +20 114 517 3971 "hello" or !msg @User "hello"',
        adminOnly: false,
      },
    };
  }

  async isAdmin(message) {
    const contact = await message.getContact();
    const contactNumber = contact?.number || "";
    return ADMIN_NUMBERS.includes(contactNumber);
  }

  // Helper method to format uptime
  formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const secs = seconds % 60;

    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }

  // Admin command handlers
  async handleToggleAI(message) {
    this.#isAIEnabled = !this.#isAIEnabled;
    await message.reply(
      `AI functionality is now ${this.#isAIEnabled ? "enabled" : "disabled"} ✨`,
    );
  }

  async handleToggleCommands(message, args) {
    if (!args) {
      // Toggle all commands
      this.#areCommandsEnabled = !this.#areCommandsEnabled;
      this.#disabledCommands.clear(); // Clear specific disabled commands when toggling all
      await message.reply(
        `All commands are now ${this.#areCommandsEnabled ? "enabled" : "disabled"} 🎮`,
      );
      return;
    }

    // Handle specific command toggle
    const commandName = `!${args.toLowerCase().trim()}`;
    if (!this.commands[commandName]) {
      await message.reply(`Command "${commandName}" not found`);
      return;
    }

    if (this.#disabledCommands.has(commandName)) {
      this.#disabledCommands.delete(commandName);
      await message.reply(`Command "${commandName}" has been enabled 🎮`);
    } else {
      this.#disabledCommands.add(commandName);
      await message.reply(`Command "${commandName}" has been disabled 🚫`);
    }
  }

  async handleLogs(message) {
    const uptime = Math.floor((Date.now() - this.#startTime) / 1000);
    const avgProcessingTime =
      this.#stats.processingTimes.length > 0
        ? (
            this.#stats.processingTimes.reduce((a, b) => a + b, 0) /
            this.#stats.processingTimes.length
          ).toFixed(2)
        : 0;

    const imageStats = imageHandler.getCacheStats();

    const logs = `🤖 *Bot Status Report* 🤖

*System Status:*
⏱️ Uptime: ${this.formatUptime(uptime)}
🎮 Commands: ${this.#areCommandsEnabled ? "Enabled" : "Disabled"}
🧠 AI: ${this.#isAIEnabled ? "Enabled" : "Disabled"}

*Performance Metrics:*
⚡ Avg Processing Time: ${avgProcessingTime}ms
❌ Errors: ${this.#stats.errors}

*Usage Statistics:*
📷 Images Sent: ${this.#stats.imagesSent}
🎵 Audio Messages: ${this.#stats.audioSent}
💬 Commands Processed: ${this.#stats.commandsProcessed}
🤖 AI Responses: ${this.#stats.aiResponses}

*Image Cache Stats:*
📊 Total Queries: ${imageStats.totalQueries}
🖼️ Total Unique URLs: ${imageStats.totalUrls}`;

    await message.reply(logs);
  }

  async handleHelp(message) {
    let commandsList = "";
    for (const [command, details] of Object.entries(this.commands)) {
      // Only show admin commands to admin
      if (!details.adminOnly || (await this.isAdmin(message))) {
        commandsList += `*${command}*: ${details.description}\nFormat: ${details.format}\n\n`;
      }
    }
    const helpText = SYSTEM_MESSAGES.HELP_TEXT.replace(
      "{{commands}}",
      commandsList,
    );
    await message.reply(helpText);
  }

  // Parse phone numbers to remove spaces, + and any other non-digit characters
  parsePhoneNumber(phone) {
    return phone.replace(/[^0-9]/g, "");
  }

  // Validate message format for !msg command
  validateMessageFormat(args) {
    const messageRegex = /"([^"]+)"/;
    const matches = args.match(messageRegex);

    if (!matches) {
      return {
        isValid: false,
        error: `Invalid format. Use:\n${this.commands["!msg"].format}`,
      };
    }

    const message = matches[1];
    const recipient = args.substring(0, args.indexOf('"')).trim();

    if (!recipient) {
      return {
        isValid: false,
        error: "Recipient is required",
      };
    }

    return {
      isValid: true,
      message,
      recipient,
    };
  }

  async handleProfilePicture(message, args) {
    try {
      if (!args) {
        await message.reply(
          `Invalid format. Use:\n${this.commands["!pic"].format}`,
        );
        return;
      }

      let contact;
      if (args.startsWith("@")) {
        // Handle mention
        const mentions = await message.getMentions();
        const mentionedUser = mentions.find(
          (m) => m.id.user === args.substring(1),
        );
        if (!mentionedUser) {
          await message.reply("Mentioned user not found");
          return;
        }
        contact = mentionedUser;
      } else {
        // Handle phone number
        const cleanPhone = this.parsePhoneNumber(args);
        if (!cleanPhone) {
          await message.reply("Invalid phone number format");
          return;
        }
        contact = await client.getContactById(`${cleanPhone}@c.us`);
      }

      if (!contact) {
        await message.reply("Contact not found");
        return;
      }

      const profilePic = await contact.getProfilePicUrl();
      if (!profilePic) {
        await message.reply("Profile picture not available");
        return;
      }

      // Download and send the profile picture
      const response = await axios.get(profilePic, {
        responseType: "arraybuffer",
      });
      const base64Data = Buffer.from(response.data).toString("base64");
      const media = new MessageMedia("image/jpeg", base64Data);
      await message.reply(media);
    } catch (error) {
      console.error("Error getting profile picture:", error);
      this.#stats.errors++;
      await message.reply("Failed to get profile picture");
    }
  }

  async handleSendMessage(message, args) {
    try {
      const validation = this.validateMessageFormat(args);

      if (!validation.isValid) {
        await message.reply(validation.error);
        return;
      }

      const { message: messageContent, recipient } = validation;

      let chatId;
      if (recipient.startsWith("@")) {
        // Handle mention
        const mentions = await message.getMentions();
        const mentionedUser = mentions.find(
          (m) => m.id.user === recipient.substring(1),
        );
        if (!mentionedUser) {
          await message.reply("Mentioned user not found");
          return;
        }
        chatId = `${mentionedUser.id.user}@c.us`;
      } else {
        // Handle phone number
        const cleanPhone = this.parsePhoneNumber(recipient);
        if (!cleanPhone) {
          await message.reply("Invalid phone number format");
          return;
        }
        chatId = `${cleanPhone}@c.us`;
      }

      // Send the message
      await client.sendMessage(chatId, messageContent);
      await message.reply("Message sent successfully ✅");
    } catch (error) {
      console.error("Error sending message:", error);
      await message.reply("Failed to send message");
      this.#stats.errors++;
    }
  }

  async handleSpeakCommand(message, chat) {
    try {
      if (!message.hasQuotedMsg) {
        await message.reply(SYSTEM_MESSAGES.QUOTE_REQUIRED);
        return;
      }

      const quotedMessage = await message.getQuotedMessage();
      if (quotedMessage && quotedMessage.body) {
        await chat.sendStateRecording();
        const { base64, mimeType } = await textToSpeech(quotedMessage.body);
        const media = new MessageMedia(mimeType, base64);
        await quotedMessage.reply(media, chat.id._serialized, {
          sendAudioAsVoice: true,
        });
        this.#stats.audioSent++;
      }
    } catch (error) {
      console.error("Error processing !speak! command:", error);
      this.#stats.errors++;
      await message.reply(SYSTEM_MESSAGES.SPEECH_ERROR);
    }
  }

  async handleImageSearch(message, chat, query) {
    if (!query) {
      await message.reply(SYSTEM_MESSAGES.NO_QUERY);
      return;
    }

    try {
      await chat.sendStateTyping();

      const { count, query: cleanQuery } =
        imageHandler.extractImageCount(query);
      const captionPromise = this.#isAIEnabled
        ? this.generateImageCaption(cleanQuery)
        : Promise.resolve("");

      const results = await gis(cleanQuery);
      if (!results || results.length === 0) {
        await message.reply(SYSTEM_MESSAGES.NO_IMAGES);
        return;
      }

      const uniqueImages = await imageHandler.getUniqueImages(
        cleanQuery,
        count,
        results,
      );

      if (uniqueImages.length === 0) {
        await message.reply(SYSTEM_MESSAGES.NO_VALID_IMAGES);
        return;
      }

      const mediaPromises = imageHandler.fetchAndPrepareImages(uniqueImages);

      const [mediaItems, caption] = await Promise.all([
        mediaPromises,
        captionPromise,
      ]);

      for (let i = 0; i < mediaItems.length; i++) {
        const captionText = i === 0 ? caption : "";
        await message.reply(mediaItems[i], null, { caption: captionText });
        this.#stats.imagesSent++;
      }
    } catch (error) {
      console.error("Error processing image search:", error);
      this.#stats.errors++;
      await message.reply(SYSTEM_MESSAGES.ERROR_SEARCHING);
    }
  }
  async processMessageQueue() {
    while (true) {
      if (this.#messageQueue.length > 0 && !this.#isProcessing) {
        this.#isProcessing = true;
        const message = this.#messageQueue.shift();
        try {
          await this.processMessage(message);
        } catch (error) {
          console.error("Error processing queued message:", error);
          this.#stats.errors++;
        }
        this.#isProcessing = false;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  isRateLimited(chatId) {
    const now = Date.now();
    const userRequests = this.#rateLimitMap.get(chatId) || [];

    // Clean up old requests
    const validRequests = userRequests.filter(
      (time) => now - time < RATE_LIMIT.WINDOW_MS,
    );

    if (validRequests.length >= RATE_LIMIT.MAX_REQUESTS) {
      this.#stats.rateLimitHits++;
      return true;
    }

    validRequests.push(now);
    this.#rateLimitMap.set(chatId, validRequests);
    return false;
  }

  async generateEgyptianResponse(message, quotedMessage = null) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Add retry logic for AI generation
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const prompt = PROMPTS.EGYPTIAN_CHAT.replace(
            "{{quotedMessage}}",
            quotedMessage?.body || "NONE",
          ).replace("{{message}}", message.body);

          const result = await model.generateContent(prompt);
          return result.response.text().trim();
        } catch (error) {
          attempts++;
          if (attempts === maxAttempts) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempts));
        }
      }
    } catch (error) {
      console.error("Error generating Egyptian response:", error);
      this.#stats.errors++;
      return "عذراً، حصل خطأ. ممكن تعيد طلبك؟ 🙏";
    }
  }
  async generateImageCaption(query) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = PROMPTS.IMAGE_CAPTION.replace("{{query}}", query);
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (error) {
      console.error("Error generating caption:", error);
      return `Here's what I found for: ${query} ✨`;
    }
  }
  async handleMessage(message) {
    // Queue the message instead of processing immediately
   processMessage(message);
  }

  async processMessage(message) {
    const startProcessing = Date.now();
    try {
      const chat = await message.getChat();
      const isGroupMessage = message.from.includes("@g.us");
      const isNormalChat = message.from.includes("@c.us");

      if (!isGroupMessage && !isNormalChat) return;

      const contact = await message.getContact();
      const isMetaAI =
        contact.name === "Meta AI" || contact.pushname === "Meta AI";

      async function waitForCompleteMessage(
        client,
        messageId,
        maxAttempts = 10,
      ) {
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

        // Return the last fetched message if max attempts reached
        return await client.getMessageById(messageId);
      }

      if (isMetaAI) {
        try {
          // Wait for the complete message
          const reloadedMessage = await waitForCompleteMessage(
            client,
            message.id._serialized,
          );

          await chat.sendStateRecording();

          const cleanMessage = removeMarkdown(reloadedMessage.body);
          const { base64, mimeType } = await textToSpeech(cleanMessage);
          const media = new MessageMedia(mimeType, base64);

          await message.reply(media, chat.id._serialized, {
            sendAudioAsVoice: true,
          });

          this.#stats.audioSent++;
        } catch (error) {
          console.error("Error in auto text-to-speech conversion:", error);
          this.#stats.errors++;
        }
      }

      console.log(`Received message from ${message.from}: ${message.body}`);

      // Check message length and auto-convert to speech if > 500 characters
      if (message.body.length > 300 && !isMetaAI) {
        try {
          await chat.sendStateRecording();
          const { base64, mimeType } = await textToSpeech(message.body);
          const media = new MessageMedia(mimeType, base64);
          await message.reply(media, chat.id._serialized, {
            sendAudioAsVoice: true,
          });
          this.#stats.audioSent++;
        } catch (error) {
          console.error("Error in auto text-to-speech conversion:", error);
          this.#stats.errors++;
        }
      }

      if (!isGroupMessage && isNormalChat) {
        const isFromAdmin = await this.isAdmin(message);
        if (!isFromAdmin) {
          const forwardText = `📩 *Forwarded Message*
From: ${message.from}

${message.body}`;

          // Send to all admin numbers
          for (const adminNumber of ADMIN_NUMBERS) {
            const adminChatId = `${adminNumber}@c.us`;
            if (message.hasMedia) {
              const media = await message.downloadMedia();
              await client.sendMessage(adminChatId, media, {
                caption: forwardText,
              });
            } else {
              await client.sendMessage(adminChatId, forwardText);
            }
          }
        }
      }

      const [command, ...args] = message.body.split(/\s+(.+)/);
      const commandHandler = this.commands[command];

      if (commandHandler) {
        if (!this.#areCommandsEnabled && !commandHandler.adminOnly) {
          await message.reply("Commands are currently disabled.");
          return;
        }

        if (this.#disabledCommands.has(command) && !commandHandler.adminOnly) {
          await message.reply(
            `The command "${command}" is currently disabled.`,
          );
          return;
        }

        if (commandHandler.adminOnly && !(await this.isAdmin(message))) {
          await message.reply(
            "This command is only available to administrators.",
          );
          return;
        }
        if (this.isRateLimited(chat.id._serialized)) {
          await message.reply(
            "Please wait a moment before sending more messages.",
          );
          return;
        }

        await commandHandler.handler(message, chat, args[0]);
        this.#stats.commandsProcessed++;
        return;
      }

      const isMentioned = message.mentionedIds?.includes(message.to);
      const isReplyToBot =
        message.hasQuotedMsg &&
        (await message.getQuotedMessage()).from === message.to;

      if (this.#isAIEnabled && (isMentioned || isReplyToBot)) {
        await chat.sendStateTyping();
        const quotedMessage = message.hasQuotedMsg
          ? await message.getQuotedMessage()
          : null;
        const response = await this.generateEgyptianResponse(
          message,
          quotedMessage,
        );
        await message.reply(response);
        this.#stats.aiResponses++;
        return;
      }

      await Promise.all([
        this.handleAutoDownload(message),
        this.forwardToWebhooks(message),
      ]);
    } catch (error) {
      console.error("Error processing message:", error);
      this.#stats.errors++;
      throw error;
    } finally {
      const processingTime = Date.now() - startProcessing;
      this.#stats.processingTimes.push(processingTime);
      if (this.#stats.processingTimes.length > 1000) {
        this.#stats.processingTimes.shift();
      }
    }
  }

  async handleAutoDownload(message) {
    return handleAutoDownload(message);
  }

  async forwardToWebhooks(message) {
    if (this.#webhookUrls.length === 0) return;

    const webhookData = {
      messageId: message.id._serialized,
      from: message.from,
      to: message.to,
      body: message.body,
      messageLinks: message.links || [],
      timestamp: message.timestamp,
      type: message.type,
      hasMedia: message.hasMedia,
    };

    await Promise.allSettled(
      this.#webhookUrls.map((url) =>
        axios
          .post(url, webhookData, {
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
          })
          .catch((error) => {
            console.error(`Webhook delivery failed for ${url}:`, error.message);
          }),
      ),
    );
  }
}

// Create instance and initialize commands
const messageHandler = new MessageHandler();
messageHandler.initializeCommands();
messageHandler.start();

export default messageHandler;
