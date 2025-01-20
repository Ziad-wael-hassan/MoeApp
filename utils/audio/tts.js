import { Client } from "@gradio/client";
import { downloadBinary, downloadWavBinary } from "./download-binary.js";
import dotenv from "dotenv";
dotenv.config();

export async function textToSpeech(text, speed = 1) {
  return useEdgeTTS({ text, speed });
}

export async function useEdgeTTS({ text, speed = 1 }) {
  const client = await Client.connect("Sekai966/Edge-TTS-Text-to-Speech", {
    hf_token: process.env.HF_TOKEN,
  });

  const result = await client.predict("/tts_interface", {
    text,
    voice: "en-US-AvaMultilingualNeural - en-US (Female)",
  });

  console.log("Audio generated!");

  const [audio] = result.data;

  const { base64, mimeType } = await downloadBinary(audio.url);

  return {
    mimeType,
    base64,
  };
}

export async function useKokoroTTSFastAPI({ text, speed = 1 }) {
  const client = await Client.connect("https://ui.kokorotts.com/");

  const result = await client.predict("/generate_from_text", {
    text,
    voice: "af_sky",
    speed,
    format: "wav",
  });

  console.log("Audio generated!");

  const [audio] = result.data;

  const { base64, mimeType } = await downloadWavBinary(audio.url);

  return {
    mimeType,
    base64,
  };
}

export async function useKokoroTTSZero({ text, speed = 1 }) {
  const client = await Client.connect("Remsky/Kokoro-TTS-Zero");

  const result = await client.predict("/generate_speech_from_ui", {
    text,
    voice_names: ["af_sky"],
    speed,
  });

  cosnole.log("Audio generated!");

  const [audio] = result.data;

  const { base64, mimeType } = await downloadWavBinary(audio.url);

  return {
    mimeType,
    base64,
  };
}
