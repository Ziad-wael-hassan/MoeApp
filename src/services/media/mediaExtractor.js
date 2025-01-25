// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";
import {
  extractInstagramMedia,
  extractTikTokMedia,
  extractFacebookMedia,
  extractSoundCloudMedia,
} from "./extractors.js";

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

// Extract URLs from message
function extractUrl(messageBody) {
  if (!messageBody) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match && match[0]) return match[0];
  }
  return null;
}

// Determine media type from URL
function getMediaType(url) {
  if (!url) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform.toLowerCase();
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

// Extract media URL based on platform
async function extractMediaUrl(url, mediaType) {
  if (!url || !mediaType) {
    throw new Error("Invalid URL or media type");
  }

  const extractors = {
    instagram: extractInstagramMedia,
    tiktok: extractTikTokMedia,
    facebook: extractFacebookMedia,
    soundcloud: extractSoundCloudMedia, // This extractor returns a buffer.
  };

  const extractor = extractors[mediaType];
  if (!extractor) {
    throw new Error(`No extractor available for media type: ${mediaType}`);
  }

  try {
    const extractPromise = extractor(url);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Media extraction timed out")),
        PROCESSING_TIMEOUT,
      ),
    );

    // Wait for either the extraction or timeout
    const mediaData = await Promise.race([extractPromise, timeoutPromise]);

    if (mediaData.buffer) {
      // If the extractor returns a buffer, pass it as-is
      return mediaData; // { buffer, mimeType }
    }

    // Otherwise, assume it's a URL
    return { url: mediaData };
  } catch (error) {
    logger.error("Media extraction failed:", error);
    throw error;
  }
}

async function sendMedia(url, message) {
  if (!url || !message) return false;

  try {
    const mediaType = getMediaType(url);
    if (!mediaType) return false;

    logger.info(`Processing ${mediaType} URL: ${url}`);
    const mediaData = await extractMediaUrl(url, mediaType);

    logger.debug(`Extracted media data: ${JSON.stringify(mediaData)}`);

    if (mediaType === "soundcloud" && mediaData.buffer) {
      // Validate buffer before sending
      if (Buffer.isBuffer(mediaData.buffer) && mediaData.buffer.length > 0) {
        const base64Buffer = mediaData.buffer.toString("base64");
        const media = new MessageMedia(mediaData.mimeType, base64Buffer);

        await message.reply(media);
        return true;
      } else {
        throw new Error("Invalid buffer returned from SoundCloud extractor");
      }
    }

    // For URL-based media, proceed as usual
    const mediaUrls = Array.isArray(mediaData.url)
      ? mediaData.url
      : [mediaData.url];

    for (const mediaUrl of mediaUrls) {
      const { base64, mimeType } = await downloadMedia(mediaUrl);
      logger.debug(
        `Downloaded media - URL: ${mediaUrl}, MIME type: ${mimeType}, size: ${base64.length} bytes`,
      );

      const media = new MessageMedia(mimeType, base64);
      await message.reply(media);
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

    const mediaType = getMediaType(url);
    if (!mediaType) return { processed: false };

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const success = await sendMedia(url, message);

    return {
      processed: success,
      mediaType,
      url,
    };
  } catch (error) {
    logger.error("Error in handling media");
    return { processed: false, error: error.message };
  }
}
