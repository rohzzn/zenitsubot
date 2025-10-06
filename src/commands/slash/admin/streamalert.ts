import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const streamalert = {
  data: {
    name: 'streamalert',
    description: 'Setup Twitch/YouTube live stream alerts (Admin only)',
  },
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    
    if (subcommand === 'add') {
      const platform = interaction.options.getString('platform', true);
      const streamerId = interaction.options.getString('id', true);
      const channel = interaction.options.getChannel('channel', true);
      
      await prisma.streamAlert.create({
        data: {
          guildId: interaction.guildId!,
          channelId: channel.id,
          platform,
          streamerId,
          streamerName: streamerId
        }
      });
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setTitle('⚡ Stream Alert Added!')
        .setDescription(`I'll notify <#${channel.id}> when **${streamerId}** goes live on ${platform}! 💛`)
        .setFooter({ text: 'Checking every 5 minutes! ⚡' });
      
      await interaction.reply({ embeds: [embed] });
      
    } else if (subcommand === 'remove') {
      const streamerId = interaction.options.getString('id', true);
      
      await prisma.streamAlert.deleteMany({
        where: {
          guildId: interaction.guildId!,
          streamerId
        }
      });
      
      await interaction.reply({ content: `⚡ Removed alerts for **${streamerId}**!`, ephemeral: true });
      
    } else if (subcommand === 'list') {
      const alerts = await prisma.streamAlert.findMany({
        where: { guildId: interaction.guildId! }
      });
      
      if (alerts.length === 0) {
        await interaction.reply({ content: '📺 No stream alerts configured!', ephemeral: true });
        return;
      }
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setTitle('📺 Stream Alerts')
        .setDescription(
          alerts.map(a => `⚡ **${a.streamerName}** (${a.platform}) → <#${a.channelId}>`).join('\n')
        );
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },
};

