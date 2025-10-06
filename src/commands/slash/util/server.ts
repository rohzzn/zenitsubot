import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const server = {
  data: { name: 'server' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild!;
    const embed = new EB()
      .setTitle(guild.name)
      .addFields(
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
      )
      .setThumbnail(guild.iconURL() || '');
    await interaction.reply({ embeds: [embed] });
  },
};

