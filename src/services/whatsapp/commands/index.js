import { textToSpeech } from "../../audio/tts.js";
import { Commands, Settings } from "../../../config/database.js";
import { logger } from "../../../utils/logger.js";
import gis from "async-g-i-s";
import WhatsAppWeb from "whatsapp-web.js";

const { MessageMedia } = WhatsAppWeb;

async function isAdmin(message) {
  const adminNumbers = process.env.ADMIN?.split(",") || [];

  const contact = await message.getContact();
  const contactNumber = contact?.number || "";

  return adminNumbers.includes(contactNumber);
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
    if (args.length === 0) {
      await message.reply("Please provide a search query.");
      return;
    }

    try {
      const query = args.join(" ");
      const results = await gis(query);

      if (!results || results.length === 0) {
        await message.reply("No images found.");
        return;
      }

      // Try up to 3 images in case some fail
      for (let i = 0; i < Math.min(3, results.length); i++) {
        try {
          const media = await MessageMedia.fromUrl(results[i].url);
          await message.reply(media);
          break;
        } catch (error) {
          logger.error({ err: error }, "Error fetching image:");
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Error in img command:");
      await message.reply("Failed to search for images.");
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
        targetNumber = `${args[0].replace(/[^0-9]/g, "")}@c.us`;
      }

      const messageText = args.slice(1).join(" ");
      await message.client.sendMessage(targetNumber, messageText);
      await message.reply("Message sent successfully.");
    } catch (error) {
      logger.error({ err: error }, "Error in msg command:");
      await message.reply("Failed to send message.");
    }
  },
};
