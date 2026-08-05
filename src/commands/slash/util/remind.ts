import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';
import { parseDuration, formatDuration } from '../../../utils/duration.js';

const MAX_DELAY_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_PENDING_PER_USER = 25;

export const remind = {
  data: { name: 'remind' },
  category: 'utility',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const userId = interaction.user.id;

    if (subcommand === 'set') {
      const rawDelay = interaction.options.getString('in', true);
      const text = interaction.options.getString('text', true);

      const delay = parseDuration(rawDelay);
      if (delay === null) {
        await interaction.reply({
          content: 'Could not read that duration. Try `30m`, `2h`, `1h30m` or `3 days`.',
          ephemeral: true,
        });
        return;
      }

      if (delay > MAX_DELAY_MS) {
        await interaction.reply({
          content: 'Reminders cannot be more than a year out.',
          ephemeral: true,
        });
        return;
      }

      const pending = await prisma.reminder.count({ where: { userId, completed: false } });
      if (pending >= MAX_PENDING_PER_USER) {
        await interaction.reply({
          content: `You already have ${pending} pending reminders. Clear some with \`/remind cancel\`.`,
          ephemeral: true,
        });
        return;
      }

      const dueAt = new Date(Date.now() + delay);

      await prisma.reminder.create({
        data: {
          guildId: interaction.guildId ?? '',
          channelId: interaction.channelId,
          userId,
          text,
          dueAt,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setTitle('Reminder set')
        .setDescription(text)
        .addFields(
          { name: 'In', value: formatDuration(delay), inline: true },
          { name: 'At', value: `<t:${Math.floor(dueAt.getTime() / 1000)}:f>`, inline: true },
        )
        .setFooter({ text: 'Delivered here, or by DM if this channel is unavailable' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === 'list') {
      const reminders = await prisma.reminder.findMany({
        where: { userId, completed: false },
        orderBy: { dueAt: 'asc' },
        take: 25,
      });

      if (reminders.length === 0) {
        await interaction.reply({ content: 'You have no pending reminders.', ephemeral: true });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Your reminders (${reminders.length})`)
        .setDescription(
          reminders
            .map(
              (r, i) =>
                `**${i + 1}.** ${r.text}\n` +
                `<t:${Math.floor(r.dueAt.getTime() / 1000)}:R> · id \`${r.id.slice(-6)}\``,
            )
            .join('\n\n'),
        )
        .setFooter({ text: 'Cancel with /remind cancel id:<last 6 characters>' });

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // cancel
    const shortId = interaction.options.getString('id', true).trim().toLowerCase();

    const candidates = await prisma.reminder.findMany({ where: { userId, completed: false } });
    const match = candidates.find((r) => r.id.toLowerCase().endsWith(shortId));

    if (!match) {
      await interaction.reply({
        content: `No pending reminder ending in \`${shortId}\`. Check \`/remind list\`.`,
        ephemeral: true,
      });
      return;
    }

    await prisma.reminder.delete({ where: { id: match.id } });
    await interaction.reply({ content: `Cancelled: ${match.text}`, ephemeral: true });
  },
};
