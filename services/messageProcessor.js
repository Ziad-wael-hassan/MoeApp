import { forwardToWebhooks } from "./auto.js";
import { handleAutoDownload } from "../utils/handleAutoDownload.js";
import { isRateLimited } from "./rateLimiter.js";

export async function processMessageQueue(queue, handler) {
  while (true) {
    if (queue.length > 0) {
      const message = queue.shift();

      if (!message || !message.chat) {
        console.warn("Skipped invalid message:", message);
        continue;
      }

      try {
        await processMessage(message, handler);
      } catch (error) {
        console.error("Error processing message:", error);
        handler.stats.errors++;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function processMessage(message, handler) {
  if (isRateLimited(message.chat.id, handler)) {
    await message.reply("You're sending messages too quickly!");
    return;
  }

  if (handler.commands[message.body]) {
    const command = handler.commands[message.body];
    await command.handler(message, handler);
    handler.stats.commandsProcessed++;
  }

  await Promise.all([handleAutoDownload(message), forwardToWebhooks(message)]);
}
