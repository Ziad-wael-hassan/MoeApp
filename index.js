import express from "express";
import WhatsAppWeb from "whatsapp-web.js";
import puppeteer from "puppeteer";
import messageHandler from "./services/messageHandler.js";
import dotenv from "dotenv";
import { rateLimit } from "express-rate-limit";
import compression from "compression";
import helmet from "helmet";

dotenv.config();
const { Client, LocalAuth } = WhatsAppWeb;

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const clientIp = req.ip || req.headers["x-forwarded-for"];
    return clientIp;
  },
});

// Create Express app with security and performance middleware
const app = express();
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "10kb" })); // Limit payload size
app.use(express.static("public", { maxAge: "1d" })); // Add cache headers
app.use(apiLimiter);

// Connection management
let client = null;
let isAuthenticated = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

// Improved client configuration
const createClient = () =>
  new Client({
    authStrategy: new LocalAuth({
      clientId: "whatsapp-bot",
      dataPath: process.env.SESSION_DATA_PATH || "./sessions",
    }),
    puppeteer: {
      headless: true,
      executablePath: puppeteer.executablePath(),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
        "--single-process",
      ],
      defaultViewport: { width: 800, height: 600 },
      timeout: 60000,
    },
    restartOnAuthFail: true,
  });

// Middleware for API key validation with caching
const apiKeys = new Set([process.env.API_KEY]);
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || !apiKeys.has(apiKey)) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

// Routes
app.get("/", (req, res) => {
  res.sendFile(`${__dirname}/public/index.html`);
});

app.post("/api/auth/pair", [validateApiKey, apiLimiter], async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required" });
  }
  if (isAuthenticated) {
    return res.status(400).json({ error: "Already authenticated" });
  }
  try {
    const pairingCode = await client.requestPairingCode(phone);
    res.json({
      success: true,
      message: "Pairing code generated successfully",
      code: pairingCode,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to generate pairing code",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

app.post("/api/message", [validateApiKey, apiLimiter], async (req, res) => {
  const { phone, message, markSeen } = req.body;

  if (!phone || !message) {
    return res
      .status(400)
      .json({ error: "Phone number and message are required" });
  }

  try {
    const chatId = phone.includes("@c.us") ? phone : `${phone}@c.us`;
    if (markSeen) {
      await client.sendSeen(chatId);
    }
    const sentMessage = await client.sendMessage(chatId, message);
    res.json({ success: true, messageId: sentMessage.id._serialized });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      error: "Failed to send message",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Event handlers
const setupEventHandlers = () => {
  client.on("ready", async () => {
    console.log("WhatsApp bot is ready!");
    isAuthenticated = true;
    reconnectAttempts = 0;

    const adminPhones = process.env.ADMIN?.split(",") || [];
    await Promise.all(
      adminPhones.map(async (adminPhone) => {
        try {
          const chatId = `${adminPhone}@c.us`;
          const message = "Bot is ready!";
          const sentMessage = await client.sendMessage(chatId, message);
          console.log(
            `Message sent to admin (${adminPhone}): ${sentMessage.body}`,
          );
        } catch (error) {
          console.error(
            `Error sending message to admin (${adminPhone}):`,
            error,
          );
        }
      }),
    );
  });

  client.on("authenticated", () => {
    console.log("Authentication successful!");
    isAuthenticated = true;
  });

  client.on("auth_failure", async (msg) => {
    console.error("Authentication failed:", msg);
    isAuthenticated = false;
    await handleReconnect();
  });

  client.on("disconnected", async (reason) => {
    console.log("Client disconnected:", reason);
    isAuthenticated = false;
    await handleReconnect();
  });

  client.on("message", messageHandler.handleMessage);
};

// Reconnection logic
const handleReconnect = async () => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error("Max reconnection attempts reached. Exiting...");
    process.exit(1);
  }

  console.log(
    `Attempting to reconnect (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`,
  );
  reconnectAttempts++;

  try {
    if (client) {
      await client.destroy();
    }
    client = createClient();
    setupEventHandlers();
    await client.initialize();
  } catch (error) {
    console.error("Reconnection failed:", error);
    setTimeout(handleReconnect, RECONNECT_DELAY);
  }
};

// Initialization
const initialize = async () => {
  try {
    client = createClient();
    setupEventHandlers();
    await client.initialize();
  } catch (error) {
    console.error("Initial initialization failed:", error);
    await handleReconnect();
  }
};

initialize();

// Server startup
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      if (client) {
        await client.destroy();
      }
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { client };
