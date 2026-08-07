import type {
  Client,
  ChatInputCommandInteraction,
  GuildMember,
  AutocompleteInteraction,
} from 'discord.js';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Node } from 'shoukaku';
import { Constants } from 'shoukaku';
import { shoukaku } from '../../../music/lavalink.js';
import type { Track } from '../../../music/track.js';
import { ZENITSU_THEME } from '../../../utils/constants.js';
import { logger } from '../../../services/logger.js';

/** Discord discards an autocomplete reply after three seconds; leave headroom. */
const AUTOCOMPLETE_BUDGET_MS = 2200;

/**
 * Picks a node that is actually connected. Taking the first node blindly means
 * a reconnecting node swallows the request and /play reports a bare failure.
 *
 * Uses Shoukaku's own enum rather than a literal: CONNECTED is 1, and 2 is
 * DISCONNECTING, so a hardcoded 2 matches nothing and /play always reports the
 * music server as unavailable.
 */
function readyNode(): Node | null {
  if (!shoukaku) return null;
  for (const node of shoukaku.nodes.values()) {
    if (node.state === Constants.State.CONNECTED) return node;
  }
  return null;
}

/**
 * Suggests real tracks as the query is typed.
 *
 * Discord drops an autocomplete response that takes longer than three seconds,
 * so this bails early rather than sending a search that will be thrown away:
 * short queries are still being typed, and a URL needs no suggesting.
 */
