import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { requireOwner } from '../../../utils/owner.js';
import { logger } from '../../../services/logger.js';

/** Picks the system channel, falling back to the first channel we can post in. */
function announcementTarget(guild: import('discord.js').Guild): TextChannel | null {
  const me = guild.members.me;
  if (!me) return null;

  const canPost = (channel: TextChannel) =>
    channel
      .permissionsFor(me)
      ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) ?? false;

  const system = guild.systemChannel;
  if (system && canPost(system)) return system;

  return (
    guild.channels.cache
      .filter(
        (c): c is TextChannel => c.type === ChannelType.GuildText && canPost(c as TextChannel),
      )
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first() ?? null
  );
}

export const announce = {
  data: { name: 'announce' },
  category: 'owner',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireOwner(interaction))) return;

    const title = interaction.options.getString('title', true);
    const message = interaction.options.getString('message', true);
    const dryRun = interaction.options.getBoolean('dry_run') ?? true;

    await interaction.deferReply({ ephemeral: true });

    const guilds = [...client.guilds.cache.values()];
    const reachable: string[] = [];
    const unreachable: string[] = [];

    for (const guild of guilds) {
      if (announcementTarget(guild)) reachable.push(guild.name);
      else unreachable.push(guild.name);
    }

    // Default to a dry run: this posts to every server the bot is in, and there
    // is no way to unsend it.
    if (dryRun) {
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle('Dry run — nothing was sent')
        .setDescription(
          `Would post to **${reachable.length}** of ${guilds.length} servers.\n\n` +
            `**Preview**\n> **${title}**\n> ${message.replace(/\n/g, '\n> ')}`,
        )
        .setFooter({ text: 'Run again with dry_run: False to actually send' });

      if (unreachable.length) {
        embed.addFields({
          name: `No postable channel (${unreachable.length})`,
          value: unreachable.slice(0, 20).join(', ').slice(0, 1024),
          inline: false,
        });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const announcement = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(title)
      .setDescription(message)
      .setTimestamp();

    let sent = 0;
    let failed = 0;

    for (const guild of guilds) {
      const channel = announcementTarget(guild);
      if (!channel) {
        failed++;
        continue;
      }

      try {
        await channel.send({ embeds: [announcement] });
        sent++;
      } catch (err) {
        logger.warn({ err, guild: guild.id }, 'Announcement delivery failed');
        failed++;
      }
    }

    await interaction.editReply(
      `Announcement sent to ${sent} server(s). ${failed} could not be reached.`,
    );
  },
};
