import { convertWavBufferToOpus } from "./convert.js";

export async function downloadWavBinary(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log("Audio downloaded!");

  const opusBuffer = await convertWavBufferToOpus(buffer);

  const base64 = opusBuffer.toString("base64");

  return {
    base64,
    mimeType: "audio/ogg; codecs=opus",
  };
}

export async function downloadBinary(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const base64 = buffer.toString("base64");

  console.log("Binary file downloaded and converted to base64!");

  return {
    base64,
    mimeType:
      response.headers.get("content-type") || "application/octet-stream",
  };
}
