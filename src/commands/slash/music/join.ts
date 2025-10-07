import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';

export const join = {
  data: { name: 'join' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      await interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
      return;
    }

    try {
      const guildId = interaction.guildId!;
      
      // Check if already connected
      const existingPlayer = shoukaku?.players.get(guildId);
      if (existingPlayer) {
        await interaction.reply({ content: 'Already connected to a voice channel.', ephemeral: true });
        return;
      }

      // Join the channel
      await shoukaku!.joinVoiceChannel({
        guildId,
        channelId: member.voice.channel.id,
        shardId: member.voice.channel.guild.shardId ?? 0,
        deaf: true,
      });

      await interaction.reply({ content: `Joined ${member.voice.channel.name}`, ephemeral: true });
    } catch (err: any) {
      await interaction.reply({ content: `Error: ${err.message}`, ephemeral: true });
    }
  },
};
