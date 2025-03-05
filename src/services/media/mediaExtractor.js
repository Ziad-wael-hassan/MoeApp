// mediaExtractor.js
import { logger } from "../../utils/logger.js";
import WhatsAppWeb from "whatsapp-web.js";
import axios from "axios";
import aesjs from "aes-js";
import { spawn } from "child_process";
import { MEDIA_PATTERNS } from "./mediaPatterns.js";

const { MessageMedia } = WhatsAppWeb;

// Configuration constants
const CONFIG = {
  PROCESSING_TIMEOUT: 60000, // 60 seconds
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,
  MAX_DOWNLOAD_SIZE: 50 * 1024 * 1024, // 50MB max
  DEFAULT_TIMEOUT: 30000, // 30 seconds
};

const TIKTOK_RATE_LIMIT = {
  lastRequestTime: 0,
  minInterval: 2000, // 1 second in milliseconds
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
  decompress: true,
});

// Instagram video extraction
function encryptData(data) {
  const key = "qwertyuioplkjhgf";
  const textBytes = aesjs.utils.utf8.toBytes(data);
  const keyBytes = aesjs.utils.utf8.toBytes(key);
  const aesEcb = new aesjs.ModeOfOperation.ecb(keyBytes);
  const paddedBytes = aesjs.padding.pkcs7.pad(textBytes);
  const encryptedBytes = aesEcb.encrypt(paddedBytes);
  return aesjs.utils.hex.fromBytes(encryptedBytes);
}

async function extractInstagramMedia(url) {
  try {
    const convertedUrl = encryptData(url);
    const response = await axiosInstance.get(
      "https://api.videodropper.app/allinone",
      {
        headers: {
          accept: "*/*",
          url: convertedUrl,
          Referer: "https://reelsave.app/",
        },
      },
    );

    if (response.status !== 200) {
      throw new Error("Failed to fetch Instagram video details");
    }

    const videoUrl = response.data?.video[0]?.video;
    if (!videoUrl) {
      throw new Error("No video URL found in response");
    }

    return videoUrl;
  } catch (error) {
    logger.error("Instagram extraction error:", error);
    throw error;
  }
}

async function extractTikTokMedia(url) {
  try {
    // Simple rate limiting implementation
    const now = Date.now();
    const timeSinceLastRequest = now - TIKTOK_RATE_LIMIT.lastRequestTime;
    
    if (timeSinceLastRequest < TIKTOK_RATE_LIMIT.minInterval) {
      // Wait for the remaining time if needed
      const waitTime = TIKTOK_RATE_LIMIT.minInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Update last request time before making the request
    TIKTOK_RATE_LIMIT.lastRequestTime = Date.now();
    
    logger.debug("Fetching TikTok media for URL:", url);

    const response = await axiosInstance.get("https://www.tikwm.com/api/", {
      params: { url },
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "application/json",
        "Accept-Encoding": "application/json",
      },
    });

    const { data } = response;

    if (!data || data.code !== 0) {
      throw new Error(`Failed to fetch TikTok media details. API Response: ${JSON.stringify(data)}`);
    }

    if (!data.data) {
      throw new Error("Invalid API response structure");
    }

    if (data.data.images && Array.isArray(data.data.images)) {
      return data.data.images;
    }

    if (data.data.play) {
      return data.data.play;
    }

    throw new Error("No media found in TikTok response");
  } catch (error) {
    logger.error("TikTok extraction error:", error);
    throw error;
  }
}

// Facebook video extraction
async function extractFacebookMedia(url) {
  try {
    const response = await axiosInstance.post(
      "https://submagic-free-tools.fly.dev/api/facebook-download",
      { url },
      {
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          Referer: "https://submagic-free-tools.fly.dev/facebook-downloader",
        },
      },
    );

    if (
      !response.data ||
      !response.data.videoFormats ||
      !Array.isArray(response.data.videoFormats)
    ) {
      throw new Error(
        "Invalid response format: videoFormats not found or invalid",
      );
    }

    const videoFormats = response.data.videoFormats;
    if (videoFormats.length === 0) {
      throw new Error("No video formats available");
    }

    // Sort by quality and get the highest quality version
    const sortedFormats = videoFormats.sort((a, b) => {
      const qualityA = parseInt(a.quality) || 0;
      const qualityB = parseInt(b.quality) || 0;
      return qualityB - qualityA;
    });

    const videoUrl = sortedFormats[0].url;
    if (!videoUrl) {
      throw new Error("No video URL found in highest quality format");
    }

    return videoUrl;
  } catch (error) {
    logger.error("Facebook extraction error:", error);
    throw error;
  }
}

