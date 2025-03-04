// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";
import fs from "fs";
const fsPromises = fs.promises;
import path from "path";
import os from "os";
import crypto from "crypto";

const { MessageMedia } = WhatsAppWeb;

// Configuration constants
const CONFIG = {
  PROCESSING_TIMEOUT: 60000, // 60 seconds
  MAX_RETRIES: 3, // Maximum number of retry attempts
  RETRY_DELAY: 2000, // Base delay between retries (ms)
  MAX_DOWNLOAD_SIZE: 50 * 1024 * 1024, // 50MB max
  DEFAULT_TIMEOUT: 30000, // 30 seconds
};

// Configure axios instance with improved settings
const axiosInstance = axios.create({
  timeout: CONFIG.DEFAULT_TIMEOUT,
  maxRedirects: 10,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept: "image/*, video/*, audio/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
  },
  validateStatus: (status) => status >= 200 && status < 300,
  maxContentLength: CONFIG.MAX_DOWNLOAD_SIZE,
  maxBodyLength: CONFIG.MAX_DOWNLOAD_SIZE,
  // Add these options to prevent memory issues with large responses
  decompress: true, // Handle gzip/deflate content
});

/**
 * Generic retry wrapper for async functions
 * @param {Function} fn - Function to execute
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of the function
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = CONFIG.MAX_RETRIES,
    retryDelay = CONFIG.RETRY_DELAY,
    onRetry = null,
    retryCondition = (error) => true,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry based on the error
      if (attempt <= maxRetries && retryCondition(error)) {
        // Calculate exponential backoff delay
        const delay = retryDelay * Math.pow(2, attempt - 1);

        // Log retry attempt
        logger.info(
          `Retry attempt ${attempt}/${maxRetries} after ${delay}ms delay. Error: ${error.message}`,
        );

        // Execute onRetry callback if provided
        if (onRetry && typeof onRetry === "function") {
          onRetry(error, attempt);
        }

        // Wait before next retry
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // We've exceeded max retries or condition says don't retry
        throw error;
      }
    }
  }
}

/**
 * Extract media details using Cobalt API
 * @param {string} url - URL to extract media from
 * @param {Object} options - Additional options for Cobalt
 * @returns {Promise<Object>} - Media details
 */
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

  return withRetry(
    async () => {
      const response = await axios.post(cobaltUrl, payload, {
        headers: {
          accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: CONFIG.PROCESSING_TIMEOUT,
      });

      if (response.status !== 200 || !response.data) {
        throw new Error("Failed to fetch media details from Cobalt");
      }

      return response.data;
    },
    {
      // Retry only on network errors, timeouts, and 5xx server errors
      retryCondition: (error) => {
        return (
          !error.response || // Network error
          error.code === "ECONNABORTED" || // Timeout
          (error.response && error.response.status >= 500) // Server error
        );
      },
      onRetry: (error, attempt) => {
        logger.warn(
          `Cobalt API retry ${attempt} for URL: ${url}. Error: ${error.message}`,
        );
      },
    },
  );
}

/**
 * Extract URLs from message text
 * @param {string} messageBody - Message text
 * @returns {string|null} - Extracted URL or null
 */
function extractUrl(messageBody) {
  if (!messageBody || typeof messageBody !== "string") return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match && match[0]) return match[0];
  }
  return null;
}

/**
 * Generate a temporary file path for storing media
 * @param {string} mimeType - MIME type of the media
 * @returns {string} - Temporary file path
 */
function generateTempFilePath(mimeType) {
  const tempDir = os.tmpdir();
  const randomId = crypto.randomBytes(16).toString("hex");

  // Determine file extension based on MIME type
  let extension = ".bin";
  if (mimeType.startsWith("image/")) {
    extension = mimeType.includes("png")
      ? ".png"
      : mimeType.includes("gif")
        ? ".gif"
        : mimeType.includes("webp")
          ? ".webp"
          : ".jpg";
  } else if (mimeType.startsWith("video/")) {
    extension = mimeType.includes("mp4")
      ? ".mp4"
      : mimeType.includes("webm")
        ? ".webm"
        : ".mp4";
  } else if (mimeType.startsWith("audio/")) {
    extension = mimeType.includes("mp3")
      ? ".mp3"
      : mimeType.includes("ogg")
        ? ".ogg"
        : mimeType.includes("wav")
          ? ".wav"
          : ".mp3";
  }

  return path.join(tempDir, `whatsapp-media-${randomId}${extension}`);
}

/**
 * Download media from URL to temp file
 * @param {string} url - Media URL
 * @returns {Promise<Object>} - Media data including file path
 */
async function downloadMedia(url) {
  if (!url) throw new Error("Invalid media URL");

  return withRetry(
    async () => {
      // Stream the download to a temporary file
      const response = await axiosInstance.get(url, {
        responseType: "stream",
        timeout: CONFIG.PROCESSING_TIMEOUT,
      });

      const mimeType =
        response.headers["content-type"] || "application/octet-stream";
      const tempFilePath = generateTempFilePath(mimeType);

      // Create write stream to file
      const writer = fs.createWriteStream(tempFilePath);

      // Pipe the response data to the file
      response.data.pipe(writer);

      // Wait for download to complete
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
        response.data.on("error", reject);
      });

      // Read the file and convert to base64
      const fileBuffer = await fsPromises.readFile(tempFilePath);
      const base64 = fileBuffer.toString("base64");

      return {
        base64,
        mimeType,
        tempFilePath, // Include the temp file path for later cleanup
      };
    },
    {
      retryCondition: (error) => {
        // Check if error is "stream has been aborted" or other transient errors
        return (
          error.code === "ERR_BAD_RESPONSE" ||
          error.code === "ECONNABORTED" ||
          error.message.includes("timeout") ||
          error.message.includes("stream has been aborted") ||
          (error.response && error.response.status >= 500)
        );
      },
      onRetry: (error, attempt) => {
        logger.warn(
          `Media download retry ${attempt} for URL: ${url}. Error: ${error.message}`,
        );
      },
    },
  );
}

