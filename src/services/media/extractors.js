import axios from "axios";
import { spawn } from "child_process";
import { logger } from "../../utils/logger.js";

// Cobalt media extraction
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
    });

    if (response.status !== 200 || !response.data.url) {
      throw new Error("Failed to fetch media details from Cobalt");
    }

    return response.data.url;
  } catch (error) {
    logger.error("Cobalt extraction error:", error);
    throw error;
  }
}

// Instagram video extraction
export async function extractInstagramMedia(url) {
  return extractMediaWithCobalt(url, { videoQuality: "720" });
}

// TikTok media extraction
export async function extractTikTokMedia(url) {
  return extractMediaWithCobalt(url, { tiktokH265: true });
}

// Facebook video extraction
export async function extractFacebookMedia(url) {
  return extractMediaWithCobalt(url);
}

// SoundCloud media extraction
export async function extractSoundCloudMedia(url) {
  return extractMediaWithCobalt(url);
}