async function suggestTracks(interaction: AutocompleteInteraction): Promise<void> {
  const query = interaction.options.getFocused().trim();
  if (query.length < 3 || /^https?:\/\//i.test(query)) {
    await interaction.respond([]);
    return;
  }

  const node = readyNode();
  if (!node) {
    await interaction.respond([]);
    return;
  }

  try {
    const result = await Promise.race([
      node.rest.resolve(`ytsearch:${query}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), AUTOCOMPLETE_BUDGET_MS)),
    ]);

    if (!result || result.loadType !== 'search') {
      await interaction.respond([]);
      return;
    }

    await interaction.respond(
      result.data.slice(0, 25).map((track) => {
        const label = `${track.info.title} — ${track.info.author}`;
        return {
          // Both fields cap at 100 characters.
          name: label.length > 100 ? `${label.slice(0, 99)}…` : label,
          // The URL, not the title: it resolves to exactly the chosen track
          // rather than re-searching and possibly landing somewhere else.
          value: (track.info.uri ?? track.info.title).slice(0, 100),
        };
      }),
    );
  } catch {
    // A failed suggestion must never block typing.
    await interaction.respond([]).catch(() => {});
  }
}

function extractVideoId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function toTrack(raw: any): Track {
  const videoId = extractVideoId(raw.info?.uri ?? '');
  // hqdefault always exists; maxresdefault is missing on plenty of videos and
  // renders as a broken image in the embed.
  const artwork =
    raw.info?.artworkUrl ||
    (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined);

  return {
    encoded: raw.encoded,
    title: raw.info?.title ?? 'Unknown title',
    author: raw.info?.author ?? 'Unknown artist',
    duration: raw.info?.length ?? 0,
    uri: raw.info?.uri,
    artworkUrl: artwork,
  };
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return 'live';
  const seconds = Math.floor(ms / 1000);
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return hrs > 0
    ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function createNowPlayingEmbed(track: Track, member: GuildMember): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ZENITSU_THEME.PRIMARY)
    .setTitle(track.title)
    .setDescription(`${track.author} - ${formatDuration(track.duration)}`)
    .setFooter({
      text: `Requested by ${member.user.username}`,
      iconURL: member.user.displayAvatarURL(),
    });

  if (track.artworkUrl) embed.setImage(track.artworkUrl);
  if (track.uri) embed.setURL(track.uri);
  return embed;
}

export function createMusicButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Pause'),
    new ButtonBuilder().setCustomId('music_skip').setStyle(ButtonStyle.Secondary).setLabel('Skip'),
    new ButtonBuilder().setCustomId('music_stop').setStyle(ButtonStyle.Secondary).setLabel('Stop'),
    new ButtonBuilder()
      .setCustomId('music_queue')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Queue'),
    new ButtonBuilder().setCustomId('music_loop').setStyle(ButtonStyle.Secondary).setLabel('Loop'),
  );
}

export const play = {
  data: { name: 'play' },
  category: 'music',

  autocomplete: suggestTracks,

  async execute(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    const query = interaction.options.getString('query', true).trim();
    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;
    const guildId = interaction.guildId!;

    if (!voiceChannel) {
      await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
      return;
    }

    const me = interaction.guild!.members.me!;
    const permissions = voiceChannel.permissionsFor(me);
    if (!permissions?.has('Connect') || !permissions.has('Speak')) {
      await interaction.reply({
        content: `I need Connect and Speak permissions in ${voiceChannel}.`,
        ephemeral: true,
      });
      return;
    }

    // If already playing elsewhere, say so rather than silently moving.
    const existing = shoukaku?.connections.get(guildId);
    if (existing?.channelId && existing.channelId !== voiceChannel.id) {
      await interaction.reply({
        content: `I'm already playing in <#${existing.channelId}>. Join that channel, or use \`/stop\` first.`,
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply();

    const node = readyNode();
    if (!node) {
      await interaction.editReply(
        'The music server is not connected right now. Try again in a few seconds.',
      );
      return;
    }

    try {
      // A bare search term needs a search prefix; URLs pass through so Lavalink
      // and LavaSrc can route them (YouTube, SoundCloud, Spotify).
      const identifier = /^https?:\/\//i.test(query) ? query : `ytsearch:${query}`;
      const result = await node.rest.resolve(identifier);

      if (!result || result.loadType === 'empty') {
        await interaction.editReply(`No results for **${query}**.`);
        return;
      }

      if (result.loadType === 'error') {
        const message = (result.data as any)?.message ?? 'unknown error';
        logger.error({ identifier, error: result.data }, 'Track resolution failed');
        await interaction.editReply(`Could not load that track: ${message}`);
        return;
      }

      let tracks: Track[] = [];
      let playlistName: string | null = null;

      if (result.loadType === 'playlist') {
        playlistName = (result.data as any).info?.name ?? 'Playlist';
        tracks = (result.data as any).tracks.map(toTrack);
      } else if (result.loadType === 'track') {
        tracks = [toTrack(result.data)];
      } else if (result.loadType === 'search') {
        const first = (result.data as any[])[0];
        if (first) tracks = [toTrack(first)];
      }

      if (tracks.length === 0) {
        await interaction.editReply('No playable tracks found.');
        return;
      }

      const pm = client.playerManager;
      const queue = pm.ensureQueue(guildId, voiceChannel.id);
      // Connects if needed and wires queue-advance handlers exactly once.
      const player = await pm.ensurePlayer(voiceChannel);

      const wasEmpty = queue.list().length === 0;
      queue.enqueueMany(tracks);

      if (wasEmpty) {
        const first = queue.next();
        if (!first) {
          await interaction.editReply('Could not start playback.');
          return;
        }

        await player.playTrack({ track: { encoded: first.encoded } });

        const embed = createNowPlayingEmbed(first, member);
        embed.setAuthor({ name: playlistName ? 'Playing playlist' : 'Now playing' });

        if (playlistName) {
          embed.addFields({
            name: playlistName,
            value: `${tracks.length} tracks queued`,
            inline: false,
          });
        }

        await interaction.editReply({ embeds: [embed], components: [createMusicButtons()] });
        return;
      }

      const position = queue.list().length - tracks.length + 1;
      const embed = new EmbedBuilder()
        .setColor(ZENITSU_THEME.PRIMARY)
        .setAuthor({ name: playlistName ? 'Playlist added to queue' : 'Added to queue' })
        .setTitle(playlistName ?? tracks[0]!.title)
        .setFooter({
          text: `Requested by ${member.user.username}`,
          iconURL: member.user.displayAvatarURL(),
        });

      if (playlistName) {
        embed.setDescription(`${tracks.length} tracks, starting at position ${position}`);
      } else {
        const track = tracks[0]!;
        embed.setDescription(
          `${track.author} - ${formatDuration(track.duration)}\nPosition ${position} in queue`,
        );
        if (track.uri) embed.setURL(track.uri);
        if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);
      }

      await interaction.editReply({ embeds: [embed], components: [createMusicButtons()] });
    } catch (err) {
      logger.error({ err, query }, 'Play command failed');
      const message = err instanceof Error ? err.message : 'unknown error';
      await interaction.editReply(`Something went wrong: ${message}`).catch(() => {});
    }
  },
};
