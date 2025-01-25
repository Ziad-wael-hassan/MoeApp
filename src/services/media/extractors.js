import axios from "axios";
import aesjs from "aes-js";
import { exec } from "child_process";
import { logger } from "../../utils/logger.js";

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

export async function extractInstagramMedia(url) {
  try {
    const convertedUrl = encryptData(url);
    const response = await axios.get("https://api.videodropper.app/allinone", {
      headers: {
        accept: "*/*",
        url: convertedUrl,
        Referer: "https://reelsave.app/",
      },
    });

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

// TikTok media extraction
export async function extractTikTokMedia(url) {
  try {
    logger.debug("Fetching TikTok media for URL:", url);

    const response = await axios.get("https://www.tikwm.com/api/", {
      params: { url },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        Accept: "application/json",
        "Accept-Encoding": "application/json",
      },
    });

    const { data } = response;

    if (!data || data.code !== 0) {
      throw new Error(
        `Failed to fetch TikTok media details. API Response: ${JSON.stringify(data)}`,
      );
    }

    if (!data.data) {
      throw new Error("Invalid API response structure");
    }

    if (data.data.images && Array.isArray(data.data.images)) {
      return data.data.images; // Return first image URL for now
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
export async function extractFacebookMedia(url) {
  try {
    const response = await axios.post(
      "https://submagic-free-tools.fly.dev/api/facebook-download",
      { url },
      {
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          Referer: "https://submagic-free-tools.fly.dev/facebook-downloader",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        timeout: 30000,
        maxRedirects: 5,
      },
    );

    if (!response.data) {
      throw new Error("Empty response received from server");
    }

    if (
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
      const qualityA = Number.parseInt(a.quality) || 0;
      const qualityB = Number.parseInt(b.quality) || 0;
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

export async function extractSoundCloudMedia(url) {
  try {
    logger.debug("Fetching SoundCloud media for URL:", url);

    return new Promise((resolve, reject) => {
      exec(`yt-dlp -f bestaudio --get-url "${url}"`, (error, stdout, stderr) => {
        if (error) {
          logger.error('SoundCloud extraction error:', error);
          return reject(new Error(`Failed to extract SoundCloud media: ${error.message}`));
        }

        if (stderr) {
          logger.warn('SoundCloud extraction warnings:', stderr);
        }

        const audioUrl = stdout.trim();
        
        if (!audioUrl) {
          return reject(new Error('No audio URL found for SoundCloud track'));
        }

        resolve(audioUrl);
      });
    });
  } catch (error) {
    logger.error('SoundCloud extraction error:', error);
    throw error;
  }
}

