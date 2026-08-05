import type { Client, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const avatar = {
  data: { name: 'avatar' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const user = interaction.options.getUser('user') || interaction.user;
    const embed = new EB()
      .setTitle(`${user.tag}'s Avatar`)
      .setImage(user.displayAvatarURL({ size: 512 }));
    await interaction.reply({ embeds: [embed] });
  },
};
