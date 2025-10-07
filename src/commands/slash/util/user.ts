import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder as EB } from 'discord.js';

export const user = {
  data: { name: 'user' },
  async execute(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const member = (interaction.options.getMember('user') as GuildMember) || (interaction.member as GuildMember);
    const embed = new EB()
      .setTitle(member.user.tag)
      .addFields(
        { name: 'ID', value: member.id, inline: true },
        { name: 'Joined', value: member.joinedAt?.toDateString() || 'Unknown', inline: true },
      )
      .setThumbnail(member.user.displayAvatarURL());
    await interaction.reply({ embeds: [embed] });
  },
};

