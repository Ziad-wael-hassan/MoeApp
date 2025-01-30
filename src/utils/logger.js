import chalk from "chalk";
import { env } from "../config/env.js";
import { whatsappClient } from "../services/whatsapp/client.js";

const isDev = process.env.NODE_ENV === "development";

const sendMessageToAdmins = async (message) => {
  const adminPhones = env.ADMIN || [];
  await Promise.all(
    adminPhones.map(async (adminPhone) => {
      const chatId = `${adminPhone}@c.us`;
      await whatsappClient.getClient().sendMessage(chatId, message);
    }),
  );
};

const logger = {
  info: (message, ...args) =>
    console.log(chalk.blue(`[INFO]: ${message}`), ...args),
  debug: (message, ...args) =>
    isDev && console.debug(chalk.green(`[DEBUG]: ${message}`), ...args),
  warn: (message, ...args) =>
    console.warn(chalk.yellow(`[WARN]: ${message}`), ...args),
  error: async (message, ...args) => {
    const errorMessage = chalk.red(`[ERROR]: ${message}`);
    console.error(errorMessage, ...args);

    // Format the error message and arguments to send to admins
    const adminMessage = `${errorMessage}\n${args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg)).join("\n")}`;
    await sendMessageToAdmins(adminMessage);
  },
};

export { logger };
