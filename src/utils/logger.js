import chalk from "chalk";
import { env } from "../config/env.js";
import { whatsappClient } from "../services/whatsapp/client.js";

const isDev = process.env.NODE_ENV === "development";

// Helper function to safely stringify errors
const safeStringify = (obj) => {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
          ...(value.response?.data && { responseData: value.response.data }),
          ...(value.response?.status && { status: value.response.status }),
        };
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) {
          return "[Circular]";
        }
        seen.add(value);
      }
      return value;
    },
    2
  );
};

const logger = {
  info: (message, ...args) =>
    console.log(chalk.blue(`[INFO]: ${message}`), ...args),
  debug: (message, ...args) =>
    isDev && console.debug(chalk.green(`[DEBUG]: ${message}`), ...args),
  warn: (message, ...args) =>
    console.warn(chalk.yellow(`[WARN]: ${message}`), ...args),
  error: (error, message, ...args) => {
    const errorObj = {
      timestamp: new Date().toISOString(),
      message: message,
      error: error,
      additionalInfo: args,
    };

    console.error(chalk.red(`[ERROR]: ${message}`), error, ...args);

    // Queue sending the message instead of waiting inside logger
    sendMessageToAdmins(`🚨 *Error Report*\n\n${safeStringify(errorObj)}`).catch(
      (err) => console.error(chalk.red("[LOGGER ERROR] Failed to notify admins"), err)
    );
  },
};

// ✅ Move `sendMessageToAdmins` Below Logger to Prevent Circular Import Issues
const sendMessageToAdmins = async (message) => {
  try {
    const adminPhones = env.ADMIN || [];
    await Promise.all(
      adminPhones.map(async (adminPhone) => {
        const chatId = `${adminPhone}@c.us`;
        await whatsappClient.getClient().sendMessage(chatId, message);
      })
    );
  } catch (err) {
    console.error(chalk.red("[ADMIN NOTIFICATION ERROR]"), err);
  }
};

export { logger };
