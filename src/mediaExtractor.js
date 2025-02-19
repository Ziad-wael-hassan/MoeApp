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
import Queue from "queue-promise";

const { MessageMedia } = WhatsAppWeb;
const CONFIG = {
  TIMEOUT: 60000,
  MAX_FILE_SIZE: 30 * 1024 * 1024,
  MAX_RETRIES: 3,
  MAX_MEDIA_ITEMS: 5
};

const queues = {
  extraction: new Queue({ concurrent: 3, interval: 500 }),
  download: new Queue({ concurrent: 5, interval: 500 }),
  sending: new Queue({ concurrent: 2, interval: 1000 })
};

const utils = {
  truncateUrl: (url) => url ? `${url.substring(0, 50)}...` : 'undefined',
  createTxId: () => Date.now().toString(36),
  getMediaType: (url) => {
    if (!url) return null;
    for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
      if (pattern.test(url)) return platform.toLowerCase();
    }
    return url.includes("akamaized.net") && url.includes("video/tos") ? "tiktok" : null;
  },
  getHeaders: (url) => {
    const baseHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
      Connection: "keep-alive"
    };

    if (url.includes("tiktok") || url.includes("akamaized.net")) {
      return { ...baseHeaders, Referer: "https://www.tiktok.com/", Origin: "https://www.tiktok.com" };
    }
    if (url.includes("instagram")) {
      return { ...baseHeaders, Referer: "https://www.instagram.com/", Origin: "https://www.instagram.com" };
    }
    return baseHeaders;
  }
};

const axiosInstance = axios.create({
  timeout: CONFIG.TIMEOUT,
  maxRedirects: 10,
  validateStatus: (status) => status >= 200 && status < 300,
  maxContentLength: CONFIG.MAX_FILE_SIZE,
  maxBodyLength: CONFIG.MAX_FILE_SIZE
});

async function extractMediaUrl(url, mediaType) {
  const extractors = {
    instagram: extractInstagramMedia,
    tiktok: extractTikTokMedia,
    facebook: extractFacebookMedia,
    soundcloud: extractSoundCloudMedia,
  };

  const extractor = extractors[mediaType];
  if (!extractor) {
    throw new Error(`No extractor available for media type: ${mediaType}`);
  }

  try {
    const mediaData = await Promise.race([
      extractor(url),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Extraction timed out')), CONFIG.TIMEOUT)
      )
    ]);

    if (mediaData.buffer) {
      return mediaData; // For SoundCloud: { buffer, mimeType }
    }
    return { url: mediaData }; // For others: URL string
  } catch (error) {
    logger.error(`Media extraction failed for ${mediaType}`, { 
      url: utils.truncateUrl(url),
      error: error.message 
    });
    throw error;
  }
}

async function downloadMedia(url, txId) {
  if (!url) throw new Error("Invalid media URL");

  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    try {
      logger.debug(`[TX:${txId}] Download attempt ${attempt}`, { url: utils.truncateUrl(url) });

      const response = await axiosInstance.get(url, {
        responseType: "arraybuffer",
        headers: utils.getHeaders(url),
        onDownloadProgress: (e) => {
          if (e.total > CONFIG.MAX_FILE_SIZE) {
            throw Object.assign(new Error("File too large"), { code: 'FILE_TOO_LARGE' });
          }
        }
      });

      if (!response.data?.length) throw new Error("Empty response");

      const buffer = Buffer.from(response.data);
      if (buffer.length > CONFIG.MAX_FILE_SIZE) {
        throw Object.assign(new Error("File too large"), { code: 'FILE_TOO_LARGE' });
      }

      return {
        base64: buffer.toString("base64"),
        mimeType: response.headers["content-type"] || "application/octet-stream"
      };
    } catch (error) {
      logger.error(`[TX:${txId}] Download failed`, {
        attempt,
        error: error.message,
        status: error.response?.status
      });

      if (error.code === 'FILE_TOO_LARGE' || attempt === CONFIG.MAX_RETRIES) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function sendMedia(url, message) {
  const txId = utils.createTxId();
  if (!url || !message) return { success: false, reason: "Invalid parameters" };

  try {
    const mediaType = utils.getMediaType(url);
    if (!mediaType) return { success: false, reason: "Unsupported media type" };

    logger.info(`[TX:${txId}] Processing ${mediaType}`, { url: utils.truncateUrl(url) });

    const mediaData = url.includes("akamaized.net") || url.includes("tiktokcdn.com")
      ? { url }
      : await queues.extraction.enqueue(() => extractMediaUrl(url, mediaType));

    const mediaUrls = Array.isArray(mediaData.url) ? mediaData.url : [mediaData.url];
    if (mediaUrls.length > CONFIG.MAX_MEDIA_ITEMS) {
      throw new Error(`Too many media items (${mediaUrls.length})`);
    }

    const results = await Promise.allSettled(
      mediaUrls.map(url => 
        queues.download
          .enqueue(() => downloadMedia(url, txId))
          .then(content => 
            queues.sending.enqueue(() => 
              message.reply(new MessageMedia(content.mimeType, content.base64))
            )
          )
      )
    );

    const successCount = results.filter(r => r.status === 'fulfilled').length;
    return {
      success: successCount > 0,
      txId,
      partialSuccess: successCount < mediaUrls.length,
      successCount,
      totalCount: mediaUrls.length
    };

  } catch (error) {
    logger.error(`[TX:${txId}] Processing failed`, { error: error.message });
    return {
      success: false,
      txId,
      reason: error.code === 'FILE_TOO_LARGE' ? "File too large" : "Processing error",
      details: error.message,
      shouldNotify: true
    };
  }
}

export async function handleMediaExtraction(message) {
  const txId = utils.createTxId();
  if (!message?.body) return { processed: false };

  try {
    const url = message.body.match(Object.values(MEDIA_PATTERNS).find(p => p.test(message.body)))?.[0];
    if (!url) return { processed: false };

    const chat = await message.getChat();
    await chat.sendStateTyping();

    const result = await sendMedia(url, message);
    if (!result.success && result.shouldNotify) {
      await message.reply(`Failed to process media: ${result.reason}`).catch(() => {});
    }

    return { processed: result.success, txId, ...result };
  } catch (error) {
    logger.error(`[TX:${txId}] Extraction failed`, { error: error.message });
    return { processed: false, error: error.message };
  }
}
