import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const join = {
  data: { name: 'join' },
  category: 'music',
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember;
    const channel = member.voice.channel;

    if (!channel) {
      await interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
      return;
    }

    try {
      const guildId = interaction.guildId!;

      if (shoukaku?.players.get(guildId)) {
        await interaction.reply({ content: 'Already connected to a voice channel.', ephemeral: true });
        return;
      }

      client.playerManager.ensureQueue(guildId, channel.id);
      await client.playerManager.ensurePlayer(channel);

      await interaction.reply({ content: `Joined ${channel.name}`, ephemeral: true });
    } catch (err: any) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  },
};
