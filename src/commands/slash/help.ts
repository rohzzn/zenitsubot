import type { Client, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const help = {
  data: { name: 'help' },
  async execute(client: Client, interaction: ChatInputCommandInteraction) {
    const embed = new EB()
      .setTitle('Help')
      .setDescription('Categories: General, Moderation, Music, Admin')
      .addFields(
        { name: 'General', value: '`/ping`' },
        { name: 'Music', value: '`/join`, `/play`, `/pause`, `/resume`, `/skip`, `/stop`' },
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};


