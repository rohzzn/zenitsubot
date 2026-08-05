import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { getPrisma } from '../../../services/db.js';

export const modlog = {
  data: { name: 'modlog' },
  category: 'admin',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,

  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const guildId = interaction.guildId!;

    if (subcommand === 'set') {
      const channel = interaction.options.getChannel('channel', true);

      await prisma.guildConfig.upsert({
        where: { guildId },
        create: { guildId, modLogChannelId: channel.id },
        update: { modLogChannelId: channel.id },
      });

      await interaction.reply({
        content: `Moderation actions will now be logged to <#${channel.id}>.`,
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'disable') {
      await prisma.guildConfig.upsert({
        where: { guildId },
        create: { guildId, modLogChannelId: null },
        update: { modLogChannelId: null },
      });

      await interaction.reply({ content: 'Moderation logging disabled.', ephemeral: true });
      return;
    }

    const config = await prisma.guildConfig.findUnique({ where: { guildId } });

    await interaction.reply({
      content: config?.modLogChannelId
        ? `Moderation actions are logged to <#${config.modLogChannelId}>.`
        : 'Moderation logging is not configured. Use `/modlog set`.',
      ephemeral: true,
    });
  },
};
