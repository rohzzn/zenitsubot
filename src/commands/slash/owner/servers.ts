import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { requireOwner } from '../../../utils/owner.js';

export const servers = {
  data: { name: 'servers' },
  category: 'owner',

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await requireOwner(interaction))) return;
    await interaction.deferReply({ ephemeral: true });

    const guilds = [...client.guilds.cache.values()].sort((a, b) => b.memberCount - a.memberCount);
    const totalMembers = guilds.reduce((sum, g) => sum + g.memberCount, 0);

    const lines = guilds.slice(0, 25).map((guild, index) => {
      const joined = guild.members.me?.joinedTimestamp;
      const joinedText = joined ? `<t:${Math.floor(joined / 1000)}:R>` : 'unknown';
      return (
        `**${index + 1}. ${guild.name}**\n` +
        `\`${guild.id}\` · ${guild.memberCount.toLocaleString()} members · joined ${joinedText}`
      );
    });

    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`Servers (${guilds.length})`)
      .setDescription(lines.join('\n\n') || 'Not in any servers.')
      .addFields({
        name: 'Total members',
        value: totalMembers.toLocaleString(),
        inline: true,
      })
      .setTimestamp();

    if (guilds.length > 25) {
      embed.setFooter({ text: `Showing the 25 largest of ${guilds.length}` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
