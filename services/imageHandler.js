import axios from "axios";
import wwebjs from "whatsapp-web.js";
const { MessageMedia } = wwebjs;

class ImageHandler {
  constructor() {
    this.sentImages = new Map(); // Map to store sent image URLs by query
    this.cleanupInterval = 1000 * 60 * 60; // Clean up every hour
    this.maxRetries = 3; // Maximum number of retries for image fetching
    this.maxCacheSize = 1000; // Maximum number of queries to store in cache
    this.setupCleanup();
  }

  setupCleanup() {
    setInterval(() => {
      this.sentImages.clear();
      console.log("Cleared sent images cache at:", new Date().toISOString());
    }, this.cleanupInterval);

    // Additional cleanup check every 5 minutes for cache size
    setInterval(
      () => {
        if (this.sentImages.size > this.maxCacheSize) {
          // Convert to array, sort by timestamp, and keep only recent entries
          const entries = Array.from(this.sentImages.entries());
          entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
          this.sentImages = new Map(entries.slice(0, this.maxCacheSize / 2));
          console.log(
            "Performed size-based cache cleanup at:",
            new Date().toISOString(),
          );
        }
      },
      1000 * 60 * 5,
    );
  }

  extractImageCount(message) {
    // Remove the !image command first
    let cleanMessage = message.replace(/^!image\s+/, "").trim();

    // Extract the image count if present
    const match = cleanMessage.match(/\[(\d+)\]/);
    if (match) {
      const count = Math.min(Math.max(1, parseInt(match[1])), 10); // Limit between 1 and 10 images
      const query = cleanMessage.replace(/\[\d+\]/, "").trim();
      return { count, query };
    }
    return { count: 1, query: cleanMessage };
  }

  async isValidImageUrl(url, retryCount = 0) {
    try {
      const response = await axios.head(url, {
        timeout: 5000,
        validateStatus: (status) => status === 200,
      });

      return response.headers["content-type"]?.startsWith("image/");
    } catch (error) {
      if (retryCount < this.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.isValidImageUrl(url, retryCount + 1);
      }
      return false;
    }
  }

  async getUniqueImages(query, count, results) {
    const currentTime = Date.now();
    const sentImagesData = this.sentImages.get(query) || {
      urls: new Set(),
      timestamp: currentTime,
    };

    const uniqueImages = [];
    const seenUrls = new Set();

    for (const result of results) {
      if (uniqueImages.length >= count) break;

      // Skip if we've seen this URL before (either in this session or cache)
      if (seenUrls.has(result.url) || sentImagesData.urls.has(result.url)) {
        continue;
      }

      seenUrls.add(result.url);

      try {
        const isValid = await this.isValidImageUrl(result.url);
        if (isValid) {
          uniqueImages.push(result);
          sentImagesData.urls.add(result.url);
        }
      } catch (error) {
        console.error(
          `Error validating image URL ${result.url}:`,
          error.message,
        );
        continue;
      }
    }

    // Update the timestamp and save back to cache
    sentImagesData.timestamp = currentTime;
    this.sentImages.set(query, sentImagesData);

    return uniqueImages;
  }

  async fetchAndPrepareImages(images) {
    return Promise.all(
      images.map(async (image) => {
        let retryCount = 0;
        while (retryCount < this.maxRetries) {
          try {
            const response = await axios.get(image.url, {
              responseType: "arraybuffer",
              timeout: 10000,
              maxContentLength: 5 * 1024 * 1024, // 5MB max size
            });

            // Validate content type
            const contentType = response.headers["content-type"];
            if (!contentType?.startsWith("image/")) {
              throw new Error("Invalid content type: " + contentType);
            }

            return new MessageMedia(
              contentType,
              Buffer.from(response.data).toString("base64"),
              `image.${contentType.split("/")[1]}`,
            );
          } catch (error) {
            retryCount++;
            if (retryCount >= this.maxRetries) {
              console.error(
                `Failed to fetch image after ${this.maxRetries} attempts:`,
                error.message,
              );
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        }
      }),
    );
  }

  async validateAndOptimizeImage(imageBuffer, contentType) {
    // TODO: Implement image validation and optimization if needed
    // This is a placeholder for future image processing functionality
    return {
      buffer: imageBuffer,
      contentType: contentType,
    };
  }

  clearCache() {
    this.sentImages.clear();
    console.log("Manually cleared image cache at:", new Date().toISOString());
  }

  getCacheStats() {
    return {
      totalQueries: this.sentImages.size,
      totalUrls: Array.from(this.sentImages.values()).reduce(
        (total, data) => total + data.urls.size,
        0,
      ),
      oldestEntry: Math.min(
        ...Array.from(this.sentImages.values()).map((data) => data.timestamp),
      ),
      newestEntry: Math.max(
        ...Array.from(this.sentImages.values()).map((data) => data.timestamp),
      ),
    };
  }
}

export const imageHandler = new ImageHandler();
