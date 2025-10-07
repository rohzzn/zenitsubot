import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const gift = {
  data: {
    name: 'gift',
    description: 'Send coins to another user',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const prisma = getPrisma();
    const userId = interaction.user.id;
    
    if (target.id === userId) {
      await interaction.reply({ content: 'You cannot gift yourself.', ephemeral: true });
      return;
    }
    
    if (target.bot) {
      await interaction.reply({ content: 'You cannot gift bots.', ephemeral: true });
      return;
    }
    
    if (amount < 1) {
      await interaction.reply({ content: 'Amount must be at least 1 coin.', ephemeral: true });
      return;
    }
    
    let userEcon = await prisma.userEconomy.findUnique({ where: { userId } });
    let targetEcon = await prisma.userEconomy.findUnique({ where: { userId: target.id } });
    
    if (!userEcon) {
      userEcon = await prisma.userEconomy.create({ data: { userId, coins: 1000 } });
    }
    
    if (!targetEcon) {
      targetEcon = await prisma.userEconomy.create({ data: { userId: target.id, coins: 1000 } });
    }
    
    if (userEcon.coins < amount) {
      await interaction.reply({ 
        content: `You only have **${userEcon.coins.toLocaleString()}** coins.`,
        ephemeral: true 
      });
      return;
    }
    
    // Transfer coins
    await prisma.userEconomy.update({
      where: { userId },
      data: { coins: userEcon.coins - amount }
    });
    
    await prisma.userEconomy.update({
      where: { userId: target.id },
      data: { coins: targetEcon.coins + amount }
    });
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTitle('🎁 Gift Sent')
      .setDescription(`Sent **${amount.toLocaleString()}** coins to ${target.username}`)
      .addFields([
        { name: 'Your Balance', value: `${(userEcon.coins - amount).toLocaleString()} 💛`, inline: true },
        { name: 'Their Balance', value: `${(targetEcon.coins + amount).toLocaleString()} 💛`, inline: true }
      ])
      .setThumbnail(target.displayAvatarURL())
      .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};


