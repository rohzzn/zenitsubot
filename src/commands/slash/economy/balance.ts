import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const balance = {
  data: {
    name: 'balance',
    description: 'Check your or someone else\'s balance and level',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user') || interaction.user;
    const prisma = getPrisma();
    
    let userEcon = await prisma.userEconomy.findUnique({
      where: { 
        userId_guildId: { 
          userId: targetUser.id, 
          guildId: interaction.guildId! 
        }
      }
    });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({
        data: { 
          userId: targetUser.id, 
          guildId: interaction.guildId!,
          coins: 1000 
        }
      });
    }
    
    const xpNeeded = userEcon.level * 100;
    const progress = Math.floor((userEcon.xp / xpNeeded) * 20);
    const progressBar = '█'.repeat(progress) + '░'.repeat(20 - progress);
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({ 
        name: targetUser.username, 
        iconURL: targetUser.displayAvatarURL() 
      })
      .setTitle('⚡ Profile')
      .addFields([
        { name: '💛 Coins', value: `**${userEcon.coins.toLocaleString()}**`, inline: true },
        { name: '⚡ Level', value: `**${userEcon.level}**`, inline: true },
        { name: '📊 XP', value: `${userEcon.xp}/${xpNeeded}\n${progressBar}`, inline: false }
      ])
      .setFooter({ text: targetUser.id === interaction.user.id ? 'Your stats look great! 💛' : 'Keep grinding! ⚡' })
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};

