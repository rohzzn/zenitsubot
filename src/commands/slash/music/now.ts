import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const now = {
  data: { name: 'now' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const pm = client.playerManager;
    const q = pm.getQueue(interaction.guildId!);
    const track = q?.now();
    if (!track) {
      await interaction.reply({ content: 'Nothing playing.', ephemeral: true });
      return;
    }
    const embed = new EB().setTitle('Now Playing').setDescription(track.title);
    await interaction.reply({ embeds: [embed] });
  },
};

