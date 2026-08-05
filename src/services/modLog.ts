import type { Client, TextChannel, User } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { getPrisma } from './db.js';
import { logger } from './logger.js';

export interface ModLogEntry {
  guildId: string;
  action: string;
  target: User | { id: string; tag: string };
  moderator: User;
  reason?: string;
  extra?: Array<{ name: string; value: string }>;
}

const ACTION_COLORS: Record<string, number> = {
  Warn: 0xe8a33d,
  Kick: 0xe8703d,
  Ban: 0xd3453d,
  Timeout: 0xe8a33d,
  Purge: 0x5f7fa8,
};

/**
 * Writes a moderation action to the guild's configured mod-log channel.
 *
 * Best-effort by design: a missing channel or a permissions problem must never
 * make the moderation command itself appear to fail.
 */
export async function writeModLog(client: Client, entry: ModLogEntry): Promise<void> {
  try {
    const config = await getPrisma().guildConfig.findUnique({
      where: { guildId: entry.guildId },
      select: { modLogChannelId: true },
    });

    if (!config?.modLogChannelId) return;

    const channel = (await client.channels
      .fetch(config.modLogChannelId)
      .catch(() => null)) as TextChannel | null;

    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(ACTION_COLORS[entry.action] ?? 0x5f7fa8)
      .setTitle(entry.action)
      .addFields(
        { name: 'User', value: `${entry.target.tag}\n\`${entry.target.id}\``, inline: true },
        {
          name: 'Moderator',
          value: `${entry.moderator.tag}\n\`${entry.moderator.id}\``,
          inline: true,
        },
        { name: 'Reason', value: entry.reason || 'No reason provided', inline: false },
        ...(entry.extra ?? []).map((f) => ({ ...f, inline: true })),
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn({ err, guildId: entry.guildId }, 'Could not write mod log entry');
  }
}
