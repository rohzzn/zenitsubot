import type { Client, ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getPrisma } from '../../../services/db.js';
import { fetchLatestAiredEpisode } from '../../../services/animeChecker.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';

export const animealert = {
  data: {
    name: 'animealert',
    description: 'Setup anime episode alerts for your server',
  },
  category: 'anime',
  defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();
    
    if (subcommand === 'add') {
      const animeName = interaction.options.getString('name', true);
      const channel = interaction.options.getChannel('channel', true);
      
      if (!channel || !('send' in channel)) {
        await interaction.reply({ content: '❌ Please select a text channel.', ephemeral: true });
        return;
      }
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        // Search for anime to verify it exists
        const response = await fetch(
          `https://api.jikan.moe/v4/anime?q=${encodeURIComponent(animeName)}&limit=1`
        );
        
        if (!response.ok) {
          await interaction.editReply('❌ Failed to search anime.');
          return;
        }
        
        const data: any = await response.json();
        
        if (!data?.data || data.data.length === 0) {
          await interaction.editReply(`❌ Anime "${animeName}" not found.`);
          return;
        }
        
        const anime = data.data[0];
        const animeId = anime.mal_id.toString();

        // Seed from what has already aired so we only announce episodes that
        // land after the alert is created.
        const airedSoFar = await fetchLatestAiredEpisode(animeId);

        await prisma.animeAlert.upsert({
        where: {
          guildId_animeId: {
            guildId: interaction.guildId!,
            animeId,
          },
        },
        create: {
          guildId: interaction.guildId!,
          channelId: channel.id,
          userId: interaction.user.id,
          animeId,
          animeName: anime.title,
          title: anime.title,
          lastEpisode: airedSoFar,
        },
        update: {
          channelId: channel.id,
          animeName: anime.title,
          title: anime.title,
        },
        });
        
        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setTitle('✅ Alert Added')
          .setDescription(
            `Now tracking **${anime.title}**!\n\n` +
            `📺 Episodes: ${anime.episodes || 'Unknown'}\n` +
            `⭐ Score: ${anime.score || 'N/A'}/10\n` +
            `📍 Channel: <#${channel.id}>\n\n` +
            `You'll be notified when new episodes air!`
          )
          .setThumbnail(anime.images.jpg.large_image_url)
          .setFooter({ text: 'Checks every 30 minutes' });
        
        await interaction.editReply({ embeds: [embed] });
      } catch (err: any) {
        console.error('Add alert error:', err);
        await interaction.editReply(`❌ Error: ${err.message}`);
      }
    } else if (subcommand === 'remove') {
      const animeName = interaction.options.getString('name', true);
      
      try {
        const deleted = await prisma.animeAlert.deleteMany({
          where: {
            guildId: interaction.guildId!,
            animeName: { contains: animeName },
          },
        });
        
        if (deleted.count > 0) {
          await interaction.reply({ 
            content: `✅ Removed **${animeName}** from tracking.`, 
            ephemeral: true 
          });
        } else {
          await interaction.reply({ 
            content: `❌ Anime not found in tracking list.`, 
            ephemeral: true 
          });
        }
      } catch (err: any) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
      }
    } else if (subcommand === 'list') {
      try {
        const alerts = await prisma.animeAlert.findMany({
          where: { guildId: interaction.guildId! },
          orderBy: { createdAt: 'desc' },
        });
        
        if (alerts.length === 0) {
          await interaction.reply({ 
            content: '📺 No anime being tracked yet. Use `/animealert add` to start!', 
            ephemeral: true 
          });
          return;
        }
        
        const embed = new EmbedBuilder()
          .setColor(ZENITSU_THEME.PRIMARY)
          .setTitle(`📺 Tracked Anime (${alerts.length})`)
          .setDescription(
            alerts.map((a, i) => 
              `${i + 1}. **${a.animeName}**\n` +
              `   📍 <#${a.channelId}> • Episode ${a.lastEpisode}`
            ).join('\n\n')
          )
          .setFooter({ text: 'Use /animealert remove to stop tracking' })
          .setTimestamp();
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err: any) {
        await interaction.reply({ content: `❌ Error: ${err.message}`, ephemeral: true });
      }
    }
  },
};

