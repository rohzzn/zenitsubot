import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { getPrisma } from '../../../services/db.js';

export const welcome = {
  data: {
    name: 'welcome',
    description: 'Setup welcome messages for new members',
  },
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    const guildId = interaction.guildId!;
    
    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message') || 
        'Welcome {user} to **{server}**! ⚡💛\nWe now have **{memberCount}** members!';
      
      await prisma.guildConfig.upsert({
        where: { guildId },
        create: {
          guildId,
          welcomeEnabled: true,
          welcomeChannelId: channel.id,
          welcomeMessage: message
        },
        update: {
          welcomeEnabled: true,
          welcomeChannelId: channel.id,
          welcomeMessage: message
        }
      });
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.SUCCESS)
        .setTitle('⚡ Welcome Messages Enabled!')
        .setDescription(
          `Channel: <#${channel.id}>\n\n` +
          `**Preview:**\n${message.replace('{user}', interaction.user.toString()).replace('{server}', interaction.guild!.name).replace('{memberCount}', interaction.guild!.memberCount.toString())}`
        )
        .setFooter({ text: 'I\'ll greet everyone warmly! 💛' });
      
      await interaction.reply({ embeds: [embed] });
      
    } else if (subcommand === 'disable') {
      await prisma.guildConfig.upsert({
        where: { guildId },
        create: { guildId, welcomeEnabled: false },
        update: { welcomeEnabled: false }
      });
      
      await interaction.reply({ content: '⚡ Welcome messages disabled!', ephemeral: true });
      
    } else if (subcommand === 'test') {
      const config = await prisma.guildConfig.findUnique({ where: { guildId } });
      
      if (!config?.welcomeEnabled || !config.welcomeChannelId) {
        await interaction.reply({ content: '❌ Welcome messages are not set up!', ephemeral: true });
        return;
      }
      
      const channel = interaction.guild!.channels.cache.get(config.welcomeChannelId);
      if (!channel || !('send' in channel)) {
        await interaction.reply({ content: '❌ Welcome channel not found!', ephemeral: true });
        return;
      }
      
      const message = (config.welcomeMessage || 'Welcome {user}!')
        .replace('{user}', interaction.user.toString())
        .replace('{server}', interaction.guild!.name)
        .replace('{memberCount}', interaction.guild!.memberCount.toString());
      
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setDescription(message)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp();
      
      await (channel as any).send({ embeds: [embed] });
      await interaction.reply({ content: '⚡ Test message sent!', ephemeral: true });
    }
  },
};

