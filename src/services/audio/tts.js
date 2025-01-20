import { Client } from "@gradio/client";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import removeMarkdown from "remove-markdown";

import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Readable } from "node:stream";

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

export function convertWavBufferToOpus(wavBuffer) {
  return new Promise((resolve, reject) => {
    const outputBuffers = [];

    ffmpeg()
      .input(bufferToStream(wavBuffer))
      .inputFormat("wav")
      .audioCodec("libopus")
      .audioBitrate(160)
      .format("opus")
      .on("error", (err) => reject(err))
      .on("end", () => resolve(Buffer.concat(outputBuffers)))
      .pipe()
      .on("data", (chunk) => {
        outputBuffers.push(chunk);
      });
  });
}

function convertMp3BufferToWav(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const outputBuffers = [];

    ffmpeg()
      .input(bufferToStream(mp3Buffer))
      .inputFormat("mp3")
      .audioCodec("pcm_s16le")
      .format("wav")
      .on("error", (err) => reject(err))
      .on("end", () => resolve(Buffer.concat(outputBuffers)))
      .pipe()
      .on("data", (chunk) => {
        outputBuffers.push(chunk);
      });
  });
}

const MAX_TEXT_LENGTH = 300;

export async function downloadBinary(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const base64 = buffer.toString("base64");

  logger.debug("Binary file downloaded and converted to base64!");

  return {
    base64,
    mimeType:
      response.headers.get("content-type") || "application/octet-stream",
  };
}

export async function textToSpeech(text) {
  try {
    // Remove markdown and clean the text
    const cleanText = removeMarkdown(text).trim();

    if (!cleanText) {
      throw new Error("No text to convert after cleaning");
    }

    const client = await Client.connect("Sekai966/Edge-TTS-Text-to-Speech", {
      hf_token: env.HF_TOKEN,
    });

    const result = await client.predict("/tts_interface", {
      text: cleanText,
      voice: "en-US-AvaMultilingualNeural - en-US (Female)",
    });

    logger.debug("TTS generation successful");

    const [audio] = result.data;

    const { base64, mimeType } = await downloadBinary(audio.url);

    return {
      mimeType,
      base64,
    };
  } catch (error) {
    logger.error({ err: error }, "TTS error:");
    throw new Error("Failed to generate speech");
  }
}

export function shouldGenerateVoice(text) {
  const cleanText = removeMarkdown(text).trim();
  return cleanText.length >= MAX_TEXT_LENGTH;
}
