import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Readable } from "stream";

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
