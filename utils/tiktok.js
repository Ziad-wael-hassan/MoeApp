import axios from "axios";

export async function fetchTikTokMedia(url) {
  try {
    console.log("Fetching TikTok media for URL:", url);

    const response = await axios.get("https://www.tikwm.com/api/", {
      params: {
        url: url,
      },
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
      return {
        type: "images",
        urls: data.data.images,
      };
    }

    if (data.data.play) {
      return {
        type: "video",
        url: data.data.play,
      };
    }

    throw new Error("No media found in TikTok response.");
  } catch (error) {
    console.error("TikTok API Error:", error);

    if (error.response) {
      console.error("Error Response:", error.response.data);
      throw new Error(
        `TikTok API error: ${error.response.status} - ${error.response.statusText}. Details: ${JSON.stringify(error.response.data)}`,
      );
    } else if (error.request) {
      throw new Error("TikTok API error: No response received from server");
    } else {
      throw new Error(`TikTok API error: ${error.message}`);
    }
  }
}
