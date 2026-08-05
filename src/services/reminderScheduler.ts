import type { Client, TextChannel } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';
import { ZENITSU_THEME } from '../utils/constants.js';

const POLL_INTERVAL_MS = 30_000;
const MAX_PER_TICK = 25;

/**
 * Polls for due reminders rather than holding timers in memory, so reminders
 * set before a restart still fire afterwards.
 */
export function startReminderScheduler(client: Client) {
  setInterval(() => void deliverDue(client), POLL_INTERVAL_MS);
  setTimeout(() => void deliverDue(client), 10_000);
  logger.info('Reminder scheduler started');
}

async function deliverDue(client: Client) {
  const prisma = getPrisma();

  try {
    const due = await prisma.reminder.findMany({
      where: { completed: false, dueAt: { lte: new Date() } },
      orderBy: { dueAt: 'asc' },
      take: MAX_PER_TICK,
    });

    for (const reminder of due) {
      // Mark first: a delivery failure must not put the reminder into a loop
      // where it retries forever every 30 seconds.
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { completed: true },
      });

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle('Reminder')
        .setDescription(reminder.text)
        .setFooter({ text: `Set <t:${Math.floor(reminder.createdAt.getTime() / 1000)}:R>` })
        .setTimestamp();

      try {
        const channel = reminder.channelId
          ? ((await client.channels
              .fetch(reminder.channelId)
              .catch(() => null)) as TextChannel | null)
          : null;

        if (channel?.isTextBased()) {
          await channel.send({
            content: `<@${reminder.userId}>`,
            embeds: [embed],
            allowedMentions: { users: [reminder.userId] },
          });
        } else {
          const user = await client.users.fetch(reminder.userId);
          await user.send({ embeds: [embed] });
        }
      } catch (err) {
        logger.warn({ err, reminder: reminder.id }, 'Could not deliver reminder');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Reminder scheduler tick failed');
  }
}
