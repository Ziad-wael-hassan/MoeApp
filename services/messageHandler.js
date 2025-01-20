import { commands, stats, isAIEnabled, areCommandsEnabled, disabledCommands } from "./commandHandler.js";
import { processMessageQueue } from "./messageProcessor.js";
import dotenv from "dotenv";

dotenv.config();

class MessageHandler {
  constructor() {
    this.messageQueue = [];
    this.disabledCommands = disabledCommands;
    this.adminNumbers = process.env.ADMIN ? process.env.ADMIN.split(",").map((num) => num.trim()) : [];
    this.isAIEnabled = isAIEnabled;
    this.areCommandsEnabled = areCommandsEnabled;
    this.stats = stats;
    this.commands = commands;

    this.handleMessage = this.handleMessage.bind(this);
  }

  async handleMessage(message) {
    try {
      if (!message.chat) {
        message.chat = await message.getChat();
      }

      this.messageQueue.push(message);
      console.log("Message received and added to the queue:", message.body);
    } catch (error) {
      console.error("Error handling message:", error);
    }
  }

  start() {
    processMessageQueue(this.messageQueue, this);
  }
}

const messageHandler = new MessageHandler();
messageHandler.start();

export default messageHandler;
