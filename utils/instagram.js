import aesjs from "aes-js";
import axios from "axios";

function encryptData(data) {
  const key = "qwertyuioplkjhgf";
  const textBytes = aesjs.utils.utf8.toBytes(data);
  const keyBytes = aesjs.utils.utf8.toBytes(key);
  const aesEcb = new aesjs.ModeOfOperation.ecb(keyBytes);
  const paddedBytes = aesjs.padding.pkcs7.pad(textBytes);
  const encryptedBytes = aesEcb.encrypt(paddedBytes);
  return aesjs.utils.hex.fromBytes(encryptedBytes);
}

export async function fetchInstagramVideo(url) {
  const convertedUrl = encryptData(url);

  const response = await axios.get("https://api.videodropper.app/allinone", {
    headers: {
      accept: "*/*",
      url: convertedUrl,
      Referer: "https://reelsave.app/",
    },
  });

  if (response.status !== 200)
    throw new Error("Failed to fetch Instagram video details");
  const data = response.data;
  return data?.video[0]?.video || null; // Return direct video URL
}
