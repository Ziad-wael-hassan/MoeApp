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
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
