// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";

const { MessageMedia } = WhatsAppWeb;
const PROCESSING_TIMEOUT = 60000; // 60 seconds

// Configure axios instance
const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 10,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept: "image/*, video/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
  validateStatus: (status) => status >= 200 && status < 300,
  maxContentLength: 50 * 1024 * 1024, // 50MB max
  maxBodyLength: 50 * 1024 * 1024, // 50MB max
});

async function extractMediaWithCobalt(url, options = {}) {
  const cobaltUrl = "https://nuclear-ashien-cobalto-d51291d3.koyeb.app/";

  const payload = {
    url,
    videoQuality: "720",
    youtubeHLS: true,
    twitterGif: false,
    tiktokH265: true,
    alwaysProxy: true,
    ...options,
  };

  try {
    const response = await axios.post(cobaltUrl, payload, {
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (response.status !== 200 || !response.data) {
      throw new Error("Failed to fetch media details from Cobalt");
    }

    return response.data;
  } catch (error) {
    logger.error("Cobalt extraction error:", error);
    throw error;
  }
}

// Extract URLs from message
function extractUrl(messageBody) {
  if (!messageBody) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match && match[0]) return match[0];
  }
  return null;
}

// Download media
async function downloadMedia(url) {
  if (!url) throw new Error("Invalid media URL");

  const response = await axiosInstance.get(url, {
    responseType: "arraybuffer",
    timeout: PROCESSING_TIMEOUT,
  });

  const buffer = Buffer.from(response.data);
  const base64 = buffer.toString("base64");
  const mimeType =
    response.headers["content-type"] || "application/octet-stream";

  return { base64, mimeType };
}

async function sendMedia(url, message) {
  if (!url || !message) return false;

  try {
    const mediaData = await extractMediaWithCobalt(url);

    logger.debug(`Extracted media data: ${JSON.stringify(mediaData)}`);

    if (mediaData.status === "picker" && Array.isArray(mediaData.picker)) {
      for (const item of mediaData.picker) {
        if (item.type === "photo" && item.url) {
          const { base64, mimeType } = await downloadMedia(item.url);
          logger.debug(
            `Downloaded media - URL: ${item.url}, MIME type: ${mimeType}, size: ${base64.length} bytes`,
          );

          const media = new MessageMedia(mimeType, base64);
          await message.reply(media);
        }
      }
    } else {
      const mediaUrls = Array.isArray(mediaData.url)
        ? mediaData.url
        : [mediaData.url];

      for (const mediaUrl of mediaUrls) {
        const { base64, mimeType } = await downloadMedia(mediaUrl);
        logger.debug(
          `Downloaded media - URL: ${mediaUrl}, MIME type: ${mimeType}, size: ${base64.length} bytes`,
        );

        const media = new MessageMedia(mimeType, base64, mediaData.filename);
        await message.reply(media);
      }
    }

    return true;
  } catch (error) {
    logger.error("Error in processing media:", error);
    return false;
  }
}

// Main handler for media extraction
export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  try {
    const url = extractUrl(message.body);
    if (!url) return { processed: false };

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const success = await sendMedia(url, message);

    return {
      processed: success,
      url,
    };
  } catch (error) {
    logger.error("Error in handling media");
    return { processed: false, error: error.message };
  }
}
