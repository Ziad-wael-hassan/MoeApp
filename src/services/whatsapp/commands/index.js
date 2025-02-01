import { textToSpeech } from "../../audio/tts.js";
import { ShutupUsers, Commands, Settings } from "../../../config/database.js";
import { logger } from "../../../utils/logger.js";
import gis from "async-g-i-s";
import https from "https";
import axios from "axios";
import WhatsAppWeb from "whatsapp-web.js";
import { scheduleReminder } from "../../../utils/scheduler.js";

const { MessageMedia } = WhatsAppWeb;

async function isAdmin(message) {
  const adminNumbers = process.env.ADMIN?.split(",") || [];

  const contact = await message.getContact();
  const contactNumber = contact?.number || "";

  return adminNumbers.includes(contactNumber);
}

async function fetchFile(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      maxRedirects: 5,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const contentType =
      response.headers["content-type"] || "application/octet-stream";
    const buffer = Buffer.from(response.data);
    const contentDisposition = response.headers["content-disposition"];
    let fileName = url.split("/").pop();

    if (contentDisposition && contentDisposition.includes("filename=")) {
      const matches = contentDisposition.match(/filename="(.+)"/);
      if (matches && matches[1]) {
        fileName = matches[1];
      }
    }

    if (contentType.startsWith("text/html")) {
      throw new Error("HTML content is not allowed");
    }

    return {
      base64: buffer.toString("base64"),
      mimeType: contentType,
      fileName,
    };
  } catch (error) {
    throw new Error(`Failed to fetch file: ${error.message}`);
  }
}

