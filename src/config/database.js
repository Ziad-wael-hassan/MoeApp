import { MongoClient } from "mongodb";
import Papr, { schema, types } from "papr";
import { logger } from "../utils/logger.js";
import { env } from "./env.js";

const papr = new Papr();

// Command schema for storing command configurations and usage statistics
const Commands = papr.model(
  "commands",
  schema({
    name: types.string({ required: true }),
    enabled: types.boolean({ required: true }),
    adminOnly: types.boolean({ required: true }),
    lastUsed: types.date({ required: false }),
    usageCount: types.number({ required: true }),
  }),
);

// Settings schema for bot configuration
const Settings = papr.model(
  "settings",
  schema({
    key: types.string({ required: true }),
    value: types.any({ required: true }),
    updatedAt: types.date({ required: true }),
  }),
);

// Media processing schema for tracking media downloads
const MediaProcessing = papr.model(
  "media_processing",
  schema({
    url: types.string({ required: true }),
    type: types.string({ required: true }),
    processedAt: types.date({ required: true }),
    success: types.boolean({ required: true }),
    error: types.string({ required: false }),
  }),
);

let client = null;

export async function connectDB() {
  try {
    client = await MongoClient.connect(env.MONGODB_URI);
    papr.initialize(client.db("whatsapp-bot-test-v1"));
    await papr.updateSchemas();
    logger.info("Connected to MongoDB");
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection error");
    throw error;
  }
}

export async function closeDB() {
  if (client) {
    await client.close();
    logger.info("Closed MongoDB connection");
  }
}

export { Commands, Settings, MediaProcessing };
