import axios from "axios";
import { handleAutoDownload } from "../utils/handleAutoDownload.js";
import dotenv from "dotenv";

dotenv.config();

// Get webhook URLs from environment variables
const webhookUrls = process.env.WEBHOOK_URLS ? process.env.WEBHOOK_URLS.split(',') : [];

export async function forwardToWebhooks(message) {
  if (webhookUrls.length === 0) return;

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
    webhookUrls.map((url) =>
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
