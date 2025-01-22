import WhatsAppWeb from "whatsapp-web.js";
import puppeteer from "puppeteer";
import { logger } from "../../utils/logger.js";
import { Commands } from "../../config/database.js";
import { env } from "../../config/env.js";
import { messageHandler } from "./messageHandler.js";
const { Client, LocalAuth } = WhatsAppWeb;

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT_ATTEMPTS = 5;
    this.RECONNECT_DELAY = 5000;
  }

  async initialize() {
    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          clientId: "whatsapp-bot",
          dataPath: env.SESSION_DATA_PATH,
        }),
        puppeteer: {
          headless: true,
          executablePath: puppeteer.executablePath(),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--proxy-server=http://127.0.0.1:8002",
          ],
        },
      });

      this.setupEventHandlers();
      await this.client.initialize();

      // Initialize commands in database
      await this.initializeCommands();
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize WhatsApp client");
      throw error;
    }
  }

  getClient() {
    if (!this.client) {
      throw new Error("WhatsApp client is not initialized yet.");
    }
    return this.client;
  }

  setupEventHandlers() {
    this.client.on("authenticated", () => {
      logger.info("WhatsApp client authenticated");
      this.isAuthenticated = true;
    });

    this.client.on("auth_failure", (error) => {
      logger.error({ err: error }, "WhatsApp authentication failed");
      this.isAuthenticated = false;
      this.handleReconnect();
    });

    this.client.on("disconnected", (reason) => {
      logger.warn("WhatsApp client disconnected:", reason);
      this.isAuthenticated = false;
      this.handleReconnect();
    });

    this.client.on("ready", () => {
      logger.info("WhatsApp client is ready");
      this.reconnectAttempts = 0;
    });

    this.client.on("message", async (message) => {
      messageHandler.handleMessage(message);
    });
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error("Max reconnection attempts reached");
      process.exit(1);
    }

    this.reconnectAttempts++;
    logger.info(
      `Attempting to reconnect (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})`,
    );

    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        logger.error({ err: error }, "Reconnection attempt failed");
        this.handleReconnect();
      }
    }, this.RECONNECT_DELAY);
  }

  async initializeCommands() {
    const defaultCommands = [
      {
        name: "help",
        enabled: true,
        adminOnly: false,
        usageCount: 0,
        category: "general",
        description:
          "Displays a list of all available commands and their usage",
        usage: "!help [command]",
      },
      {
        name: "toggleai",
        enabled: true,
        adminOnly: true,
        usageCount: 0,
        category: "admin",
        description: "Toggles the AI response functionality on or off",
        usage: "!toggleai",
      },
      {
        name: "togglecmd",
        enabled: true,
        adminOnly: true,
        usageCount: 0,
        category: "admin",
        description: "Enables or disables a specified command",
        usage: "!togglecmd <command_name>",
      },
      {
        name: "pfp",
        enabled: true,
        adminOnly: false,
        usageCount: 0,
        category: "utility",
        description:
          "Retrieves the profile picture of a mentioned user or number",
        usage: "!pfp <@mention or number>",
      },
      {
        name: "logs",
        enabled: true,
        adminOnly: true,
        usageCount: 0,
        category: "admin",
        description: "Displays bot statistics and command usage information",
        usage: "!logs",
      },
      {
        name: "speak",
        enabled: true,
        adminOnly: false,
        usageCount: 0,
        category: "media",
        description: "Converts a quoted text message into voice audio",
        usage: "!speak (quote a message)",
      },
      {
        name: "img",
        enabled: true,
        adminOnly: false,
        usageCount: 0,
        category: "media",
        description: "Searches and sends an image based on the given query",
        usage: "!img <search query>",
      },
      {
        name: "msg",
        enabled: true,
        adminOnly: true,
        usageCount: 0,
        category: "admin",
        description: "Sends a message to a specified user through the bot",
        usage: "!msg <@mention or number> <message>",
      },
    ];

    const insertPromises = defaultCommands.map((command) =>
      Commands.upsert(
        { name: command.name },
        {
          $set: {
            description: command.description,
            category: command.category,
            usage: command.usage,
            enabled: command.enabled,
            adminOnly: command.adminOnly,
          },
          $setOnInsert: {
            lastUsed: new Date(),
            usageCount: 0,
          },
        },
      ),
    );

    await Promise.all(insertPromises);
  }

  async shutdown() {
    try {
      if (this.client) {
        await this.client.destroy();
        logger.info("WhatsApp client destroyed");
      }
    } catch (error) {
      logger.error({ err: error }, "Error during WhatsApp client shutdown");
    }
  }
}

export const whatsappClient = new WhatsAppClient();
