import { logger } from '../../utils/logger.js';
import WhatsAppWeb from 'whatsapp-web.js';
import axios from 'axios';
import { extractInstagramMedia, extractTikTokMedia, extractFacebookMedia } from './extractors.js';

const { MessageMedia } = WhatsAppWeb;

// Media patterns for different platforms
const MEDIA_PATTERNS = {
  INSTAGRAM: /(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:[^\/\n]+\/)?(?:p|reel|tv)\/([^\/?#&\n]+)/i,
  TIKTOK: /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/(?:@[\w.-]+\/video\/|\w+\/)?(\w+)/i,
  FACEBOOK: /(?:https?:\/\/)?(?:www\.|web\.|m\.)?(?:facebook\.com|fb\.watch)\/(?:watch\/?\?v=|video\.php\?v=|video\.php\?id=|story\.php\?story_fbid=|reel\/|watch\/|[^\/]+\/videos\/(?:vb\.\d+\/)?)?(\d+)/i,
};

// Cache for recently processed URLs
const mediaCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 100;
const MAX_RETRIES = 3;
const PROCESSING_TIMEOUT = 60000; // 60 seconds

// Configure axios instance
const axiosInstance = axios.create({
  timeout: 30000,
  maxRedirects: 10,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'image/*, video/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
  },
  validateStatus: (status) => status >= 200 && status < 300,
  maxContentLength: 50 * 1024 * 1024, // 50MB max
  maxBodyLength: 50 * 1024 * 1024, // 50MB max
});

// Extract URLs from message
function extractUrl(messageBody) {
  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    const match = messageBody.match(pattern);
    if (match) return match[0];
  }
  return null;
}

// Determine media type from URL
function getMediaType(url) {
  for (const [platform, pattern] of Object.entries(MEDIA_PATTERNS)) {
    if (pattern.test(url)) return platform.toLowerCase();
  }
  return null;
}

// Manage cache size
function manageCache() {
  if (mediaCache.size > MAX_CACHE_SIZE) {
    const oldestKey = mediaCache.keys().next().value;
    mediaCache.delete(oldestKey);
  }

  // Clear expired entries
  const now = Date.now();
  for (const [key, { timestamp }] of mediaCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      mediaCache.delete(key);
    }
  }
}

// Download media with retries
async function downloadMedia(url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axiosInstance.get(url, {
        responseType: 'arraybuffer',
      });

      const buffer = Buffer.from(response.data);
      const base64 = buffer.toString('base64');
      const mimeType = response.headers['content-type'] || 'application/octet-stream';

      return { base64, mimeType };
    } catch (error) {
      lastError = error;
      logger.error({ err: error }, "Error fetching image");
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

// Extract media URL based on platform
async function extractMediaUrl(url, mediaType) {
  const extractors = {
    instagram: extractInstagramMedia,
    tiktok: extractTikTokMedia,
    facebook: extractFacebookMedia
  };

  const extractor = extractors[mediaType];
  if (!extractor) {
    throw new Error(`No extractor available for media type: ${mediaType}`);
  }

  return await extractor(url);
}

// Send media to chat
async function sendMedia(url, message) {
  try {
    // Check cache first
    if (mediaCache.has(url)) {
      const cached = mediaCache.get(url);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        await message.reply(cached.media);
        return true;
      }
      mediaCache.delete(url);
    }

    // Get the media type and extract the actual media URL
    const mediaType = getMediaType(url);
    const mediaUrl = await extractMediaUrl(url, mediaType);
    
    // Download the media
    const { base64, mimeType } = await downloadMedia(mediaUrl);
    const media = new MessageMedia(mimeType, base64);

    await message.reply(media);

    // Cache the result
    mediaCache.set(url, {
      media,
      timestamp: Date.now(),
    });
    manageCache();

    return true;
  } catch (error) {
    logger.error({ err: error }, "Error in img command");
    return false;
  }
}

// Main handler for media extraction
export async function handleMediaExtraction(message) {
  try {
    const url = extractUrl(message.body);
    if (!url) return { processed: false };

    const mediaType = getMediaType(url);
    if (!mediaType) return { processed: false };

    logger.info(`Processing ${mediaType} URL:`, url);
    const success = await sendMedia(url, message);

    return {
      processed: success,
      mediaType,
      url,
    };
  } catch (error) {
    logger.error({ err: error }, "Error in msg command");
    return { processed: false, error };
  }
}
