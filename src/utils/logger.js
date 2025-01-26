import chalk from "chalk";
import { env } from "../config/env.js";

const isDev = process.env.NODE_ENV === "development";

const logger = {
  info: (message, ...args) =>
    console.log(chalk.blue(`[INFO]: ${message}`), ...args),
  debug: (message, ...args) =>
    isDev && console.debug(chalk.green(`[DEBUG]: ${message}`), ...args),
  warn: (message, ...args) =>
    console.warn(chalk.yellow(`[WARN]: ${message}`), ...args),
  error: (message, ...args) =>
    console.error(chalk.red(`[ERROR]: ${message}`), ...args),
};

export { logger };
