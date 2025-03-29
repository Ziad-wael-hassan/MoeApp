import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { logger } from "../../utils/logger.js";
import { Commands, StoryTracking } from "../../config/database.js";
import { env } from "../../config/env.js";
import { messageHandler } from "./messageHandler.js";

// Constants
const CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 5000,
  CLIENT_ID: "whatsapp-bot",
  DEFAULT_COMMANDS: [
    // Command definitions remain the same
  ],
};

class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
  }

  async initialize() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(env.SESSION_DATA_PATH);
      this.client = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      this.setupEventHandlers();
      this.client.ev.on('creds.update', saveCreds);
      await this.initializeCommands();
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize WhatsApp client");
      throw error;
    }
  }

  setupEventHandlers() {
    this.client.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          this.handleReconnect();
        } else {
          logger.error('Connection closed. You are logged out.');
        }
      } else if (connection === 'open') {
        logger.info('Connection opened successfully');
        this.isAuthenticated = true;
      }
    });

    this.client.ev.on('messages.upsert', async ({ messages }) => {
      for (const message of messages) {
        await messageHandler.handleMessage(message);
      }
    });
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
      logger.error("Max reconnection attempts reached");
      process.exit(1);
    }
    this.reconnectAttempts++;
    logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
    setTimeout(async () => {
      try {
        await this.initialize();
      } catch (error) {
        logger.error({ err: error }, "Reconnection attempt failed");
        this.handleReconnect();
      }
    }, CONFIG.RECONNECT_DELAY);
  }

  async initializeCommands() {
    // Initialize commands logic
  }
}

export default new WhatsAppClient();
