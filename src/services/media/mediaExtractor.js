// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";

const { MessageMedia } = WhatsAppWeb;

// Constants
const CONSTANTS = {
  PROCESSING_TIMEOUT: 60000, // 60 seconds
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
  COBALT_URL: "https://nuclear-ashien-cobalto-d51291d3.koyeb.app/",
  DEFAULT_MIME_TYPE: "application/octet-stream",
};

// Error messages
const ERROR_MESSAGES = {
  FILE_TOO_LARGE: "Media file exceeds 50MB limit. Please try a smaller file.",
  INVALID_URL: "Invalid or unsupported media URL.",
  DOWNLOAD_FAILED: "Failed to download media. Please try again later.",
  TIMEOUT: "Request timed out. Please try again.",
  NETWORK_ERROR: "Network error occurred. Please check your connection.",
  UNSUPPORTED_PLATFORM: "This platform is not supported.",
  PROCESSING_ERROR: "Error processing media. Please try again.",
};

// Utility function to create axios instance with default config
const createAxiosInstance = () => {
  return axios.create({
    timeout: CONSTANTS.PROCESSING_TIMEOUT,
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
    maxContentLength: CONSTANTS.MAX_FILE_SIZE,
    maxBodyLength: CONSTANTS.MAX_FILE_SIZE,
  });
};

const axiosInstance = createAxiosInstance();

// Utility function to validate URL
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Utility function to format error message for user
const formatUserError = (error) => {
  if (axios.isAxiosError(error)) {
    if (error.code === "ECONNABORTED") return ERROR_MESSAGES.TIMEOUT;
    if (error.response?.status === 413) return ERROR_MESSAGES.FILE_TOO_LARGE;
    if (!error.response) return ERROR_MESSAGES.NETWORK_ERROR;
  }
  return error.message || ERROR_MESSAGES.PROCESSING_ERROR;
};

// Utility function to check file size from headers
const checkFileSize = (headers) => {
  const contentLength = parseInt(headers["content-length"]);
  if (contentLength > CONSTANTS.MAX_FILE_SIZE) {
    throw new Error(ERROR_MESSAGES.FILE_TOO_LARGE);
  }
};

async function extractMediaWithCobalt(url, options = {}) {
  if (!isValidUrl(url)) {
    throw new Error(ERROR_MESSAGES.INVALID_URL);
  }

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
    const response = await axios.post(CONSTANTS.COBALT_URL, payload, {
      headers: {
        accept: "application/json",
        "Content-Type": "application/json",
      },
    });

    if (!response.data) {
      throw new Error(ERROR_MESSAGES.DOWNLOAD_FAILED);
    }

    return response.data;
  } catch (error) {
    logger.error("Cobalt extraction error:", error);
    throw new Error(formatUserError(error));
  }
}

function extractUrl(messageBody) {
  if (!messageBody) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match?.[0] && isValidUrl(match[0])) return match[0];
  }
  return null;
}

function getMediaType(url) {
  if (!isValidUrl(url)) return null;

  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform.toLowerCase();
  }
  return null;
}

async function downloadMedia(url) {
  if (!isValidUrl(url)) {
    throw new Error(ERROR_MESSAGES.INVALID_URL);
  }

  try {
    const response = await axiosInstance.get(url, {
      responseType: "arraybuffer",
      timeout: CONSTANTS.PROCESSING_TIMEOUT,
    });

    checkFileSize(response.headers);

    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString("base64");
    const mimeType =
      response.headers["content-type"] || CONSTANTS.DEFAULT_MIME_TYPE;

    return { base64, mimeType };
  } catch (error) {
    logger.error("Download error:", error);
    throw new Error(formatUserError(error));
  }
}

async function sendMedia(url, message) {
  if (!url || !message)
    return { success: false, error: ERROR_MESSAGES.INVALID_URL };

  try {
    const mediaData = await extractMediaWithCobalt(url);
    logger.debug(`Extracted media data: ${JSON.stringify(mediaData)}`);

    if (mediaData.status === "picker" && Array.isArray(mediaData.picker)) {
      for (const item of mediaData.picker) {
        if (item.type === "photo" && item.url) {
          const { base64, mimeType } = await downloadMedia(item.url);
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
        const media = new MessageMedia(mimeType, base64);
        await message.reply(media);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error("Error in processing media:", error);
    return { success: false, error: formatUserError(error) };
  }
}

export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  try {
    const url = extractUrl(message.body);
    if (!url) {
      return {
        processed: false,
        error: ERROR_MESSAGES.INVALID_URL,
      };
    }

    const mediaType = getMediaType(url);
    if (!mediaType) {
      return {
        processed: false,
        error: ERROR_MESSAGES.UNSUPPORTED_PLATFORM,
      };
    }

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const result = await sendMedia(url, message);

    if (!result.success) {
      await message.reply(result.error);
      return { processed: false, error: result.error };
    }

    return {
      processed: true,
      url,
      mediaType,
    };
  } catch (error) {
    logger.error("Error in handling media:", error);
    const errorMessage = formatUserError(error);
    await message.reply(errorMessage);
    return { processed: false, error: errorMessage };
  }
}
