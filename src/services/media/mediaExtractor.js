import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";

const { MessageMedia } = WhatsAppWeb;
const PROCESSING_TIMEOUT = 60000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

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
  maxContentLength: 50 * 1024 * 1024,
  maxBodyLength: 50 * 1024 * 1024,
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

function sanitizeUrl(url) {
  try {
    if (!url) return null;

    // Remove any leading/trailing whitespace
    url = url.trim();

    // Try to construct a URL object (will throw if invalid)
    const urlObject = new URL(url);

    // Ensure the protocol is either http or https
    if (!["http:", "https:"].includes(urlObject.protocol)) {
      throw new Error("Invalid protocol");
    }

    // Return the cleaned URL string
    return urlObject.toString();
  } catch (error) {
    logger.error(`Invalid URL: ${url}`, error);
    return null;
  }
}

// Modified downloadMedia function with improved error handling
async function downloadMedia(url, retryCount = 0) {
  const sanitizedUrl = sanitizeUrl(url);
  if (!sanitizedUrl) throw new Error("Invalid media URL format");

  try {
    const response = await axiosInstance.get(sanitizedUrl, {
      responseType: "arraybuffer",
      timeout: PROCESSING_TIMEOUT,
      maxRedirects: 5,
      headers: {
        Accept: "*/*",
        "Accept-Encoding": "gzip, deflate, br",
      },
      validateStatus: (status) => status === 200, // Only accept 200 status
    });

    const buffer = Buffer.from(response.data);

    // Validate buffer size
    if (buffer.length === 0) {
      throw new Error("Empty media content");
    }
    if (buffer.length > 50 * 1024 * 1024) {
      // 50MB limit
      throw new Error("Media content too large");
    }

    const mimeType = response.headers["content-type"];
    // Validate mime type
    if (!mimeType || !mimeType.match(/^(image|video|audio)/i)) {
      throw new Error("Invalid media type");
    }

    const base64 = buffer.toString("base64");
    return { base64, mimeType };
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn(
        `Retry ${retryCount + 1}/${MAX_RETRIES} for URL: ${sanitizedUrl}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY * (retryCount + 1)),
      ); // Exponential backoff
      return downloadMedia(sanitizedUrl, retryCount + 1);
    }
    throw new Error(`Download failed: ${error.message}`);
  }
}

// Modified sendMediaWithRetry function with improved error handling
async function sendMediaWithRetry(media, message, retryCount = 0) {
  try {
    // Validate media object
    if (!media || !media.mimetype || !media.data) {
      throw new Error("Invalid media object");
    }

    await message.reply(media);
    return true;
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      logger.warn(`Retry ${retryCount + 1}/${MAX_RETRIES} for sending media`);
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAY * (retryCount + 1)),
      ); // Exponential backoff
      return sendMediaWithRetry(media, message, retryCount + 1);
    }
    throw error;
  }
}

// Modified sendMedia function with improved error handling
async function sendMedia(url, message) {
  if (!url || !message) return false;

  try {
    const mediaData = await extractMediaWithCobalt(url);
    await validateMedia(mediaData);

    const processedUrls = new Set(); // Track processed URLs to avoid duplicates
    let successCount = 0;

    async function processUrl(mediaUrl) {
      const sanitizedUrl = sanitizeUrl(mediaUrl);
      if (!sanitizedUrl || processedUrls.has(sanitizedUrl)) return;
      processedUrls.add(sanitizedUrl);

      try {
        // First attempt: Try with axios and base64
        try {
          const { base64, mimeType } = await downloadMedia(sanitizedUrl);
          console.log("base64", base64);
          console.log("mimeType", mimeType);
          const media = new MessageMedia(mimeType, base64);
          await sendMediaWithRetry(media, message);
          successCount++;
        } catch (base64Error) {
          logger.warn(
            `Base64 method failed, trying MessageMedia.fromUrl: ${base64Error.message}`,
          );

          // Second attempt: Try with MessageMedia.fromUrl
          const media = await MessageMedia.fromUrl(sanitizedUrl, {
            unsafeMime: true,
          });
          await sendMediaWithRetry(media, message);
          successCount++;
        }
      } catch (error) {
        logger.error(`Failed to process URL ${sanitizedUrl}: ${error.message}`);
      }
    }

    if (mediaData.status === "picker" && Array.isArray(mediaData.picker)) {
      for (const item of mediaData.picker) {
        if (item.type === "photo" && item.url) {
          await processUrl(item.url);
        }
      }
    } else {
      const mediaUrls = Array.isArray(mediaData.url)
        ? mediaData.url
        : [mediaData.url];
      for (const mediaUrl of mediaUrls) {
        await processUrl(mediaUrl);
      }
    }

    if (successCount === 0) {
      throw new Error("Failed to process any media URLs");
    }

    return true;
  } catch (error) {
    logger.error("Error in processing media:", {
      error: error.message,
      stack: error.stack,
      url: url,
    });
    await message.reply(
      `Sorry, I couldn't process that media: ${error.message}`,
    );
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
      messageBody: message.body,
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
