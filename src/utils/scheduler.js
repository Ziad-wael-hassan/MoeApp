import { Settings } from "../config/database.js";
import { whatsappClient } from "../services/whatsapp/client.js";
import { logger } from "./logger.js";
import cron from "node-cron";

export async function scheduleReminder(targetNumber, time) {
  const [hours, minutes] = time.split(":").map(Number);
  const now = new Date();
  const reminderTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);

  if (reminderTime < now) {
    reminderTime.setDate(reminderTime.getDate() + 1); // Schedule for the next day if time has already passed
  }

  const reminderData = {
    targetNumber,
    reminderTime,
    createdAt: new Date(),
  };

  await Settings.insertOne({
    key: `reminder_${targetNumber}_${reminderTime.getTime()}`,
    value: reminderData,
    updatedAt: new Date(),
  });

  const cronTime = `${minutes} ${hours} * * *`;
  cron.schedule(cronTime, async () => {
    try {
      const client = whatsappClient.getClient();
      await client.sendMessage(targetNumber, "This is your scheduled reminder.");
      await Settings.deleteOne({ key: `reminder_${targetNumber}_${reminderTime.getTime()}` });
    } catch (error) {
      logger.error({ err: error }, "Error sending scheduled reminder message:");
    }
  }, {
    scheduled: true,
    timezone: "Africa/Cairo" // Updated timezone
  });
}

export async function reloadScheduledReminders() {
  try {
    logger.info("Fetching scheduled reminders from the database...");
    const reminders = await Settings.find({ key: { $regex: /^reminder_/ } });
    logger.info(`Found ${reminders.length} scheduled reminders`);

    for (const reminder of reminders) {
      const { targetNumber, reminderTime } = reminder.value;
      const reminderDate = new Date(reminderTime);
      const now = new Date();

      if (reminderDate > now) {
        const [hours, minutes] = [reminderDate.getHours(), reminderDate.getMinutes()];
        const cronTime = `${minutes} ${hours} * * *`;
        logger.info(`Scheduling reminder to ${targetNumber} at ${cronTime}`);

        cron.schedule(cronTime, async () => {
          try {
            const client = whatsappClient.getClient();
            await client.sendMessage(targetNumber, "This is your scheduled reminder.");
            await Settings.deleteOne({ key: `reminder_${targetNumber}_${reminderDate.getTime()}` });
            logger.info(`Scheduled reminder to ${targetNumber} completed`);
          } catch (error) {
            logger.error({ err: error }, "Error sending scheduled reminder message:");
          }
        }, {
          scheduled: true,
          timezone: "Africa/Cairo"
        });
      } else {
        logger.info(`Deleting outdated reminder to ${targetNumber} scheduled for ${reminderDate}`);
        await Settings.deleteOne({ key: `reminder_${targetNumber}_${reminderDate.getTime()}` });
      }
    }
  } catch (error) {
    logger.error({ err: error }, "Error reloading scheduled reminders");
    throw error;
  }
}
