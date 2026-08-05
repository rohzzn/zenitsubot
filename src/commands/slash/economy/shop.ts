import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

const shopItems = {
  backgrounds: [
    { id: 'bg_sunset', name: 'Sunset Background', price: 5000, emoji: '' },
    { id: 'bg_night', name: 'Night Sky', price: 5000, emoji: '' },
    { id: 'bg_ocean', name: 'Ocean Waves', price: 5000, emoji: '' },
  ],
  badges: [
    { id: 'badge_vip', name: 'VIP Badge', price: 10000, emoji: '' },
    { id: 'badge_winner', name: 'Winner Badge', price: 15000, emoji: '' },
    { id: 'badge_rich', name: 'Rich Badge', price: 25000, emoji: '' },
  ],
  colors: [
    { id: 'color_gold', name: 'Gold Color', price: 7500, emoji: '' },
    { id: 'color_purple', name: 'Purple Color', price: 7500, emoji: '' },
    { id: 'color_red', name: 'Red Color', price: 7500, emoji: '' },
  ],
};

export const shop = {
  data: {
    name: 'shop',
    description: 'Browse and purchase items',
  },

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const action = interaction.options.getString('action') || 'list';
    const itemId = interaction.options.getString('item');
    const prisma = getPrisma();
    const userId = interaction.user.id;

    if (action === 'list') {
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setAuthor({
          name: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTitle('Shop')
        .setDescription('Purchase items with your coins\n\u200b')
        .addFields([
          {
            name: 'Backgrounds',
            value: shopItems.backgrounds
              .map(
                (item) =>
                  `${item.emoji} **${item.name}**\n${item.price.toLocaleString()} • \`${item.id}\``,
              )
              .join('\n\n'),
            inline: false,
          },
          {
            name: 'Badges',
            value: shopItems.badges
              .map(
                (item) =>
                  `${item.emoji} **${item.name}**\n${item.price.toLocaleString()} • \`${item.id}\``,
              )
              .join('\n\n'),
            inline: false,
          },
          {
            name: 'Colors',
            value: shopItems.colors
              .map(
                (item) =>
                  `${item.emoji} **${item.name}**\n${item.price.toLocaleString()} • \`${item.id}\``,
              )
              .join('\n\n'),
            inline: false,
          },
        ])
        .setFooter({ text: 'Use /shop action:buy item:<id> to purchase' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    if (action === 'buy') {
      if (!itemId) {
        await interaction.reply({ content: 'Please specify an item ID.', ephemeral: true });
        return;
      }

      // Find item
      const allItems = [...shopItems.backgrounds, ...shopItems.badges, ...shopItems.colors];
      const item = allItems.find((i) => i.id === itemId);

      if (!item) {
        await interaction.reply({ content: 'Item not found.', ephemeral: true });
        return;
      }

      let userEcon = await prisma.userEconomy.findUnique({ where: { userId } });
      if (!userEcon) {
        userEcon = await prisma.userEconomy.create({ data: { userId, coins: 1000 } });
      }

      if (userEcon.coins < item.price) {
        await interaction.reply({
          content: `You need **${item.price.toLocaleString()}** coins. You have **${userEcon.coins.toLocaleString()}**.`,
          ephemeral: true,
        });
        return;
      }

      // Check if already owned
      const existing = await prisma.userInventory.findUnique({
        where: { userId_itemId: { userId, itemId: item.id as string } },
      });

      if (existing) {
        await interaction.reply({ content: 'You already own this item.', ephemeral: true });
        return;
      }

      // Purchase
      await prisma.userEconomy.update({
        where: { userId },
        data: { coins: userEcon.coins - item.price },
      });

      await prisma.userInventory.create({
        data: {
          userId,
          itemId: item.id,
          itemType: item.id.split('_')[0] || 'unknown',
          itemName: item.name,
        },
      });

      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setAuthor({
          name: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTitle('Purchase Complete')
        .setDescription(`${item.emoji} **${item.name}**`)
        .addFields([
          { name: 'Price', value: `${item.price.toLocaleString()}`, inline: true },
          {
            name: 'Balance',
            value: `${(userEcon.coins - item.price).toLocaleString()}`,
            inline: true,
          },
        ])
        .setFooter({ text: 'Use /inventory to view your items' })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  },
};
