import { textToSpeech } from "../utils/audio/tts.js";
import wwebjs from "whatsapp-web.js";
import gis from "async-g-i-s";
import { imageHandler } from "./imageHandler.js";
import { client } from "../index.js";


const { MessageMedia } = wwebjs;

// State variables
let isAIEnabled = true;
let areCommandsEnabled = true;
const disabledCommands = new Set();
const stats = {
  commandsProcessed: 0,
  aiResponses: 0,
  errors: 0,
  imagesSent: 0,
  audioSent: 0
};
const startTime = Date.now();
const adminNumbers = process.env.ADMIN?.split(",") || [];

const commands = {
  "!help": {
    handler: handleHelp,
    description: "Shows all available commands",
    format: "!help",
    adminOnly: false,
  },
  "!toggleai": {
    handler: handleToggleAI,
    description: "Toggles AI functionality on/off",
    format: "!toggleai",
    adminOnly: true,
  },
  "!togglecmd": {
    handler: handleToggleCommands,
    description: "Toggles specific or all commands on/off",
    format: "!togglecmd [command]",
    adminOnly: true,
  },
  "!pfp": {
    handler: handleProfilePicture,
    description: "Get profile picture of a user",
    format: "!pic <phone/mention>\nExample: !pic +20 114 517 3971 or !pic @User",
    adminOnly: false,
  },
  "!logs": {
    handler: handleLogs,
    description: "Displays bot statistics and logs",
    format: "!logs",
    adminOnly: true,
  },
  "!speak": {
    handler: handleSpeakCommand,
    description: "Converts quoted message to speech",
    format: "!speak (reply to a message)",
    adminOnly: false,
  },
  "!img": {
    handler: handleImageSearch,
    description: "Searches and sends image(s)",
    format: "!image [number] <query>",
    adminOnly: false,
  },
  "!msg": {
    handler: handleSendMessage,
    description: "Sends a private message",
    format: '!msg <phone/mention> "message"\nExample: !msg +1234567890 "hello"',
    adminOnly: true,
  },
};

async function handleHelp(message) {
  let commandsList = "";
  for (const [command, details] of Object.entries(commands)) {
    if (!details.adminOnly || (await isAdmin(message))) {
      commandsList += `*${command}*: ${details.description}\nFormat: ${details.format}\n\n`;
    }
  }
  await message.reply(`Here are the available commands:\n\n${commandsList}`);
}

async function handleToggleAI(message) {
  isAIEnabled = !isAIEnabled;
  await message.reply(`AI functionality is now ${isAIEnabled ? "enabled" : "disabled"}!`);
}

async function handleLogs(message) {
  const uptime = formatUptime(Math.floor((Date.now() - startTime) / 1000));
  const logs = `
🤖 *Bot Statistics* 🤖
Uptime: ${uptime}
AI Enabled: ${isAIEnabled}
Commands Processed: ${stats.commandsProcessed}
AI Responses: ${stats.aiResponses}
Errors: ${stats.errors}
`;
  await message.reply(logs.trim());
}

async function handleSpeakCommand(message) {
  try {
    if (!message.hasQuotedMsg) {
      await message.reply("Please reply to a message to use this command.");
      return;
    }
    const quotedMessage = await message.getQuotedMessage();
    if (quotedMessage.body) {
      const { base64, mimeType } = await textToSpeech(quotedMessage.body);
      const media = new MessageMedia(mimeType, base64);
      await message.reply(media, null, { sendAudioAsVoice: true });
      stats.audioSent++;
    }
  } catch (error) {
    console.error("Error in !speak command:", error);
    await message.reply("Failed to convert the message to speech.");
    stats.errors++;
  }
}

async function handleSendMessage(message) {
  const args = message.body.slice(5).trim();
  const matches = args.match(/"([^"]+)"/);
  if (!matches) {
    await message.reply('Invalid format. Use: !msg <phone/mention> "message"');
    return;
  }

  const messageContent = matches[1];
  const recipient = args.replace(`"${messageContent}"`, "").trim();
  const chatId = recipient.includes("@")
    ? `${recipient.replace("@", "")}@c.us`
    : `${recipient.replace(/[^0-9]/g, "")}@c.us`;

  try {
    await client.sendMessage(chatId, messageContent);
    await message.reply("Message sent successfully!");
  } catch (error) {
    console.error("Error sending message:", error);
    await message.reply("Failed to send the message.");
    stats.errors++;
  }
}

