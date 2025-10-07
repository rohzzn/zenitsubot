import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const inventory = {
  data: {
    name: 'inventory',
    description: 'View your owned items',
  },
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const prisma = getPrisma();
    const userId = interaction.user.id;
    
    const items = await prisma.userInventory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    
    if (items.length === 0) {
      await interaction.reply({ 
        content: 'Your inventory is empty. Visit `/shop` to buy items!',
        ephemeral: true 
      });
      return;
    }
    
    const backgrounds = items.filter(i => i.itemType === 'bg');
    const badges = items.filter(i => i.itemType === 'badge');
    const colors = items.filter(i => i.itemType === 'color');
    
    const embed = new EmbedBuilder()
      .setColor(ZENITSU_THEME.PRIMARY)
      .setAuthor({
        name: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setTitle('🎒 Inventory')
      .setDescription(`You own **${items.length}** item${items.length > 1 ? 's' : ''}\n\u200b`);
    
    if (backgrounds.length > 0) {
      embed.addFields([{
        name: '🎨 Backgrounds',
        value: backgrounds.map(i => `• ${i.itemName}${i.equipped ? ' ✅' : ''}`).join('\n'),
        inline: false
      }]);
    }
    
    if (badges.length > 0) {
      embed.addFields([{
        name: '🏅 Badges',
        value: badges.map(i => `• ${i.itemName}${i.equipped ? ' ✅' : ''}`).join('\n'),
        inline: false
      }]);
    }
    
    if (colors.length > 0) {
      embed.addFields([{
        name: '🎨 Colors',
        value: colors.map(i => `• ${i.itemName}${i.equipped ? ' ✅' : ''}`).join('\n'),
        inline: false
      }]);
    }
    
    embed.setFooter({ text: '✅ = Equipped' });
    embed.setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
  },
};


