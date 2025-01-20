import { z } from 'zod';
import { logger } from '../utils/logger.js';

// Define the environment schema
const envSchema = z.object({
  // WhatsApp Bot Configuration
  SESSION_DATA_PATH: z.string().default('./sessions'),
  ADMIN: z.string()
    .transform(val => val.split(',').map(num => num.trim()))
    .default(''),

  // API Keys
  GEMINI_API_KEY: z.string(),
  HF_TOKEN: z.string(),
  API_KEY: z.string().min(32, 'API key must be at least 32 characters'),

  // MongoDB Configuration
  MONGODB_URI: z.string().url('Invalid MongoDB URI').default('mongodb://localhost:27017/whatsapp_bot'),

  // Server Configuration
  PORT: z.string().transform(val => Number.parseInt(val, 10)).default('3000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string()
    .transform(val => Number.parseInt(val, 10))
    .default('900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: z.string()
    .transform(val => Number.parseInt(val, 10))
    .default('100'),

  // Webhook Configuration
  WEBHOOK_URLS: z.string()
    .transform(val => val.split(',').map(url => url.trim()))
    .default(''),
});

// Process and validate environment variables
function validateEnv() {
  try {
    // Parse and validate environment variables
    const env = envSchema.parse(process.env);

    // Log successful validation in development
    logger.info('Environment variables validated successfully');

    return env;
  } catch (error) {
    // Log validation errors
    logger.error('Environment validation failed:', error.errors);

    // Exit process on validation failure
    process.exit(1);
  }
}

// Export validated environment variables
export const env = validateEnv();
