import type { Client, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const DEFAULT_GOODBYE = '{user} has left {server}. We are now {memberCount} members.';

/** Substitutes the placeholders documented on the command's message option. */
export function renderTemplate(
  template: string,
  values: { user: string; server: string; memberCount: number },
): string {
  return template
    .replaceAll('{user}', values.user)
    .replaceAll('{server}', values.server)
    .replaceAll('{memberCount}', values.memberCount.toString());
}

export const goodbye = {
  data: { name: 'goodbye' },
  category: 'admin',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const guildId = interaction.guildId!;

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message') || DEFAULT_GOODBYE;

      await prisma.guildConfig.upsert({
        where: { guildId },
        create: {
          guildId,
          goodbyeEnabled: true,
          goodbyeChannelId: channel.id,
          goodbyeMessage: message,
        },
        update: {
          goodbyeEnabled: true,
          goodbyeChannelId: channel.id,
          goodbyeMessage: message,
        },
      });

      const preview = renderTemplate(message, {
        user: interaction.user.username,
        server: interaction.guild!.name,
        memberCount: interaction.guild!.memberCount,
      });

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setTitle('Goodbye messages enabled')
        .setDescription(`Channel: <#${channel.id}>\n\n**Preview**\n${preview}`)
        .setFooter({ text: 'Placeholders: {user} {server} {memberCount}' });

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (subcommand === 'disable') {
      await prisma.guildConfig.upsert({
        where: { guildId },
        create: { guildId, goodbyeEnabled: false },
        update: { goodbyeEnabled: false },
      });

      await interaction.reply({ content: 'Goodbye messages disabled.', ephemeral: true });
      return;
    }

    // test
    const config = await prisma.guildConfig.findUnique({ where: { guildId } });

    if (!config?.goodbyeEnabled || !config.goodbyeChannelId) {
      await interaction.reply({ content: 'Goodbye messages are not set up.', ephemeral: true });
      return;
    }

    const channel = interaction.guild!.channels.cache.get(config.goodbyeChannelId) as
      | TextChannel
      | undefined;

    if (!channel?.isTextBased()) {
      await interaction.reply({
        content: 'The configured goodbye channel no longer exists.',
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setDescription(
        renderTemplate(config.goodbyeMessage || DEFAULT_GOODBYE, {
          user: interaction.user.username,
          server: interaction.guild!.name,
          memberCount: interaction.guild!.memberCount,
        }),
      )
      .setThumbnail(interaction.user.displayAvatarURL())
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    await interaction.reply({ content: 'Test message sent.', ephemeral: true });
  },
};
