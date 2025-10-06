import type { Client, ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { shoukaku } from '../../../music/lavalink.js';
import type { Track } from '../../../music/track.js';
import { ZENITSU_THEME, getRandomMusic } from '../../../utils/constants.js';

export const play = {
  data: { name: 'play' },
  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query') || interaction.options.getString('song');
    if (!query) {
      await interaction.reply({ content: 'Provide a song name, artist, or URL.', ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember;
    if (!member.voice.channel) {
      await interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
      return;
    }

    await interaction.deferReply();

    try {
      const guildId = interaction.guildId!;
      const pm = client.playerManager;
      const queue = pm.ensureQueue(guildId, member.voice.channel.id);
      
      // Check if already connected, if not join
      let player = shoukaku?.players.get(guildId);
      if (!player) {
        player = await shoukaku!.joinVoiceChannel({
          guildId,
          channelId: member.voice.channel.id,
          shardId: member.voice.channel.guild.shardId ?? 0,
          deaf: true,
        });

        // Set up player event handlers
        player.on('end', async (data) => {
          if (data.reason === 'replaced' || data.reason === 'stopped') return;
          
          const nextTrack = queue.next();
          if (nextTrack) {
            await player!.playTrack({ track: { encoded: nextTrack.encoded } });
          } else {
            // Queue ended
            setTimeout(() => {
              const currentPlayer = shoukaku?.players.get(guildId);
              if (currentPlayer && !currentPlayer.track) {
                shoukaku?.leaveVoiceChannel(guildId);
                pm.getQueue(guildId)?.clear();
              }
            }, queue.idleMinutes * 60 * 1000);
          }
        });

        player.on('exception', (data) => {
          console.error('Player exception:', data);
        });
      }
      
      // Search for track
      const node = shoukaku!.nodes.values().next().value;
      if (!node) {
        await interaction.editReply('Music service unavailable.');
        return;
      }

      const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;
      const result = await node.rest.resolve(identifier);
      
      if (!result || result.loadType === 'empty' || result.loadType === 'error') {
        const errorMsg = result?.loadType === 'error' ? (result.data as any)?.message : 'No results found';
        console.error('Search failed:', { loadType: result?.loadType, identifier, error: errorMsg });
        await interaction.editReply(`❌ W-wait! ${errorMsg || 'No results found.'}`);
        return;
      }

      let tracksToAdd: Track[] = [];
      let isPlaylist = false;
      let playlistName = '';

      if (result.loadType === 'playlist') {
        isPlaylist = true;
        playlistName = result.data.info?.name || 'Unknown Playlist';
        tracksToAdd = result.data.tracks.map((t: any) => {
          // Try multiple artwork fields (artworkUrl, thumbnail, etc.)
          const videoId = extractVideoId(t.info.uri || '');
          const artwork = t.info.artworkUrl || (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined);
          
          return {
            encoded: t.encoded,
            title: t.info.title,
            author: t.info.author,
            duration: t.info.length,
            uri: t.info.uri,
            artworkUrl: artwork,
          };
        });
      } else if (result.loadType === 'track') {
        const t = result.data;
        const videoId = extractVideoId(t.info.uri || '');
        const artwork = t.info.artworkUrl || (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined);
        
        tracksToAdd = [{
          encoded: t.encoded,
          title: t.info.title,
          author: t.info.author,
          duration: t.info.length,
          uri: t.info.uri,
          artworkUrl: artwork,
        }];
      } else if (result.loadType === 'search') {
        const t = result.data[0];
        if (t) {
          const videoId = extractVideoId(t.info.uri || '');
          const artwork = t.info.artworkUrl || (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined);
          
          tracksToAdd = [{
            encoded: t.encoded,
            title: t.info.title,
            author: t.info.author,
            duration: t.info.length,
            uri: t.info.uri,
            artworkUrl: artwork,
          }];
        }
      }

      if (tracksToAdd.length === 0) {
        await interaction.editReply('❌ No playable tracks found.');
        return;
      }

      // Add tracks to queue
      const wasEmpty = queue.list().length === 0;
      queue.enqueueMany(tracksToAdd);

      // If queue was empty, start playing immediately
      if (wasEmpty) {
        const firstTrack = queue.next();
        if (firstTrack) {
          await player.playTrack({ track: { encoded: firstTrack.encoded } });
          
          // Create rich embed with buttons
          const embed = createNowPlayingEmbed(firstTrack, member);
          const buttons = createMusicButtons();
          
          if (isPlaylist) {
            const playlistEmbed = new EmbedBuilder()
              .setColor(ZENITSU_THEME.PRIMARY)
              .setTitle('⚡ Playing Playlist')
              .setDescription(
                `**${playlistName}**\n${tracksToAdd.length} tracks loaded\n\n` +
                `So many amazing sounds! 💛\n\n` +
                `**Track List:**\n` +
                tracksToAdd.slice(0, 10).map((t, i) => 
                  `${i + 1}. ${t.title.substring(0, 40)}${t.title.length > 40 ? '...' : ''}`
                ).join('\n') +
                (tracksToAdd.length > 10 ? `\n*...and ${tracksToAdd.length - 10} more tracks*` : '')
              )
              .setFooter({ text: `Requested by ${member.user.username}`, iconURL: member.user.displayAvatarURL() });
            
            await interaction.editReply({ embeds: [playlistEmbed, embed], components: [buttons] });
          } else {
            await interaction.editReply({ embeds: [embed], components: [buttons] });
          }
        }
      } else {
        // Queue already playing, just add to queue
        const currentTrack = queue.now();
        const currentEmbed = currentTrack ? createNowPlayingEmbed(currentTrack, member) : null;
        const buttons = createMusicButtons();
        
        if (isPlaylist) {
          const playlistEmbed = new EmbedBuilder()
            .setColor(ZENITSU_THEME.PRIMARY)
            .setTitle(`⚡ Playlist Added`)
            .setDescription(`**${playlistName}**\n${tracksToAdd.length} tracks • Position ${queue.list().length - tracksToAdd.length + 1} in queue\n\nI'll make sure they all play perfectly! 💛`)
            .setFooter({ text: `Requested by ${member.user.username}`, iconURL: member.user.displayAvatarURL() });
          
          if (currentEmbed) {
            await interaction.editReply({ embeds: [playlistEmbed, currentEmbed], components: [buttons] });
          } else {
            await interaction.editReply({ embeds: [playlistEmbed], components: [buttons] });
          }
        } else {
          const track = tracksToAdd[0]!;
          const addedEmbed = new EmbedBuilder()
            .setColor(ZENITSU_THEME.PRIMARY)
            .setTitle('⚡ Added to Queue')
            .setDescription(`**${track.title}**\n${track.author} • ${formatDuration(track.duration)}\nPosition ${queue.list().length} in queue\n\nI-I'll play it soon! 💛`)
            .setFooter({ text: `Requested by ${member.user.username}`, iconURL: member.user.displayAvatarURL() });
          
          if (track.artworkUrl) {
            addedEmbed.setThumbnail(track.artworkUrl);
          }
          
          if (currentEmbed) {
            await interaction.editReply({ embeds: [addedEmbed, currentEmbed], components: [buttons] });
          } else {
            await interaction.editReply({ embeds: [addedEmbed], components: [buttons] });
          }
        }
      }
    } catch (err: any) {
      console.error('Play command error:', err);
      await interaction.editReply(`❌ Error: ${err.message}`);
    }
  },
};

function createNowPlayingEmbed(track: Track, member: GuildMember): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(`⚡ ${track.title}`)
    .setDescription(`${track.author} • ${formatDuration(track.duration)}\n\n${getRandomMusic()}`)
    .setFooter({ text: `Requested by ${member.user.username} | Thunder Breathing: First Form`, iconURL: member.user.displayAvatarURL() });
  
  // Set large image for artwork
  if (track.artworkUrl) {
    embed.setImage(track.artworkUrl);
  }
  
  // Add clickable link if available
  if (track.uri) {
    embed.setURL(track.uri);
  }
  
  return embed;
}

function createMusicButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Pause'),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Skip'),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Stop'),
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Queue'),
    new ButtonBuilder()
      .setCustomId('music_loop')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Loop'),
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hrs = Math.floor(mins / 60);
  const finalMins = mins % 60;
  
  if (hrs > 0) {
    return `${hrs}:${finalMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${finalMins}:${secs.toString().padStart(2, '0')}`;
}

function extractVideoId(url: string): string | null {
  if (!url) return null;
  
  // Extract YouTube video ID from various URL formats
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Just the ID
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) return match[1];
  }
  
  return null;
}
