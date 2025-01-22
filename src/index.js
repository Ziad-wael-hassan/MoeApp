import express from "express";
import rateLimit from "express-rate-limit";
import compression from "compression";
import helmet from "helmet";
import { whatsappClient } from "./services/whatsapp/client.js";
import { messageHandler } from "./services/whatsapp/messageHandler.js";
import { connectDB, closeDB } from "./config/database.js";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";
import dotenv from "dotenv";

dotenv.config();

// Create Express app
const app = express();

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "10kb" }));
app.use(express.static("public", { maxAge: "1d" }));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: (req) => {
    return req.ip || req.headers["x-forwarded-for"];
  },
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many requests, please try again later.",
    });
  },
});

// API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== env.API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
};

app.use(apiLimiter);

// Routes
app.get("/", (req, res) => {
  res.sendFile(`${process.cwd()}/public/index.html`);
});

// WhatsApp pairing endpoint
app.post("/api/auth/pair", [validateApiKey, apiLimiter], async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ error: "Phone number is required" });
  }

  if (whatsappClient.isAuthenticated) {
    return res.status(400).json({ error: "Already authenticated" });
  }

  try {
    const pairingCode = await whatsappClient.client.requestPairingCode(phone);
    res.json({
      success: true,
      message: "Pairing code generated successfully",
      code: pairingCode,
    });
  } catch (error) {
    logger.error("Failed to generate pairing code:", error);
    res.status(500).json({
      error: "Failed to generate pairing code",
      details: env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error("Express error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Initialize services
async function initialize() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize WhatsApp client
    await whatsappClient.initialize();
    
    messageHandler.setClient(whatsappClient.getClient());
    // Start message handler
    messageHandler.start();

    // Start Express server
    app.listen(env.PORT, () => {
      logger.info(`Server is running on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error("Initialization error:", error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    // Close WhatsApp client
    await whatsappClient.shutdown();

    // Close MongoDB connection
    await closeDB();

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the application
initialize();