async function handleToggleCommands(message) {
  const args = message.body.slice(12).trim();

  if (!args) {
    areCommandsEnabled = !areCommandsEnabled;
    disabledCommands.clear();
    await message.reply(`All commands are now ${areCommandsEnabled ? "enabled" : "disabled"}.`);
    return;
  }

  const commandName = `!${args.toLowerCase()}`;
  if (!commands[commandName]) {
    await message.reply(`Command "${commandName}" not found.`);
    return;
  }

  if (disabledCommands.has(commandName)) {
    disabledCommands.delete(commandName);
    await message.reply(`Command "${commandName}" has been enabled.`);
  } else {
    disabledCommands.add(commandName);
    await message.reply(`Command "${commandName}" has been disabled.`);
  }
}

async function handleProfilePicture(message) {
  const args = message.body.slice(7).trim();
  try {
    if (!args) {
      await message.reply(`Invalid format. Use:\n${commands["!pic"].format}`);
      return;
    }

    let contact;
    if (args.startsWith("@")) {
      const mentions = await message.getMentions();
      const mentionedUser = mentions.find((m) => m.id.user === args.substring(1));
      if (!mentionedUser) {
        await message.reply("Mentioned user not found");
        return;
      }
      contact = mentionedUser;
    } else {
      const cleanPhone = parsePhoneNumber(args);
      if (!cleanPhone) {
        await message.reply("Invalid phone number format");
        return;
      }
      contact = await client.getContactById(`${cleanPhone}@c.us`);
    }

    if (!contact) {
      await message.reply("Contact not found");
      return;
    }

    const profilePic = await contact.getProfilePicUrl();
    if (!profilePic) {
      await message.reply("Profile picture not available");
      return;
    }

    const response = await axios.get(profilePic, {
      responseType: "arraybuffer",
    });
    const base64Data = Buffer.from(response.data).toString("base64");
    const media = new MessageMedia("image/jpeg", base64Data);
    await message.reply(media);
  } catch (error) {
    console.error("Error getting profile picture:", error);
    stats.errors++;
    await message.reply("Failed to get profile picture");
  }
}

async function handleImageSearch(message) {
  const query = message.body.slice(5).trim();
  
  if (!query) {
    await message.reply("Please provide a search query.");
    return;
  }

  try {
    await message.chat.sendStateTyping();

    const { count, query: cleanQuery } = imageHandler.extractImageCount(query);
    const captionPromise = isAIEnabled
      ? generateImageCaption(cleanQuery)
      : Promise.resolve("");

    const results = await gis(cleanQuery);
    if (!results || results.length === 0) {
      await message.reply("No images found.");
      return;
    }

    const uniqueImages = await imageHandler.getUniqueImages(cleanQuery, count, results);

    if (uniqueImages.length === 0) {
      await message.reply("No valid images found.");
      return;
    }

    const mediaPromises = imageHandler.fetchAndPrepareImages(uniqueImages);
    const [mediaItems, caption] = await Promise.all([mediaPromises, captionPromise]);

    for (let i = 0; i < mediaItems.length; i++) {
      const captionText = i === 0 ? caption : "";
      await message.reply(mediaItems[i], null, { caption: captionText });
      stats.imagesSent++;
    }
  } catch (error) {
    console.error("Error processing image search:", error);
    stats.errors++;
    await message.reply("Error searching for images.");
  }
}

// Helper function to check if a message sender is an admin
async function isAdmin(message) {
  const contact = await message.getContact();
  const contactNumber = contact?.number || "";
  return adminNumbers.includes(contactNumber);
}

export {
  commands,
  stats,
  isAIEnabled,
  areCommandsEnabled,
  disabledCommands
};