/**
 * Safely send media message with error handling
 * @param {Object} message - WhatsApp message object
 * @param {Object} media - MessageMedia object
 * @param {Object} options - Send options
 * @returns {Promise<boolean>} - Success status
 */
async function safelySendMedia(message, media, options = {}) {
  try {
    return withRetry(
      async () => {
        await message.reply(media, null, options);
        return true;
      },
      {
        retryCondition: (error) => {
          // Only retry on specific WhatsApp API errors
          // Avoid retrying when the error is "Evaluation failed: a"
          return (
            !error.message.includes("Evaluation failed") &&
            (error.message.includes("timeout") ||
              error.message.includes("network") ||
              error.message.includes("ECONNRESET"))
          );
        },
      },
    );
  } catch (error) {
    logger.error(`Failed to send media after retries: ${error.message}`);
    return false;
  }
}

/**
 * Cleanup temporary file
 * @param {string} filePath - Path to temporary file
 */
async function cleanupTempFile(filePath) {
  if (!filePath) return;

  try {
    await fsPromises.unlink(filePath);
    logger.debug(`Cleaned up temporary file: ${filePath}`);
  } catch (error) {
    logger.warn(
      `Failed to clean up temporary file ${filePath}: ${error.message}`,
    );
  }
}

/**
 * Process and send media
 * @param {string} url - Media URL
 * @param {Object} message - WhatsApp message object
 * @returns {Promise<boolean>} - Success status
 */
async function sendMedia(url, message) {
  if (!url || !message) return false;

  // Array to track temporary files for cleanup
  const tempFiles = [];

  try {
    // Extract media data with retries
    const mediaData = await extractMediaWithCobalt(url);
    logger.debug(`Extracted media data: ${JSON.stringify(mediaData)}`);

    let successCount = 0;

    // Handle picker type response (multiple media options)
    if (mediaData.status === "picker" && Array.isArray(mediaData.picker)) {
      for (const item of mediaData.picker) {
        if (item.type === "photo" && item.url) {
          try {
            const { base64, mimeType, tempFilePath } = await downloadMedia(
              item.url,
            );
            if (tempFilePath) tempFiles.push(tempFilePath);

            logger.debug(
              `Downloaded media to ${tempFilePath} - URL: ${item.url}, MIME type: ${mimeType}, size: ${base64.length} bytes`,
            );

            const media = new MessageMedia(mimeType, base64);
            const success = await safelySendMedia(message, media);
            if (success) successCount++;
          } catch (itemError) {
            logger.error(`Error processing picker item: ${itemError.message}`);
            // Continue with next item even if one fails
          }
        }
      }
    } else {
      // Handle single or array of media URLs
      const mediaUrls = Array.isArray(mediaData.url)
        ? mediaData.url
        : [mediaData.url];

      for (const mediaUrl of mediaUrls) {
        try {
          const { base64, mimeType, tempFilePath } =
            await downloadMedia(mediaUrl);
          if (tempFilePath) tempFiles.push(tempFilePath);

          logger.debug(
            `Downloaded media to ${tempFilePath} - URL: ${mediaUrl}, MIME type: ${mimeType}, size: ${base64.length} bytes`,
          );

          const media = new MessageMedia(
            mimeType,
            base64,
            mediaData.filename || undefined,
          );

          // Check mime type and send accordingly
          let success = false;
          if (mimeType.startsWith("audio/")) {
            success = await safelySendMedia(message, media);
          } else {
            success = await safelySendMedia(message, media);
          }

          if (success) successCount++;
        } catch (urlError) {
          logger.error(
            `Error processing media URL ${mediaUrl}: ${urlError.message}`,
          );
          // Continue with next URL even if one fails
        }
      }
    }

    return successCount > 0;
  } catch (error) {
    logger.error(`Error in processing media: ${error.message}`, { error });
    return false;
  } finally {
    // Clean up all temporary files
    await Promise.all(tempFiles.map((filePath) => cleanupTempFile(filePath)));
  }
}

/**
 * Main handler for media extraction
 * @param {Object} message - WhatsApp message object
 * @returns {Promise<Object>} - Processing result
 */
export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  try {
    // Extract URL from message
    const url = extractUrl(message.body);
    if (!url) return { processed: false };

    // Show typing indicator
    try {
      const chat = await message.getChat();
      await chat.sendStateTyping();
    } catch (typingError) {
      // Don't fail if typing indicator fails
      logger.warn(`Failed to send typing indicator: ${typingError.message}`);
    }

    // Process and send media with timeout protection
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Media processing timeout")),
        CONFIG.PROCESSING_TIMEOUT * 1.5,
      ),
    );

    const processingPromise = sendMedia(url, message);

    // Race between processing and timeout
    const success = await Promise.race([
      processingPromise,
      timeoutPromise,
    ]).catch((error) => {
      logger.error(`Media processing error or timeout: ${error.message}`);
      return false;
    });

    return {
      processed: success,
      url,
    };
  } catch (error) {
    logger.error(`Error in handling media extraction: ${error.message}`, {
      error,
    });
    // Try to notify user of failure if possible
    try {
      await message.reply(
        "Sorry, I couldn't process that media link. Please try again later.",
      );
    } catch (replyError) {
      // Ignore errors when trying to send failure message
    }
    return { processed: false, error: error.message };
  }
}
