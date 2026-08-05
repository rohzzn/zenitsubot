import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';
import { writeModLog } from '../../../services/modLog.js';

export const warn = {
  data: { name: 'warn' },
  category: 'moderation',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason', true);

    if (!member) {
      await interaction.reply({ content: 'User not found in this server.', ephemeral: true });
      return;
    }

    if (member.id === interaction.user.id) {
      await interaction.reply({ content: 'You cannot warn yourself.', ephemeral: true });
      return;
    }

    if (member.user.bot) {
      await interaction.reply({ content: 'You cannot warn a bot.', ephemeral: true });
      return;
    }

    const prisma = getPrisma();

    await prisma.warning.create({
      data: {
        guildId: interaction.guildId!,
        userId: member.id,
        moderatorId: interaction.user.id,
        reason,
      },
    });

    const total = await prisma.warning.count({
      where: { guildId: interaction.guildId!, userId: member.id },
    });

    // Best-effort courtesy DM; users with DMs closed should not fail the command.
    await member
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(ZENITSU_THEME.ERROR)
            .setTitle(`Warning in ${interaction.guild!.name}`)
            .setDescription(reason)
            .setFooter({ text: `You now have ${total} warning(s) in this server` })
            .setTimestamp(),
        ],
      })
      .catch(() => {});

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.ERROR)
      .setTitle('Warning issued')
      .addFields(
        { name: 'User', value: `${member.user.tag}`, inline: true },
        { name: 'Total warnings', value: `${total}`, inline: true },
        { name: 'Reason', value: reason, inline: false },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await writeModLog(client, {
      guildId: interaction.guildId!,
      action: 'Warn',
      target: member.user,
      moderator: interaction.user,
      reason,
      extra: [{ name: 'Total warnings', value: `${total}` }],
    });
  },
};

export const warnings = {
  data: { name: 'warnings' },
  category: 'moderation',

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const guildId = interaction.guildId!;

    if (subcommand === 'list') {
      const target = interaction.options.getUser('user', true);

      const records = await prisma.warning.findMany({
        where: { guildId, userId: target.id },
        orderBy: { createdAt: 'desc' },
        take: 25,
      });

      if (records.length === 0) {
        await interaction.reply({
          content: `${target.tag} has no warnings in this server.`,
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle(`Warnings for ${target.tag} (${records.length})`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(
          records
            .map(
              (r, i) =>
                `**${i + 1}.** ${r.reason}\n` +
                `by <@${r.moderatorId}> · <t:${Math.floor(r.createdAt.getTime() / 1000)}:R> · id \`${r.id.slice(-6)}\``,
            )
            .join('\n\n')
            .slice(0, 4000),
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === 'remove') {
      const shortId = interaction.options.getString('id', true).trim().toLowerCase();

      const candidates = await prisma.warning.findMany({ where: { guildId } });
      const match = candidates.find((w) => w.id.toLowerCase().endsWith(shortId));

      if (!match) {
        await interaction.reply({
          content: `No warning in this server ending in \`${shortId}\`.`,
          ephemeral: true,
        });
        return;
      }

      await prisma.warning.delete({ where: { id: match.id } });
      await interaction.reply({ content: `Removed warning: ${match.reason}`, ephemeral: true });
      return;
    }

    // clear
    const target = interaction.options.getUser('user', true);
    const deleted = await prisma.warning.deleteMany({ where: { guildId, userId: target.id } });

    await interaction.reply({
      content: `Cleared ${deleted.count} warning(s) for ${target.tag}.`,
      ephemeral: true,
    });
  },
};
