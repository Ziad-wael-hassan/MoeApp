import { Client } from "@gradio/client";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import removeMarkdown from "remove-markdown";

const CONFIG = {
  MAX_TEXT_LENGTH: 300,
  MIN_TEXT_LENGTH: 1,
  DEFAULT_MIME_TYPE: "application/octet-stream",
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
  SUPPORTED_VOICES: ["en-US-AvaMultilingualNeural - en-US (Female)"],
  DEFAULT_VOICE: "en-US-AvaMultilingualNeural - en-US (Female)",
};

class TTSError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TTSError";
    this.code = code;
  }
}

class ValidationError extends TTSError {
  constructor(message) {
    super(message, "VALIDATION_ERROR");
  }
}

export async function downloadBinary(url, options = {}) {
  if (!url || typeof url !== "string") {
    throw new ValidationError("Invalid URL provided");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeout || 30000,
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: options.headers || {},
    });

    if (!response.ok) {
      throw new TTSError(
        `Failed to download file: ${response.status} ${response.statusText}`,
        "DOWNLOAD_ERROR",
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString("base64");
    const mimeType =
      response.headers.get("content-type") || CONFIG.DEFAULT_MIME_TYPE;

    logger.debug(
      {
        url,
        mimeType,
        size: buffer.length,
      },
      "Binary file downloaded successfully",
    );

    return { base64, mimeType };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new TTSError("Download timeout exceeded", "TIMEOUT_ERROR");
    }
    throw new TTSError(`Download failed: ${error.message}`, "DOWNLOAD_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}

function validateAndCleanText(text) {
  if (typeof text !== "string") {
    throw new ValidationError("Input must be a string");
  }

  const cleanText = removeMarkdown(text).trim();

  if (cleanText.length < CONFIG.MIN_TEXT_LENGTH) {
    throw new ValidationError("Text is empty after cleaning");
  }

  return cleanText;
}

export async function textToSpeech(text, options = {}) {
  const {
    voice = CONFIG.DEFAULT_VOICE,
    retryAttempts = CONFIG.RETRY_ATTEMPTS,
    retryDelay = CONFIG.RETRY_DELAY,
  } = options;

  if (!env.HF_TOKEN) {
    throw new TTSError("HuggingFace token not configured", "CONFIG_ERROR");
  }

  if (!CONFIG.SUPPORTED_VOICES.includes(voice)) {
    throw new ValidationError("Unsupported voice selected");
  }

  const cleanText = validateAndCleanText(text);

  let lastError;
  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const client = await Client.connect("Sekai966/Edge-TTS-Text-to-Speech", {
        hf_token: env.HF_TOKEN,
      });

      const result = await client.predict("/tts_interface", {
        text: cleanText,
        voice,
      });

      if (!result?.data?.[0]?.url) {
        throw new TTSError(
          "Invalid response from TTS service",
          "SERVICE_ERROR",
        );
      }

      logger.debug(
        {
          textLength: cleanText.length,
          attempt,
          voice,
        },
        "TTS generation successful",
      );

      const [audio] = result.data;
      return await downloadBinary(audio.url);
    } catch (error) {
      lastError = error;
      logger.warn(
        {
          err: error,
          attempt,
          remainingAttempts: retryAttempts - attempt,
        },
        "TTS attempt failed",
      );

      if (attempt < retryAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  logger.error({ err: lastError }, "All TTS attempts failed");
  throw new TTSError(
    `Failed to generate speech after ${retryAttempts} attempts: ${lastError.message}`,
    "MAX_RETRIES_EXCEEDED",
  );
}

export function shouldGenerateVoice(text) {
  try {
    const cleanText = validateAndCleanText(text);
    return cleanText.length >= CONFIG.MAX_TEXT_LENGTH;
  } catch (error) {
    logger.warn({ err: error }, "Voice generation check failed");
    return false;
  }
}

export const TTSConfig = CONFIG;
export { TTSError, ValidationError };
