// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";

const { MessageMedia } = WhatsAppWeb;
const PROCESSING_TIMEOUT = 60000; // 60 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

// Configure axios instance
const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 10,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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
      timeout: PROCESSING_TIMEOUT,
    });

    if (response.status !== 200 || !response.data) {
      throw new Error("Failed to fetch media details from Cobalt");
    }

    return response.data;
  } catch (error) {
    logger.error("Cobalt extraction error:", error);
    throw new Error(`Failed to extract media: ${error.message}`);
  }
}

function extractUrl(messageBody) {
  if (!messageBody) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match && match[0]) return match[0];
  }
  return null;
}

function getMediaType(url) {
  if (!url) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform.toLowerCase();
  }
  return null;
}

async function downloadMedia(url, retryCount = 0) {
  if (!url) throw new Error("Invalid media URL");

  try {
    const response = await axiosInstance.get(url, {
      responseType: "arraybuffer",
      timeout: PROCESSING_TIMEOUT,
    });

    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString("base64");
    const mimeType = response.headers["content-type"] || "application/octet-stream";

    // Validate the downloaded content
    if (buffer.length === 0) {
      throw new Error("Empty media content");
    }

    return { base64, mimeType };
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn(`Retry ${retryCount + 1}/${MAX_RETRIES} for URL: ${url}`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return downloadMedia(url, retryCount + 1);
    }
    throw new Error(`Download failed after ${MAX_RETRIES} attempts: ${error.message}`);
  }
}

async function sendMediaWithRetry(media, message, retryCount = 0) {
  try {
    await message.reply(media);
    return true;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn(`Retry ${retryCount + 1}/${MAX_RETRIES} for sending media`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return sendMediaWithRetry(media, message, retryCount + 1);
    }
    throw error;
  }
}

async function validateMedia(mediaData) {
  if (!mediaData) {
    throw new Error("Invalid media data received");
  }

  if (mediaData.status === "error" || mediaData.error) {
    throw new Error(mediaData.error || "Unknown error in media data");
  }

  if (!mediaData.url && (!mediaData.picker || !mediaData.picker.length)) {
    throw new Error("No valid media URL found in response");
  }

  return true;
}

async function sendMedia(url, message) {
  if (!url || !message) return false;

  try {
    const mediaData = await extractMediaWithCobalt(url);
    await validateMedia(mediaData);

    if (mediaData.status === "picker" && Array.isArray(mediaData.picker)) {
      for (const item of mediaData.picker) {
        if (item.type === "photo" && item.url) {
          try {
            const { base64, mimeType } = await downloadMedia(item.url);
            const media = new MessageMedia(mimeType, base64);
            await sendMediaWithRetry(media, message);
          } catch (error) {
            logger.error(`Failed to process picker item: ${error.message}`);
            continue;
          }
        }
      }
    } else {
      const mediaUrls = Array.isArray(mediaData.url) ? mediaData.url : [mediaData.url];

      for (const mediaUrl of mediaUrls) {
        try {
          const { base64, mimeType } = await downloadMedia(mediaUrl);
          const media = new MessageMedia(mimeType, base64);
          await sendMediaWithRetry(media, message);
        } catch (error) {
          logger.error(`Failed to process media URL: ${error.message}`);
          continue;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error("Error in processing media:", {
      error: error.message,
      stack: error.stack,
      url: url
    });
    await message.reply(`Sorry, I couldn't process that media: ${error.message}`);
    return false;
  }
}

export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  const chat = await message.getChat();
  let processingState = false;

  try {
    const url = extractUrl(message.body);
    if (!url) return { processed: false };

    processingState = true;
    await chat.sendStateTyping();

    const success = await sendMedia(url, message);

    return {
      processed: success,
      url,
    };
  } catch (error) {
    logger.error("Error in handling media", {
      error: error.message,
      stack: error.stack,
      messageBody: message.body
    });
    return { processed: false, error: error.message };
  } finally {
    if (processingState) {
      try {
        await chat.clearState();
      } catch (error) {
        logger.error("Error clearing chat state:", error);
      }
    }
  }
}
