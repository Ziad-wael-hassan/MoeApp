import axios from "axios";

export async function fetchFacebookVideo(url) {
  const client = axios.create({
    timeout: 30000,
    maxRedirects: 5,
  });

  try {
    const response = await client.post(
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

    const sortedFormats = videoFormats.sort((a, b) => {
      const qualityA = parseInt(a.quality) || 0;
      const qualityB = parseInt(b.quality) || 0;
      return qualityB - qualityA;
    });

    const video = sortedFormats[0].url;

    if (!video) {
      throw new Error("No video URL found in the highest quality format");
    }

    return video;
  } catch (error) {
    console.error("Facebook Video Download Error:", error);

    if (error.response) {
      console.error("Error Response Data:", error.response.data);
      console.error("Error Response Status:", error.response.status);
      console.error("Error Response Headers:", error.response.headers);

      throw new Error(
        `Facebook API error: ${error.response.status} - ${error.response.statusText}. Details: ${JSON.stringify(error.response.data)}`,
      );
    } else if (error.request) {
      console.error(
        "No response received from server. Request details:",
        error.request,
      );
      throw new Error(
        "Facebook API error: No response received. The server might be down or the URL might be invalid.",
      );
    } else {
      console.error("Error details:", error.message);
      throw new Error(`Facebook API error: ${error.message}`);
    }
  }
}
