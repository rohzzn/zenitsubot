import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const daily = {
  data: {
    name: 'daily',
    description: 'Claim your daily coins!',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const prisma = getPrisma();
    const userId = interaction.user.id;
    const guildId = interaction.guildId!;
    
    let userEcon = await prisma.userEconomy.findUnique({
      where: { userId_guildId: { userId, guildId } }
    });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { userId, guildId, coins: 1000 }
      });
    }
    
    const now = new Date();
    const lastDaily = userEcon.lastDaily;
    
    if (lastDaily) {
      const timeSince = now.getTime() - lastDaily.getTime();
      const hoursLeft = 24 - Math.floor(timeSince / (1000 * 60 * 60));
      
      if (timeSince < 24 * 60 * 60 * 1000) {
        await interaction.reply({ 
          content: `⏰ W-wait! You already claimed your daily! Come back in **${hoursLeft} hours**! 😰`,
          ephemeral: true 
        });
        return;
      }
    }
    
    const baseDaily = 500;
    const bonus = Math.floor(Math.random() * 200) + 100; // 100-300 bonus
    const total = baseDaily + bonus;
    
    await prisma.userEconomy.update({
      where: { userId_guildId: { userId, guildId } },
      data: { 
        coins: userEcon.coins + total,
        lastDaily: now
      }
    });
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.SUCCESS)
      .setTitle('⚡ Daily Reward Claimed!')
      .setDescription(
        `You received **${total}** coins! 💛\n\n` +
        `Base: ${baseDaily} 💰\n` +
        `Bonus: +${bonus} ⚡\n\n` +
        `New balance: **${(userEcon.coins + total).toLocaleString()}** coins`
      )
      .setFooter({ text: 'Come back tomorrow! 💛' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

