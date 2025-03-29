import { Baileys, makeWASocket, useMultiFileAuthState } from '@adiwajshing/baileys';
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

/**
 * WhatsApp client implementation with reconnection handling
 */
class WhatsAppClient {
  constructor() {
    this.client = null;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Initialize the WhatsApp client with proper configuration
   */
  async initialize() {
    try {
      const { state, saveState } = await useMultiFileAuthState(env.SESSION_DATA_PATH);
      this.client = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      this.setupEventHandlers();
      await this.client.ev.on('creds.update', saveState);
      await this.initializeCommands();
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize WhatsApp client");
      throw error;
    }
  }

  // Rest of the class methods
}