// SoundCloud media extraction
async function extractSoundCloudMedia(url) {
  return new Promise((resolve, reject) => {
    const process = spawn("yt-dlp", [
      "-f",
      "bestaudio[ext=mp3]",
      "-o",
      "-",
      "--no-playlist",
      "--add-metadata",
      url,
    ]);

    const buffers = [];
    let errorOutput = "";

    process.stdout.on("data", (chunk) => buffers.push(chunk));
    process.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    process.on("close", (code) => {
      if (code === 0) {
        const buffer = Buffer.concat(buffers);
        resolve({ buffer, mimeType: "audio/mp3" });
      } else {
        reject(
          new Error(`yt-dlp process exited with code ${code}: ${errorOutput}`),
        );
      }
    });

    process.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp process: ${err.message}`));
    });
  });
}

// Generic retry wrapper for async functions
async function withRetry(fn, options = {}) {
  const {
    maxRetries = CONFIG.MAX_RETRIES,
    retryDelay = CONFIG.RETRY_DELAY,
    onRetry = null,
  } = options;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt <= maxRetries) {
        const delay = retryDelay * Math.pow(2, attempt - 1);
        logger.info(
          `Retry attempt ${attempt}/${maxRetries} after ${delay}ms delay. Error: ${error.message}`,
        );

        if (onRetry) {
          onRetry(error, attempt);
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

// Extract URLs from message
// mediaExtractor.js
// [Previous imports remain the same...]

// Extract URLs from message
function extractUrls(messageBody) {
  if (!messageBody || typeof messageBody !== "string") return [];

  const foundUrls = [];
  const excludePatterns = [/https?:\/\/(?:www\.)?tiktok\.com\/tiktoklite/i];

  // Split message by whitespace to handle multiple URLs
  const words = messageBody.split(/\s+/);

  for (const word of words) {
    // Skip if word matches any exclude pattern
    if (excludePatterns.some((pattern) => pattern.test(word))) {
      continue;
    }

    for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
      const match = word.match(pattern);
      if (match && match[0]) {
        foundUrls.push({
          url: match[0],
          platform,
        });
        break; // Stop checking other patterns once we find a match for this URL
      }
    }
  }

  return foundUrls;
}

// Download media from URL
async function downloadMedia(url) {
  if (!url) throw new Error("Invalid media URL");

  return withRetry(async () => {
    const response = await axiosInstance.get(url, {
      responseType: "arraybuffer",
      timeout: CONFIG.PROCESSING_TIMEOUT,
    });

    const buffer = Buffer.from(response.data);
    const base64 = buffer.toString("base64");
    const mimeType =
      response.headers["content-type"] || "application/octet-stream";

    return { base64, mimeType };
  });
}

// Process and send media
async function processAndSendMedia(urls, message) {
  const results = [];

  for (const { url, platform } of urls) {
    try {
      const extractors = {
        instagram: extractInstagramMedia,
        tiktok: extractTikTokMedia,
        facebook: extractFacebookMedia,
        soundcloud: extractSoundCloudMedia,
      };

      const extractor = extractors[platform];
      if (!extractor) {
        throw new Error(`No extractor available for platform: ${platform}`);
      }

      const mediaResult = await extractor(url);

      if (platform === "soundcloud" && mediaResult.buffer) {
        const media = new MessageMedia(
          mediaResult.mimeType,
          mediaResult.buffer.toString("base64"),
        );
        await message.reply(media);
        results.push({ url, platform, success: true });
        continue;
      }

      const mediaUrls = Array.isArray(mediaResult)
        ? mediaResult
        : [mediaResult];

      for (const mediaUrl of mediaUrls) {
        const { base64, mimeType } = await downloadMedia(mediaUrl);
        const media = new MessageMedia(mimeType, base64);
        await message.reply(media);
      }

      results.push({ url, platform, success: true });
    } catch (error) {
      logger.error(
        `Failed to process ${platform} URL ${url}: ${error.message}`,
      );
      results.push({ url, platform, success: false, error: error.message });
    }
  }

  return results;
}

// Main handler for media extraction
export async function handleMediaExtraction(message) {
  if (!message?.body) return { processed: false };

  try {
    const extractedUrls = extractUrls(message.body);
    if (extractedUrls.length === 0) return { processed: false };

    // Show typing indicator
    try {
      const chat = await message.getChat();
      await chat.sendStateTyping();
    } catch (typingError) {
      logger.warn(`Failed to send typing indicator: ${typingError.message}`);
    }

    // Process and send media with timeout protection
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Media processing timeout")),
        CONFIG.PROCESSING_TIMEOUT * 1.5,
      ),
    );

    const processingPromise = processAndSendMedia(extractedUrls, message);

    const results = await Promise.race([
      processingPromise,
      timeoutPromise,
    ]).catch((error) => {
      logger.error(`Media processing error: ${error.message}`);
      return extractedUrls.map(({ url, platform }) => ({
        url,
        platform,
        success: false,
        error: error.message,
      }));
    });

    const anySuccess = results.some((result) => result.success);
    const allResults = results.map(({ url, platform, success, error }) => ({
      url,
      platform,
      success,
      ...(error && { error }),
    }));

    return {
      processed: anySuccess,
      results: allResults,
    };
  } catch (error) {
    logger.error(`Error in handling media extraction: ${error.message}`, {
      error,
    });
    try {
      await message.reply(
        "Sorry, I couldn't process the media link(s). Please try again later.",
      );
    } catch (replyError) {
      // Ignore errors when trying to send failure message
    }
    return { processed: false, error: error.message };
  }
}
