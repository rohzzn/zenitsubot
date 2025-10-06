import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const leaderboard = {
  data: {
    name: 'leaderboard',
    description: 'View server leaderboard for coins or levels',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const type = interaction.options.getString('type') || 'coins';
    const prisma = getPrisma();
    
    const orderBy = type === 'coins' ? { coins: 'desc' as const } : { level: 'desc' as const, xp: 'desc' as const };
    
    const topUsers = await prisma.userEconomy.findMany({
      where: { guildId: interaction.guildId! },
      orderBy,
      take: 10
    });
    
    if (topUsers.length === 0) {
      await interaction.reply({ content: 'No economy data yet! Start using commands! 💛', ephemeral: true });
      return;
    }
    
    const description = await Promise.all(
      topUsers.map(async (user, index) => {
        const member = await interaction.guild!.members.fetch(user.userId).catch(() => null);
        const username = member?.user.username || 'Unknown User';
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        
        if (type === 'coins') {
          return `${medal} **${username}** - ${user.coins.toLocaleString()} 💛`;
        } else {
          return `${medal} **${username}** - Level ${user.level} ⚡ (${user.xp} XP)`;
        }
      })
    );
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setTitle(`⚡ ${type === 'coins' ? 'Wealth' : 'Level'} Leaderboard`)
      .setDescription(description.join('\n'))
      .setFooter({ text: 'Keep climbing! 💛' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

