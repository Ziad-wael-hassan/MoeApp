import { fetchInstagramVideo } from "./instagram.js";
import { fetchTikTokMedia } from "./tiktok.js";
import { fetchFacebookVideo } from "./facebook.js";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";

const { MessageMedia } = WhatsAppWeb;

// Cache for recently processed URLs to avoid duplicate downloads
const mediaCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;
const MAX_RETRIES = 3;
const PROCESSING_TIMEOUT = 60000; // 60 seconds

// Configure axios instance with defaults
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

// URL extraction with pattern matching optimization
function extractUrl(messageBody) {
  // Use a single regex with all patterns combined for better performance
  const combinedPattern = new RegExp(
    Object.values(MEDIA_PATTERNS)
      .map((pattern) => pattern.source)
      .join("|"),
    "i",
  );

  const match = messageBody.match(combinedPattern);
  return match ? match[0] : null;
}

// Media type determination
const getMediaType = (url) => {
  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform;
  }
  return null;
};

// Cache management
function manageCache() {
  if (mediaCache.size > MAX_CACHE_SIZE) {
    const oldestEntry = mediaCache.keys().next().value;
    mediaCache.delete(oldestEntry);
  }

  // Clear expired entries
  const now = Date.now();
  for (const [url, { timestamp }] of mediaCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      mediaCache.delete(url);
    }
  }
}

/**
 * Downloads media with retries and error handling
 * @param {string} url - Media URL
 * @returns {Promise<Object>}
 */
async function downloadMedia(url) {
  // Check cache first
  if (mediaCache.has(url)) {
    const cached = mediaCache.get(url);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }
    mediaCache.delete(url);
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axiosInstance.get(url, {
        responseType: "arraybuffer",
      });

      const result = {
        base64: Buffer.from(response.data).toString("base64"),
        mimeType:
          response.headers["content-type"] || "application/octet-stream",
      };

      // Cache the result
      mediaCache.set(url, {
        data: result,
        timestamp: Date.now(),
      });
      manageCache();

      return result;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw new Error(
    `Failed to download media after ${MAX_RETRIES} attempts: ${lastError.message}`,
  );
}

/**
 * Sends media with progress tracking
 * @param {string|string[]} urls - URLs to process
 * @param {object} message - WhatsApp message object
 */
async function sendMedia(urls, message) {
  const urlArray = Array.isArray(urls) ? urls : [urls];
  const results = { success: 0, failed: 0 };

  for (const url of urlArray) {
    try {
      const { base64, mimeType } = await downloadMedia(url);
      const media = new MessageMedia(mimeType, base64);
      await message.reply(media, null);
      results.success++;
    } catch (error) {
      console.error("Failed to send media:", error.message);
      results.failed++;
    }
  }

  console.log(
    `Media sending complete: ${results.success} successful, ${results.failed} failed`,
  );
  return results;
}

/**
 * Main handler for auto-download functionality
 * @param {object} message - WhatsApp message object
 */
export async function handleAutoDownload(message) {
  const chat = await message.getChat();
  let processingTimeout;

  try {
    const url = extractUrl(message.body);
    if (!url) return;

    await chat.sendStateTyping();

    // Set a processing timeout
    const timeoutPromise = new Promise((_, reject) => {
      processingTimeout = setTimeout(() => {
        reject(new Error("Processing timeout"));
      }, PROCESSING_TIMEOUT);
    });

    // Race between processing and timeout
    await Promise.race([
      (async () => {
        const mediaType = getMediaType(url);
        if (!mediaType) throw new Error("Unsupported media URL");

        let mediaData;
        switch (mediaType) {
          case "INSTAGRAM":
            mediaData = await fetchInstagramVideo(url);
            break;
          case "TIKTOK":
            mediaData = await fetchTikTokMedia(url);
            if (mediaData.type === "images") {
              await sendMedia(mediaData.urls, message);
              return;
            }
            mediaData = mediaData.url;
            break;
          case "FACEBOOK":
            mediaData = await fetchFacebookVideo(url);
            break;
        }

        if (mediaData) {
          if (typeof mediaData === "string" && mediaData.startsWith("data:")) {
            const media = new MessageMedia(
              "video/mp4",
              mediaData.split(",")[1],
            );
            await message.reply(media, null);
          } else {
            await sendMedia(mediaData, message);
          }
        }
      })(),
      timeoutPromise,
    ]);
  } catch (error) {
    console.error("Error in handleAutoDownload:", error);
    if (error.message === "Processing timeout") {
      await message.reply(
        "Sorry, the media processing took too long. Please try again.",
      );
    } else {
      await message.reply(
        "Sorry, I couldn't process that media link. Please try again later.",
      );
    }
  } finally {
    clearTimeout(processingTimeout);
    await chat.clearState().catch(console.error);
  }
}
