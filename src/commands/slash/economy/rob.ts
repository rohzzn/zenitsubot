import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const rob = {
  data: {
    name: 'rob',
    description: 'Attempt to steal coins from another user (risky!)',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const target = interaction.options.getUser('user', true);
    const prisma = getPrisma();
    const userId = interaction.user.id;
    
    if (target.id === userId) {
      await interaction.reply({ content: 'You cannot rob yourself.', ephemeral: true });
      return;
    }
    
    if (target.bot) {
      await interaction.reply({ content: 'You cannot rob bots.', ephemeral: true });
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
    
    // Check cooldown (2 hours)
    const now = new Date();
    const lastRob = userEcon.lastRep; // Reuse lastRep for rob cooldown
    const cooldown = 2 * 60 * 60 * 1000;
    
    if (lastRob && (now.getTime() - lastRob.getTime()) < cooldown) {
      const timeLeft = cooldown - (now.getTime() - lastRob.getTime());
      const minutesLeft = Math.ceil(timeLeft / (1000 * 60));
      await interaction.reply({ 
        content: `You're laying low. Wait **${minutesLeft} minutes** before robbing again.`,
        ephemeral: true 
      });
      return;
    }
    
    // Must have at least 100 coins
    if (userEcon.coins < 100) {
      await interaction.reply({ 
        content: 'You need at least **100 coins** to attempt a robbery.',
        ephemeral: true 
      });
      return;
    }
    
    // Target must have at least 500 coins
    if (targetEcon.coins < 500) {
      await interaction.reply({ 
        content: `${target.username} doesn't have enough coins to rob.`,
        ephemeral: true 
      });
      return;
    }
    
    // 40% success rate
    const success = Math.random() < 0.4;
    
    if (success) {
      // Rob 10-30% of target's coins
      const percentage = Math.random() * 0.2 + 0.1; // 10-30%
      const stolen = Math.floor(targetEcon.coins * percentage);
      
      await prisma.userEconomy.update({
        where: { userId },
        data: { coins: userEcon.coins + stolen, lastRep: now }
      });
      
      await prisma.userEconomy.update({
        where: { userId: target.id },
        data: { coins: targetEcon.coins - stolen }
      });
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setAuthor({
          name: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTitle('🎭 Robbery Successful')
        .setDescription(`You stole **${stolen.toLocaleString()}** coins from ${target.username}`)
        .addFields([
          { name: 'Your Balance', value: `${(userEcon.coins + stolen).toLocaleString()} 💛`, inline: true },
          { name: 'Next Rob', value: '2 hours', inline: true }
        ])
        .setThumbnail(target.displayAvatarURL())
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    } else {
      // Failed - lose 5-15% of your coins
      const percentage = Math.random() * 0.1 + 0.05; // 5-15%
      const fine = Math.floor(userEcon.coins * percentage);
      
      await prisma.userEconomy.update({
        where: { userId },
        data: { coins: userEcon.coins - fine, lastRep: now }
      });
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.ERROR)
        .setAuthor({
          name: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTitle('🚨 Robbery Failed')
        .setDescription(`You got caught! Lost **${fine.toLocaleString()}** coins as a fine`)
        .addFields([
          { name: 'Your Balance', value: `${(userEcon.coins - fine).toLocaleString()} 💛`, inline: true },
          { name: 'Next Rob', value: '2 hours', inline: true }
        ])
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
    }
  },
};