export const commandHandlers = {
  async help(message) {
    const commands = await Commands.find({ enabled: true });
    const isUserAdmin = await isAdmin(message);

    // Group commands by category
    const categorizedCommands = commands.reduce((acc, cmd) => {
      if (!cmd.adminOnly || isUserAdmin) {
        if (!acc[cmd.category]) {
          acc[cmd.category] = [];
        }
        acc[cmd.category].push(cmd);
      }
      return acc;
    }, {});

    let response = `📱 *MoeApp Commands*\n\n`;

    for (const [category, cmds] of Object.entries(categorizedCommands)) {
      response += `🔹 *${category.toUpperCase()}*\n`;
      response += `━━━━━━━━━━━━━━━━━━\n`;
      for (const cmd of cmds) {
        response += `\n✨ *Command:* \`!${cmd.name}\`\n`;
        response += `📄 *Description:* ${cmd.description}\n`;
        response += `⚙️ *Usage:* \`${cmd.usage}\`\n`;
        response += `━━━━━━━━━━━━━━━━━━\n`;
      }
      response += `\n`;
    }

    await message.reply(response);
  },
  async toggleai(message) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    const aiSetting = await Settings.findOne({ key: "ai_enabled" });
    const newValue = !aiSetting?.value;

    if (aiSetting) {
      await Settings.updateOne(
        { key: "ai_enabled" },
        {
          $set: {
            value: newValue,
            updatedAt: new Date(),
          },
        },
      );
    } else {
      await Settings.insertOne({
        key: "ai_enabled",
        value: newValue,
        updatedAt: new Date(),
      });
    }

    await message.reply(
      `AI responses are now ${newValue ? "enabled" : "disabled"}`,
    );
  },

  async togglecmd(message, args) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    const cmdName = args[0];
    if (!cmdName) {
      await message.reply("Please specify a command to toggle.");
      return;
    }

    const command = await Commands.findOne({ name: cmdName });
    if (!command) {
      await message.reply("Command not found.");
      return;
    }

    await Commands.updateOne(
      { name: cmdName },
      { $set: { enabled: !command.enabled } },
    );

    await message.reply(
      `Command !${cmdName} is now ${!command.enabled ? "enabled" : "disabled"}`,
    );
  },

  async pfp(message) {
    try {
      let targetContact;

      // Extract numbers from the message body
      const number = message.body.replace(/[^0-9]/g, "");

      if (!number) {
        targetContact = await message.getContact();
      } else if (number.length > 0) {
        targetContact = await message.client.getContactById(`${number}@c.us`);
      } else {
        await message.reply("Please mention a user or provide their number.");
        return;
      }

      const profilePic = await targetContact.getProfilePicUrl();
      if (!profilePic) {
        await message.reply("No profile picture found.");
        return;
      }

      const media = await MessageMedia.fromUrl(profilePic);
      await message.reply(media);
    } catch (error) {
      logger.error({ err: error }, "Error in pfp command:");
      await message.reply("Failed to fetch profile picture.");
    }
  },

  async logs(message) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    const stats = {
      commands: await Commands.find(),
      aiEnabled: (await Settings.findOne({ key: "ai_enabled" }))?.value,
    };

    let report = "📊 *Bot Statistics*\n\n";
    report += `AI Enabled: ${stats.aiEnabled ? "✅" : "❌"}\n\n`;
    report += "*Command Usage:*\n";

    for (const cmd of stats.commands) {
      report += `!${cmd.name}: ${cmd.usageCount} uses`;
      if (cmd.lastUsed) {
        report += ` (Last: ${cmd.lastUsed.toLocaleDateString()})`;
      }
      report += "\n";
    }

    await message.reply(report);
  },

  async speak(message) {
    if (!message.hasQuotedMsg) {
      await message.reply("Please quote a message to convert to speech.");
      return;
    }
    const chat = await message.getChat();

    try {
      const quotedMessage = await message.getQuotedMessage();
      const { base64, mimeType } = await textToSpeech(quotedMessage.body);
      const media = new MessageMedia(mimeType, base64);

      await quotedMessage.reply(media, chat.id._serialized, {
        sendAudioAsVoice: true,
      });
    } catch (error) {
      logger.error({ err: error }, "Error in speak command:");
      await message.reply("Failed to convert text to speech.");
    }
  },

  async img(message, args) {
    // Cache management
    const sentImages = new Map();
    const MAX_CACHE_SIZE = 1000;
    const MAX_RETRIES = 3;

    // Helper function to extract image count
    const extractImageCount = (message) => {
      const cleanMessage = message.replace(/^!image\s+/, "").trim();
      const match = cleanMessage.match(/\[(\d+)\]/);

      if (match) {
        const count = Math.min(Math.max(1, parseInt(match[1])), 10);
        const query = cleanMessage.replace(/\[\d+\]/, "").trim();
        return { count, query };
      }

      return { count: 1, query: cleanMessage };
    };

    // Helper function to validate image URL
    const isValidImageUrl = async (url, retryCount = 0) => {
      try {
        const response = await axios.head(url, {
          timeout: 5000,
          validateStatus: (status) => status === 200,
        });

        return response.headers["content-type"]?.startsWith("image/");
      } catch (error) {
        if (retryCount < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return isValidImageUrl(url, retryCount + 1);
        }
        return false;
      }
    };

    // Helper function to get unique images
    const getUniqueImages = async (query, count, results) => {
      const currentTime = Date.now();
      const sentImagesData = sentImages.get(query) || {
        urls: new Set(),
        timestamp: currentTime,
      };

      const uniqueImages = [];
      const seenUrls = new Set();

      for (const result of results) {
        if (uniqueImages.length >= count) break;

        if (seenUrls.has(result.url) || sentImagesData.urls.has(result.url)) {
          continue;
        }

        seenUrls.add(result.url);

        try {
          const isValid = await isValidImageUrl(result.url);
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

      // Manage cache size
      if (sentImages.size > MAX_CACHE_SIZE) {
        const entries = Array.from(sentImages.entries());
        entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        sentImages = new Map(entries.slice(0, MAX_CACHE_SIZE / 2));
      }

      sentImagesData.timestamp = currentTime;
      sentImages.set(query, sentImagesData);

      return uniqueImages;
    };

    // Helper function to fetch and prepare images
    const fetchAndPrepareImages = async (images) => {
      return Promise.all(
        images.map(async (image) => {
          let retryCount = 0;
          while (retryCount < MAX_RETRIES) {
            try {
              const response = await axios.get(image.url, {
                responseType: "arraybuffer",
                timeout: 10000,
                maxContentLength: 5 * 1024 * 1024, // 5MB max size
              });

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
              if (retryCount >= MAX_RETRIES) {
                console.error(
                  `Failed to fetch image after ${MAX_RETRIES} attempts:`,
                  error.message,
                );
                throw error;
              }
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }
        }),
      );
    };

    // Main image search and send logic
    try {
      // Check if a query is provided
      if (args.length === 0) {
        await message.reply("Please provide a search query.");
        return;
      }

      // Extract query and image count
      const { count, query } = extractImageCount(args.join(" "));

      // Perform Google Image Search
      const results = await gis(query);

      if (!results || results.length === 0) {
        await message.reply("No images found.");
        return;
      }

      // Get unique images
      const uniqueImages = await getUniqueImages(query, count, results);

      if (uniqueImages.length === 0) {
        await message.reply("No unique images found.");
        return;
      }

      // Fetch and prepare images
      const mediaImages = await fetchAndPrepareImages(uniqueImages);

      // Send images
      for (const media of mediaImages) {
        try {
          await message.reply(media);
        } catch (sendError) {
          logger.error({ err: sendError }, "Error sending image:");
          // Continue to next image if one fails
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error in img command:");
      await message.reply("Failed to search for images.");
    }
  },

  async dl(message, args) {
    if (args.length === 0) {
      await message.reply("Please provide a URL to download.");
      return;
    }

    const url = args[0];
    const chat = await message.getChat();

    try {
      await chat.sendStateTyping();

      const { base64, mimeType, fileName } = await fetchFile(url);
      const media = new MessageMedia(mimeType, base64, fileName);

      await message.reply(media);
      await chat.clearState();
    } catch (error) {
      logger.error({ err: error }, "Error in dl command:");
      await chat.clearState();
      await message.reply(
        `Failed to download and send the file: ${error.message}`,
      );
    }
  },

  async msg(message, args) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    if (args.length < 2) {
      await message.reply("Usage: !msg <number/mention> <message>");
      return;
    }

    try {
      let targetNumber;
      if (message.mentionedIds.length > 0) {
        targetNumber = message.mentionedIds[0];
      } else {
        // Extract the number from the args until a non-numeric argument is found
        const numberParts = [];
        while (
          args.length > 0 &&
          /^[0-9]+$/.test(args[0].replace(/[^0-9]/g, ""))
        ) {
          numberParts.push(args.shift().replace(/[^0-9]/g, ""));
        }
        targetNumber = `${numberParts.join("")}@c.us`;
      }

      const messageText = args.join(" ");
      await message.client.sendMessage(targetNumber, messageText);
      await message.reply("Message sent successfully.");
    } catch (error) {
      logger.error({ err: error }, "Error in msg command:");
      await message.reply("Failed to send message.");
    }
  },

  async shutup(message, args) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    if (args.length < 2) {
      await message.reply(
        'Usage: !shutup <mention or phone number> "<name of the person>"',
      );
      return;
    }

    let targetContact;
    const name = args.slice(1).join(" ").replace(/"/g, "");
    const number = args[0].replace(/[^0-9]/g, "");

    if (message.mentionedIds.length > 0) {
      targetContact = await message.client.getContactById(
        `${message.mentionedIds[0]}@c.us`,
      );
    } else if (number.length > 0) {
      targetContact = await message.client.getContactById(`${number}@c.us`);
    } else {
      await message.reply("Please mention a user or provide their number.");
      return;
    }

    const phoneNumber = targetContact.number;

    // Add the user to the shutup list
    await ShutupUsers.upsert(
      { phoneNumber },
      {
        $set: {
          name,
          addedAt: new Date(),
        },
      },
    );

    await message.reply(`Added ${name} (${phoneNumber}) to the shutup list.`);
  },

  async remind(message, args) {
    if (!(await isAdmin(message))) {
      await message.reply("This command is for admins only.");
      return;
    }

    if (args.length < 1) {
      await message.reply(
        "Usage: !remind <time in 24-hour format> [number/mention]",
      );
      return;
    }

    try {
      let targetNumber;
      if (args.length === 1 || args[0].toLowerCase() === "me") {
        // Remind the user themselves
        const contact = await message.getContact();
        targetNumber = `${contact.number}@c.us`;
        if (args[0].toLowerCase() === "me") {
          args.shift(); // Remove "me" from args
        }
      } else if (message.mentionedIds.length > 0) {
        targetNumber = message.mentionedIds[0];
      } else {
        targetNumber = `${args[1].replace(/[^0-9]/g, "")}@c.us`;
      }

      const time = args[0];
      const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
      if (!timeRegex.test(time)) {
        await message.reply(
          "Invalid time format. Please use HH:MM in 24-hour format.",
        );
        return;
      }

      await scheduleReminder(targetNumber, time);
      await message.reply(`Reminder scheduled to ${targetNumber} at ${time}.`);
    } catch (error) {
      logger.error({ err: error }, "Error in remind command:");
      await message.reply("Failed to schedule reminder.");
    }
  },
};
