import { textToSpeech } from "../../audio/tts.js";
import {
  ShutupUsers,
  Commands,
  Settings,
  StoryTracking,
} from "../../../config/database.js";
import { logger } from "../../../utils/logger.js";
import gis from "async-g-i-s";
import https from "https";
import axios from "axios";
import WhatsAppWeb from "whatsapp-web.js";
import { scheduleReminder } from "../../../utils/scheduler.js";

const { MessageMedia } = WhatsAppWeb;

const SONG_SELECTION_TIMEOUT = 60000; // 60 seconds timeout for selection
const sentImageCache = new Map();
const IMAGE_CACHE_CONFIG = {
  MAX_SIZE: 1000,
  MAX_RETRIES: 3,
  EXPIRY: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
};

function formatSearchResults(results) {
  let message = "*🎵 Found these songs:*\n\n";
  results.forEach((track, index) => {
    message += `*${index + 1}.* ${track.title}\n👤 ${track.artist}\n💿 ${track.album}\n\n`;
  });
  message +=
    "\n_Reply with the number of the song you want to download (1-" +
    results.length +
    ")_";
  return message;
}

async function isAdmin(message) {
  const adminNumbers = process.env.ADMIN?.split(",") || [];

  const contact = await message.getContact();
  const contactNumber = contact?.number || "";

  return adminNumbers.includes(contactNumber);
}

async function getSongDetails(url) {
  try {
    const response = await axios.get(
      "https://elghamazy-moeify.hf.space/getSong",
      {
        params: { url },
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 30000, // 30-second timeout
      },
    );

    const { title, artist, album, cover, urls } = response.data;

    if (!title || !artist || !album || !urls) {
      throw new Error("Invalid response format from API");
    }

    return {
      title,
      artist,
      album,
      cover,
      urls,
    };
  } catch (error) {
    logger.error({ err: error }, "Error fetching song details", {
      url,
      errorResponse: error.response?.data,
      errorStatus: error.response?.status,
    });
    throw new Error("Failed to fetch song details. Please try again later.");
  }
}

async function processSongDownload(message, trackData) {
  const chat = await message.getChat();

  try {
    await chat.sendStateRecording();

    // Request track details from the API
    const response = await axios.get(
      "https://elghamazy-moeify.hf.space/getSong",
      {
        params: { url: trackData.urls.spotifyUrl },
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 30000, // 30-second timeout
      },
    );

    // Destructure the expected properties from the API response
    const { title, artist, album, cover, urls } = response.data;
    if (!title || !artist || !album || !urls) {
      throw new Error("Invalid response format");
    }

    // Create a caption with the track details
    const caption = `🎵 *${title}*\n👤 ${artist}\n💿 ${album}`;
